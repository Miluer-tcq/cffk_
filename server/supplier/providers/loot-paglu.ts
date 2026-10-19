import { z } from "zod";
import { SupplierDomainError } from "../error";
import { decimalToMinorRounded } from "../money";
import type { SupplierPurchaseResult } from "../schema";
import { supplierFetchJson } from "./http";
import type { SupplierAdapter, SupplierProduct, SupplierSku } from "./types";

/**
 * Loot Paglu (lootpaglu.in) 供应商适配器。
 * 结算钱包由账号币种决定: INR 走 INR 钱包(价格取 upiPrice),USD 走加密钱包 USDT(价格取 cryptoPrice)。
 * 下单用 requestNo 作 Idempotency-Key,上游超时/重试不会重复扣款。
 * 上游返回的数值经常是字符串/多位小数/科学计数法，schema 全部做宽容解析，金额做四舍五入，不直接抛错。
 */

/** 账号信息只用 zod 做最小校验（/me 已实测通过），商品/订单走下面的宽容解析。 */
const meSchema = z.object({
  userId: z.union([z.number(), z.string()]).optional(),
  wallet_inr: z.union([z.number(), z.string()]).nullable().optional(),
  wallet_crypto: z.union([z.number(), z.string()]).nullable().optional(),
});
const errorSchema = z.object({ error: z.string().optional(), message: z.string().optional() });

/**
 * 宽容解析：上游实际返回的字段名/嵌套层级可能与文档不一致（文档示例是手写示例，不是真实响应）。
 * 商品目录：外层接受 services / data.services / data / products / items / result / 裸数组；
 * 单个商品接受 id 字段别名（service_id/id/serviceId）、名称别名（name/title/service_name）、
 * 库存别名（available_stock/stock/availableStock/quantity，缺省视为不限量）、
 * 价格接受 prices 对象（upiPrice/cryptoPrice、upi/crypto、inr/usd、price_inr/price_crypto 等别名）、
 * 商品顶层平铺价格、单个 price（双币种同价），以及数量阶梯价 slots（只取第一档的拿货价）。
 * 订单：order_id 接受 order_id/id/orderId；卡密接受 products/delivered_products/codes/items/keys。
 * 全部无法识别时，错误信息带上实际结构的键名/类型，方便定位。
 */

/** 取对象里第一个存在的别名字段值。 */
function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

/** baseUrl 归一化：去尾斜杠 + 去掉误填的 /api/v1、/api 后缀，防止拼出 /api/v1/api/v1/... 导致 404。 */
function normalizeBaseUrl(baseUrl: string): string {
  let url = baseUrl.trim().replace(/\/+$/, "");
  for (let i = 0; i < 3; i++) {
    if (/\/api\/v1$/i.test(url)) url = url.replace(/\/api\/v1$/i, "");
    else if (/\/api$/i.test(url)) url = url.replace(/\/api$/i, "");
    else break;
    url = url.replace(/\/+$/, "");
  }
  return url;
}

/** 把任意值转成数字，失败返回 undefined。兼容带货币符号/单位的字符串，如 "₹50.00"、"$0.50"、"50.00 INR"。 */
function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/,/g, "");
    const direct = Number(cleaned);
    if (Number.isFinite(direct)) return direct;
    const m = /[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(cleaned);
    if (m) {
      const n = Number(m[0]);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** 列表可能是数组，也可能是对象字典 {id: item}，统一转数组。容器对象（含 services/products/data 等键）不算字典。 */
function toArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if ("services" in obj || "products" in obj || "items" in obj || "result" in obj || "data" in obj) return undefined;
    const vals = Object.values(obj);
    if (vals.length && vals.every((v) => v && typeof v === "object" && !Array.isArray(v))) return vals;
  }
  return undefined;
}

/** 把任意值转成字符串标量，失败返回 undefined。 */
function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

/** 实际响应结构的简短描述（键名+值类型，不含具体值，避免泄漏敏感内容）。 */
function describeStructure(value: unknown, depth = 0): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return depth >= 2 ? "array" : `array[${value.length > 0 ? describeStructure(value[0], depth + 1) : "?"}]`;
  if (typeof value === "object") {
    if (depth >= 2) return "object";
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 12);
    return `{${entries.map(([k, v]) => `${k}:${describeStructure(v, depth + 1)}`).join(", ")}}`;
  }
  return typeof value;
}

type ParsedService = {
  serviceId: string;
  name: string;
  stock: number;
  upiPrice: number | undefined;
  cryptoPrice: number | undefined;
};

/** 从上游商品目录响应里提取服务列表（宽容解析）。 */
function parseServices(body: unknown): ParsedService[] {
  let items: unknown[] | undefined;
  if (Array.isArray(body)) items = body;
  else if (body && typeof body === "object") {
    const obj = body as Record<string, unknown>;
    const candidates: unknown[] = [obj.services, obj.products, obj.items, obj.result];
    // data 可能是数组、对象字典、或嵌套 {services/products/...} / {data: [...]}；先试嵌套字段，再试 data 本身
    if (obj.data && typeof obj.data === "object") {
      if (Array.isArray(obj.data)) candidates.push(obj.data);
      else {
        const data = obj.data as Record<string, unknown>;
        candidates.push(data.services, data.products, data.items, data.result, data.data);
        if (data.data && typeof data.data === "object" && !Array.isArray(data.data)) {
          const dd = data.data as Record<string, unknown>;
          candidates.push(dd.services, dd.products, dd.items, dd.result);
        }
        candidates.push(obj.data);
      }
    }
    for (const c of candidates) {
      const arr = toArray(c);
      if (arr !== undefined) { items = arr; break; }
    }
  }
  if (!items) {
    throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu 商品目录格式无法识别，实际结构：${describeStructure(body)}`);
  }
  const services: ParsedService[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const serviceId = asString(pick(obj, ["service_id", "id", "serviceId", "serviceID", "service_code"]));
    if (!serviceId) continue;
    const name = asString(pick(obj, ["name", "title", "service_name", "serviceName", "product_name", "productName"])) ?? serviceId;
    const stockRaw = pick(obj, ["available_stock", "stock", "availableStock", "quantity", "available", "count"]);
    const stock = stockRaw === undefined ? 2147483647 : (asNumber(stockRaw) ?? 2147483647);
    // 价格：优先 prices 对象，其次商品顶层平铺字段，最后单个 price（双币种同价）
    let upiPrice: number | undefined;
    let cryptoPrice: number | undefined;
    const pricesRaw = pick(obj, ["prices", "price"]);
    if (typeof pricesRaw === "object" && pricesRaw !== null) {
      const p = pricesRaw as Record<string, unknown>;
      upiPrice = asNumber(pick(p, ["upiPrice", "upi", "inr", "inrPrice", "price_inr", "INR", "priceInr"]));
      cryptoPrice = asNumber(pick(p, ["cryptoPrice", "crypto", "usd", "usdPrice", "price_crypto", "USDT", "priceUsd"]));
    } else if (typeof pricesRaw === "number" || typeof pricesRaw === "string") {
      upiPrice = cryptoPrice = asNumber(pricesRaw);
    }
    if (upiPrice === undefined) upiPrice = asNumber(pick(obj, ["upiPrice", "upi", "inrPrice", "price_inr"]));
    if (cryptoPrice === undefined) cryptoPrice = asNumber(pick(obj, ["cryptoPrice", "crypto", "usdPrice", "price_crypto"]));
    // 数量阶梯价 slots：只取第一档的拿货价（TCQ 要求：数量不同价格不同，只显示第一档）。
    if ((upiPrice === undefined || cryptoPrice === undefined)) {
      const slotsRaw = pick(obj, ["slots", "tiers", "price_slots", "priceSlots"]);
      if (Array.isArray(slotsRaw) && slotsRaw.length > 0 && slotsRaw[0] && typeof slotsRaw[0] === "object") {
        const first = slotsRaw[0] as Record<string, unknown>;
        if (upiPrice === undefined) upiPrice = asNumber(pick(first, ["upiPrice", "upi", "inr", "inrPrice", "price_inr"]));
        if (cryptoPrice === undefined) cryptoPrice = asNumber(pick(first, ["cryptoPrice", "crypto", "usd", "usdPrice", "price_crypto"]));
      }
    }
    services.push({ serviceId, name, stock: Math.trunc(stock), upiPrice, cryptoPrice });
  }
  if (!services.length && items.length > 0) {
    throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu 商品目录条目格式无法识别，首条结构：${describeStructure(items[0])}`);
  }
  return services;
}

/** 从下单响应里提取订单号与卡密（宽容解析）。 */
function parseOrderResult(body: unknown, what: string): { orderId: string; cards: string[] } {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const order = obj.order && typeof obj.order === "object" ? (obj.order as Record<string, unknown>) : obj;
  const orderId = asString(pick(order, ["order_id", "id", "orderId", "orderID"]));
  const cardsRaw = pick(order, ["products", "delivered_products", "codes", "items", "keys", "cards"]);
  const cards: string[] = [];
  if (Array.isArray(cardsRaw)) {
    for (const c of cardsRaw) {
      const s = asString(c);
      if (s && s.trim()) cards.push(s.trim());
    }
  }
  if (!orderId) {
    throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu ${what}格式无法识别，实际结构：${describeStructure(body)}`);
  }
  return { orderId, cards };
}

/** 从订单详情响应里提取订单号、状态与卡密（宽容解析）。 */
function parseOrderDetail(body: unknown): { orderId: string; status: string; cards: string[] } {
  const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const order = obj.order && typeof obj.order === "object" ? (obj.order as Record<string, unknown>) : obj;
  const orderId = asString(pick(order, ["order_id", "id", "orderId", "orderID"]));
  const status = asString(pick(order, ["status", "state", "order_status"])) ?? "";
  const cardsRaw = pick(order, ["delivered_products", "products", "codes", "items", "keys", "cards"]);
  const cards: string[] = [];
  if (Array.isArray(cardsRaw)) {
    for (const c of cardsRaw) {
      const s = asString(c);
      if (s && s.trim()) cards.push(s.trim());
    }
  }
  if (!orderId) {
    throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu 订单详情格式无法识别，实际结构：${describeStructure(body)}`);
  }
  return { orderId, status, cards };
}

function toDecimal(value: number | string): string {
  return typeof value === "number" ? String(value) : value;
}

export class LootPagluAdapter implements SupplierAdapter {
  constructor(
    private readonly input: {
      baseUrl: string;
      apiKey: string;
      currency: string;
      currencyDecimals: number;
      fetcher?: typeof fetch;
      now?: () => number;
    },
  ) {
    // baseUrl 归一化：去尾斜杠 + 去掉误填的 /api/v1、/api 后缀，防止拼出 /api/v1/api/v1/... 导致 404。
    this.input.baseUrl = normalizeBaseUrl(this.input.baseUrl);
  }

  /** 账号币种 → 上游结算币种: INR=INR 钱包,USD=加密钱包(USDT)。 */
  private orderCurrency(): "inr" | "crypto" {
    const currency = this.input.currency.trim().toUpperCase();
    if (currency === "INR") return "inr";
    if (currency === "USD") return "crypto";
    throw new SupplierDomainError("supplier_currency_unsupported", 400, "Loot Paglu 账号币种只支持 INR(INR 钱包)或 USD(加密钱包 USDT)");
  }

  async testConnection() {
    const body = await this.request("GET", "/api/v1/me");
    const parsed = meSchema.safeParse(body);
    if (!parsed.success) {
      throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu 账号信息格式无法识别，实际结构：${describeStructure(body)}`);
    }
    const currency = this.orderCurrency();
    const raw = currency === "inr" ? parsed.data.wallet_inr : parsed.data.wallet_crypto;
    if (raw === null || raw === undefined) throw new SupplierDomainError("invalid_supplier_response", 502, "Loot Paglu 未返回钱包余额");
    return {
      siteName: "Loot Paglu",
      balance: {
        amountMinor: decimalToMinorRounded(toDecimal(raw), this.input.currencyDecimals),
        currency: this.input.currency.toUpperCase(),
      },
    };
  }

  async listProducts(input: { page: number; pageSize: number; includeInactive?: boolean }) {
    const services = await this.fetchServices();
    // TCQ 要求：不要过滤库存为 0 的商品，全部返回（库存 0 仅标记 active=false，仍可查看/导入/关联）。
    const active = services;
    // 关键修复：单个商品缺当前币种价格时只跳过该商品，不让整个目录失败。
    // 上游目录常混有仅 INR 价 / 仅加密价 / 价格为 null 的商品，旧逻辑一个坏商品就抛错，表现为“获取商品不成功”。
    const products: SupplierProduct[] = [];
    const skipped: string[] = [];
    for (const service of active) {
      try {
        products.push(this.product(service));
      } catch (cause) {
        if (cause instanceof SupplierDomainError && cause.code === "invalid_supplier_response") {
          // 库存 0 的商品即使缺当前币种价格也不隐藏：以成本 0 展示，仍可查看；库存 >0 缺价才跳过（无法定价）。
          if (service.stock === 0) {
            products.push({ id: service.serviceId, name: service.name, description: "", imageUrls: [], categoryNames: [], active: false, skus: [{ id: service.serviceId, name: service.name, costMinor: "0", stockQuantity: 0, active: false }] });
            continue;
          }
          skipped.push(service.serviceId);
          continue;
        }
        throw cause;
      }
    }
    if (products.length === 0 && active.length > 0) {
      throw new SupplierDomainError(
        "invalid_supplier_response",
        502,
        `Loot Paglu 商品目录 ${active.length} 个商品均缺当前币种(${this.input.currency.toUpperCase()})价格，已跳过：${skipped.slice(0, 5).join(", ")}${skipped.length > 5 ? ` 等 ${skipped.length} 个` : ""}。请检查账号币种是否与上游价格币种匹配，或切换币种后重试。`,
      );
    }
    if (skipped.length) console.warn("[supplier][loot_paglu] skipped products missing price", { currency: this.input.currency, skipped: skipped.slice(0, 20), skippedCount: skipped.length });
    const start = (input.page - 1) * input.pageSize;
    return { total: products.length, products: products.slice(start, start + input.pageSize) };
  }

  async getSku(productId: string, skuId: string) {
    const services = await this.fetchServices();
    const service = services.find((item) => item.serviceId === skuId || item.serviceId === productId);
    if (!service) throw new SupplierDomainError("supplier_sku_not_found", 404, "Loot Paglu 商品不存在");
    return this.sku(service);
  }

  async submitOrder(input: {
    skuId: string;
    quantity: number;
    requestNo: string;
    callbackUrl: string;
    traceId: string;
  }): Promise<SupplierPurchaseResult> {
    const currency = this.orderCurrency();
    let response: { status: number; body: unknown };
    try {
      response = await this.requestRaw("POST", "/api/v1/order", {
        service_id: input.skuId,
        quantity: input.quantity,
        currency,
      }, { "Idempotency-Key": input.requestNo });
    } catch (cause) {
      // 网络/超时:是否扣款未知,走 uncertain(不自动重试,靠 Idempotency-Key 防重复扣款,管理员手动核对)
      if (cause instanceof SupplierDomainError && cause.code === "supplier_request_uncertain") {
        return { status: "uncertain", upstreamOrderId: null, errorCode: "supplier_request_uncertain" };
      }
      throw cause;
    }
    const { status, body } = response;
    if (status === 200) {
      if (body && typeof body === "object" && (body as Record<string, unknown>).success === false) {
        return { status: "definitively_failed", errorCode: this.errorCode(status, body) };
      }
      const parsed = parseOrderResult(body, "下单结果");
      const cards = parsed.cards;
      if (!cards.length) return { status: "uncertain", upstreamOrderId: parsed.orderId, errorCode: "supplier_delivery_empty" };
      return { status: "supplied", upstreamOrderId: parsed.orderId, cards };
    }
    return { status: "definitively_failed", errorCode: this.errorCode(status, body) };
  }

  async reconcileOrder(input: {
    upstreamOrderId: string | null;
    skuId: string;
    quantity: number;
    requestNo: string;
    callbackUrl: string;
    traceId: string;
  }): Promise<SupplierPurchaseResult> {
    if (!input.upstreamOrderId) {
      return { status: "uncertain", upstreamOrderId: null, errorCode: "supplier_order_id_missing" };
    }
    let response: { status: number; body: unknown };
    try {
      response = await this.requestRaw("GET", `/api/v1/order/${encodeURIComponent(input.upstreamOrderId)}`);
    } catch (cause) {
      if (cause instanceof SupplierDomainError && cause.code === "supplier_request_uncertain") {
        return { status: "uncertain", upstreamOrderId: input.upstreamOrderId, errorCode: "supplier_request_uncertain" };
      }
      throw cause;
    }
    const { status, body } = response;
    if (status === 200) {
      if (body && typeof body === "object" && (body as Record<string, unknown>).success === false) {
        return { status: "uncertain", upstreamOrderId: input.upstreamOrderId, errorCode: this.errorCode(status, body) };
      }
      const parsed = parseOrderDetail(body);
      const cards = parsed.cards;
      if (cards.length) return { status: "supplied", upstreamOrderId: parsed.orderId, cards };
      // 订单存在但暂无卡密:可能是处理中;若上游已失败则判失败
      if (["failed", "cancelled", "refunded"].includes(parsed.status.toLowerCase())) {
        return { status: "definitively_failed", errorCode: `supplier_order_${parsed.status.toLowerCase()}` };
      }
      return { status: "processing", upstreamOrderId: parsed.orderId };
    }
    if (status === 404) return { status: "definitively_failed", errorCode: "supplier_order_not_found" };
    if (status === 401) return { status: "definitively_failed", errorCode: "supplier_account_auth_failed" };
    if (status === 429 || status === 503) return { status: "uncertain", upstreamOrderId: input.upstreamOrderId, errorCode: "supplier_rate_limited" };
    return { status: "uncertain", upstreamOrderId: input.upstreamOrderId, errorCode: this.errorCode(status, body) };
  }

  private async fetchServices() {
    const body = await this.request("GET", "/api/v1/products", undefined, 5 * 1024 * 1024);
    return parseServices(body);
  }

  private product(service: ParsedService): SupplierProduct {
    const sku = this.sku(service);
    return {
      id: service.serviceId,
      name: service.name,
      description: "",
      imageUrls: [],
      categoryNames: [],
      active: service.stock > 0,
      skus: [sku],
    };
  }

  private sku(service: ParsedService): SupplierSku {
    const currency = this.orderCurrency();
    const price = currency === "inr" ? service.upiPrice : service.cryptoPrice;
    if (price === null || price === undefined) {
      throw new SupplierDomainError("invalid_supplier_response", 502, `Loot Paglu 商品 ${service.serviceId} 未返回 ${currency === "inr" ? "upiPrice" : "cryptoPrice"} 价格`);
    }
    return {
      id: service.serviceId,
      name: service.name,
      costMinor: decimalToMinorRounded(toDecimal(price), this.input.currencyDecimals),
      stockQuantity: service.stock,
      active: service.stock > 0,
    };
  }

  /** 成功才返回 body;非 2xx 抛带状态码的错,由调用方按业务映射。200 但 success:false 也按错误处理，避免误报“格式无法识别”。 */
  private async request(method: string, path: string, value?: unknown, maxResponseBytes?: number) {
    const { status, body } = await this.requestRaw(method, path, value, undefined, maxResponseBytes);
    if (status === 200) {
      if (body && typeof body === "object" && (body as Record<string, unknown>).success === false) {
        throw new SupplierDomainError(this.errorCode(status, body), status, this.errorMessage(body));
      }
      return body;
    }
    throw new SupplierDomainError(this.errorCode(status, body), status, this.errorMessage(body));
  }

  private async requestRaw(method: string, path: string, value?: unknown, extraHeaders: Record<string, string> = {}, maxResponseBytes?: number) {
    let response: { status: number; body: unknown };
    try {
      response = await supplierFetchJson(
        this.input.fetcher ?? fetch,
        `${this.input.baseUrl}${path}`,
        {
          method,
          headers: {
            "X-API-Key": this.input.apiKey,
            ...extraHeaders,
            ...(value === undefined ? {} : { "Content-Type": "application/json" }),
          },
          body: value === undefined ? undefined : JSON.stringify(value),
        },
        { validateDestination: !this.input.fetcher, ...(maxResponseBytes ? { maxResponseBytes } : {}) },
      );
    } catch (cause) {
      console.error("[supplier][loot_paglu] request failed", { method, path, error: cause });
      throw cause;
    }
    return response;
  }

  private errorMessage(body: unknown): string {
    const parsed = errorSchema.safeParse(body);
    if (parsed.success && (parsed.data.error || parsed.data.message)) return parsed.data.error ?? parsed.data.message ?? "Loot Paglu 请求失败";
    return "Loot Paglu 请求失败";
  }

  /** 上游错误 → 内部错误码。 */
  private errorCode(status: number, body: unknown): string {
    const message = this.errorMessage(body).toLowerCase();
    if (status === 401 || status === 403) return "supplier_account_auth_failed";
    if (status === 429) return "supplier_rate_limited";
    if (status === 503) return "supplier_unavailable";
    if (/invalid.*api[- ]?key|unapproved.*api|missing.*api[- ]?key|api key/.test(message)) return "supplier_account_auth_failed";
    if (/insufficient.*balance|余额不足/.test(message)) return "supplier_balance_insufficient";
    if (/out of stock|缺货|库存/.test(message)) return "supplier_stock_insufficient";
    if (/not found|service id/.test(message)) return "supplier_sku_not_found";
    return `supplier_http_${status}`;
  }
}
