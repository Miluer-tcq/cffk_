/**
 * Loot Paglu 适配器回归测试（针对用户实测报错：测试连接报 invalid_supplier_money，获取商品报通用错误）。
 * 覆盖：上游返回多位小数/字符串数字/科学计数法/空价格/缺字段时的宽容解析，
 * 以及错误仍为 SupplierDomainError（可被 telefuncAction 透传到前端）。
 * 运行：bun loot_paglu_regression_test.ts
 */
import { SupplierDomainError } from "./server/supplier/error.ts";
import { decimalToMinorRounded } from "./server/supplier/money.ts";
import { LootPagluAdapter } from "./server/supplier/providers/loot-paglu.ts";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}\n    实际: ${a}\n    期望: ${e}`); }
}
async function checkThrows(name: string, fn: () => Promise<unknown>, expectedCode: string) {
  try {
    await fn();
    failed++; console.log(`  FAIL ${name}\n    实际: 未抛错\n    期望: ${expectedCode}`);
  } catch (cause) {
    if (cause instanceof SupplierDomainError && cause.code === expectedCode) {
      passed++; console.log(`  PASS ${name} (${expectedCode})`);
    } else {
      failed++; console.log(`  FAIL ${name}\n    实际: ${cause instanceof Error ? `${cause.constructor.name} ${cause.message}` : String(cause)}\n    期望: SupplierDomainError ${expectedCode}`);
    }
  }
}

function mockFetch(handler: (url: string, init: any) => any) {
  return async (url: string, init: any) => {
    const result = handler(url, init);
    return { status: result.status, headers: new Headers({ "content-length": "10" }), arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(result.body)).buffer };
  };
}
function adapter(opts: { currency: string; handler: (url: string, init: any) => any }) {
  return new LootPagluAdapter({ baseUrl: "https://lootpaglu.in", apiKey: "test", currency: opts.currency, currencyDecimals: 2, fetcher: mockFetch(opts.handler) as any });
}

console.log("== decimalToMinorRounded ==");
check("0.125 → 0.13", decimalToMinorRounded("0.125", 2), "13");
check("0.124 → 0.12", decimalToMinorRounded("0.124", 2), "12");
check("0.999 → 1.00", decimalToMinorRounded("0.999", 2), "100");
check("1e-7 → 0.00", decimalToMinorRounded(1e-7, 2), "0");
check("1.5e3 → 1500.00", decimalToMinorRounded("1.5e3", 2), "150000");
check("1,500.50 → 1500.50", decimalToMinorRounded("1,500.50", 2), "150050");
check("1500.567 → 1500.57", decimalToMinorRounded(1500.567, 2), "150057");
check("5.123456 → 5.12", decimalToMinorRounded(5.123456, 2), "512");
check("0.5 → 0.50", decimalToMinorRounded("0.5", 2), "50");
check("整数 50 → 50.00", decimalToMinorRounded(50, 2), "5000");

console.log("== 测试连接：用户实测的报错场景 ==");
{
  // 加密钱包余额带 6 位小数（真实场景），之前会抛 invalid_supplier_money
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { userId: 1, wallet_inr: 1500.5, wallet_crypto: 5.123456, total_spent: 100 } }) });
  check("USD 钱包 5.123456 → 余额 512", await a.testConnection(), { siteName: "Loot Paglu", balance: { amountMinor: "512", currency: "USD" } });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { userId: 1, wallet_inr: 1500.567, wallet_crypto: 5.5, total_spent: 100 } }) });
  check("INR 钱包 1500.567 → 余额 150057", await a.testConnection(), { siteName: "Loot Paglu", balance: { amountMinor: "150057", currency: "INR" } });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { userId: 1, wallet_inr: "1,500.50", wallet_crypto: 5.5 } }) });
  check("INR 钱包字符串 1,500.50 → 余额 150050", await a.testConnection(), { siteName: "Loot Paglu", balance: { amountMinor: "150050", currency: "INR" } });
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { userId: 1, wallet_inr: 1500.5, wallet_crypto: 1e-7 } }) });
  check("USD 钱包科学计数法 1e-7 → 余额 0", await a.testConnection(), { siteName: "Loot Paglu", balance: { amountMinor: "0", currency: "USD" } });
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 401, body: { error: "Invalid API key" } }) });
  await checkThrows("401 → 账号认证失败", () => a.testConnection(), "supplier_account_auth_failed");
}

console.log("== 获取商品：宽容解析（真实响应字段名/层级可能与文档不一致）==");
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { status: "success", services: [{ service_id: "Paglu_1", name: "Duolingo Super 12M", available_stock: 39, prices: { upiPrice: 50, cryptoPrice: 0.123456 } }] } }) });
  check("文档形状 cryptoPrice 0.123456 → 成本 12", await a.listProducts({ page: 1, pageSize: 50 }), { total: 1, products: [{ id: "Paglu_1", name: "Duolingo Super 12M", description: "", imageUrls: [], categoryNames: [], active: true, skus: [{ id: "Paglu_1", name: "Duolingo Super 12M", costMinor: "12", stockQuantity: 39, active: true }] }] });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { status: "success", services: [{ service_id: 123, name: "数字 ID", available_stock: "39", prices: { upiPrice: "50.567", cryptoPrice: 0.5 } }] } }) });
  const result = await a.listProducts({ page: 1, pageSize: 50 });
  check("service_id 数字 123 → 字符串", result.products[0].id, "123");
  check("available_stock 字符串 39 → 数字", result.products[0].skus[0].stockQuantity, 39);
  check("upiPrice 字符串 50.567 → 成本 5057", result.products[0].skus[0].costMinor, "5057");
}
{
  // 外层包 data.services
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { data: { services: [{ service_id: "Paglu_9", name: "Wrapped", available_stock: 3, prices: { upiPrice: 10, cryptoPrice: 0.25 } }] } } }) });
  const result = await a.listProducts({ page: 1, pageSize: 50 });
  check("data.services 包裹 → 解析出商品", result.products[0].id, "Paglu_9");
}
{
  // 裸数组
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: [{ service_id: "Paglu_8", name: "Bare", available_stock: 2, prices: { upiPrice: 10, cryptoPrice: 0.3 } }] }) });
  check("裸数组 → 解析出商品", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].id, "Paglu_8");
}
{
  // 别名字段：id/title/stock + prices 用 upi/crypto
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { services: [{ id: "X1", title: "Alias", stock: 7, prices: { upi: 100, crypto: 1.25 } }] } }) });
  const result = await a.listProducts({ page: 1, pageSize: 50 });
  check("别名 id/title/stock/upi/crypto → 解析", [result.products[0].id, result.products[0].name, result.products[0].skus[0].stockQuantity, result.products[0].skus[0].costMinor], ["X1", "Alias", 7, "125"]);
}
{
  // 价格平铺在商品顶层
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { services: [{ service_id: "Flat1", name: "Flat", available_stock: 4, upiPrice: 60, cryptoPrice: 0.6 }] } }) });
  check("顶层平铺价格 → 解析", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].skus[0].costMinor, "6000");
}
{
  // 单个 price 双币种同价
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { services: [{ service_id: "Single1", name: "Single", available_stock: 4, price: 2.5 }] } }) });
  check("单个 price → 双币种同价", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].skus[0].costMinor, "250");
}
{
  // 缺库存字段 → 视为不限量
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { services: [{ service_id: "NoStock", name: "NoStock", prices: { upiPrice: 10, cryptoPrice: 0.2 } }] } }) });
  check("缺库存 → 不限量 2147483647", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].skus[0].stockQuantity, 2147483647);
}
{
  // 2026-10-14 修复：单个商品缺当前币种价格只跳过该商品，不让整个目录失败
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { status: "success", services: [{ service_id: "Good1", name: "Good", available_stock: 5, prices: { upiPrice: 50, cryptoPrice: 0.5 } }, { service_id: "Paglu_1", name: "无加密价", available_stock: 5, prices: { upiPrice: 50, cryptoPrice: null } }] } }) });
  const r = await a.listProducts({ page: 1, pageSize: 50 });
  check("缺价商品只跳过、不炸整单 → 只留 Good1", [r.total, r.products.map((p) => p.id)], [1, ["Good1"]]);
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { status: "success", services: [{ service_id: "Only1", name: "Only", available_stock: 5, prices: { upiPrice: 50 } }] } }) });
  await checkThrows("全部缺价 → 才抛错且带提示", () => a.listProducts({ page: 1, pageSize: 50 }), "invalid_supplier_response");
}
{
  // services 为对象字典
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { status: "success", services: { Paglu_1: { service_id: "Paglu_1", name: "Dict", available_stock: 3, prices: { upiPrice: 10, cryptoPrice: 0.2 } } } } }) });
  check("services 对象字典 → 解析", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].id, "Paglu_1");
}
{
  // 价格带货币符号
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { services: [{ service_id: "Sym1", name: "Sym", available_stock: 2, prices: { upiPrice: "₹50.00", cryptoPrice: "$0.50" } }] } }) });
  check("价格带符号 ₹/$ → 解析", (await a.listProducts({ page: 1, pageSize: 50 })).products[0].skus[0].costMinor, "50");
}
{
  // 200 但 success:false 应映射为认证失败，而非格式错
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { success: false, error: "Invalid or unapproved API key" } }) });
  await checkThrows("200+success:false → 认证失败", () => a.listProducts({ page: 1, pageSize: 50 }), "supplier_account_auth_failed");
}
{
  // baseUrl 带 /api/v1 后缀不应拼出双份路径
  let seenUrl = "";
  const a2 = new LootPagluAdapter({ baseUrl: "https://lootpaglu.in/api/v1", apiKey: "test", currency: "USD", currencyDecimals: 2, fetcher: mockFetch((url: string) => { seenUrl = url; return { status: 200, body: { services: [] } }; }) as any });
  await a2.listProducts({ page: 1, pageSize: 50 });
  check("baseUrl 带 /api/v1 → 不拼双份", seenUrl, "https://lootpaglu.in/api/v1/products");
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 403, body: { error: "Forbidden" } }) });
  await checkThrows("获取商品 403 → 账号认证失败", () => a.listProducts({ page: 1, pageSize: 50 }), "supplier_account_auth_failed");
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body: { status: "success" } }) });
  await checkThrows("缺 services 字段 → 格式错误（带实际结构）", () => a.listProducts({ page: 1, pageSize: 50 }), "invalid_supplier_response");
}
{
  const a = adapter({ currency: "USD", handler: () => ({ status: 401, body: { error: "Invalid API key" } }) });
  await checkThrows("获取商品 401 → 账号认证失败", () => a.listProducts({ page: 1, pageSize: 50 }), "supplier_account_auth_failed");
}

console.log("== 下单 / 对账 ==");
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { status: "success", success: true, order_id: "api_1", products: [123, "CODE-B"] } }) });
  check("下单 products 含数字 → 转字符串", await a.submitOrder({ skuId: "Paglu_1", quantity: 1, requestNo: "cffk-1-1", callbackUrl: "", traceId: "t" }), { status: "supplied", upstreamOrderId: "api_1", cards: ["123", "CODE-B"] });
}
{
  // 下单响应别名：id + codes
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { id: "api_2", codes: ["C1", "C2"] } }) });
  check("下单别名 id/codes → 解析", await a.submitOrder({ skuId: "Paglu_1", quantity: 1, requestNo: "cffk-1-1", callbackUrl: "", traceId: "t" }), { status: "supplied", upstreamOrderId: "api_2", cards: ["C1", "C2"] });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 400, body: { error: "Insufficient INR wallet balance" } }) });
  check("余额不足 → definitively_failed", await a.submitOrder({ skuId: "Paglu_1", quantity: 1, requestNo: "cffk-1-1", callbackUrl: "", traceId: "t" }), { status: "definitively_failed", errorCode: "supplier_balance_insufficient" });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 400, body: { error: "Out of stock! Only 0 available" } }) });
  check("缺货 → definitively_failed", await a.submitOrder({ skuId: "Paglu_1", quantity: 1, requestNo: "cffk-1-1", callbackUrl: "", traceId: "t" }), { status: "definitively_failed", errorCode: "supplier_stock_insufficient" });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { success: true, order: { order_id: "api_1", status: "success", delivered_products: [456] } } }) });
  check("对账 delivered_products 含数字 → 转字符串", await a.reconcileOrder({ upstreamOrderId: "api_1", skuId: "Paglu_1", quantity: 1, requestNo: "r", callbackUrl: "", traceId: "t" }), { status: "supplied", upstreamOrderId: "api_1", cards: ["456"] });
}
{
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body: { success: true, order: { order_id: "api_1", status: "processing", delivered_products: [] } } }) });
  check("对账处理中 → processing", await a.reconcileOrder({ upstreamOrderId: "api_1", skuId: "Paglu_1", quantity: 1, requestNo: "r", callbackUrl: "", traceId: "t" }), { status: "processing", upstreamOrderId: "api_1" });
}

console.log("== 数量阶梯价 slots（只取第一档）==");
{
  // 真实响应：Paglu_7 只有 slots 没有 prices，USD 账号取第一档 cryptoPrice 0.5
  const body = { status: "success", services: [{ service_id: "Paglu_7", name: "Gemini 18M Pro (Reactivation Links)", available_stock: 61, accepted_currencies: ["inr", "crypto"], slots: [{ min: 1, max: 10, upiPrice: 50, cryptoPrice: 0.5 }, { min: 11, max: null, upiPrice: 45, cryptoPrice: 0.45 }] }] };
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body }) });
  const r = await a.listProducts({ page: 1, pageSize: 50 });
  check("slots 第一档 cryptoPrice 0.5 → 成本 50", r.products[0]?.skus[0]?.costMinor, "50");
  check("slots 商品不被跳过", r.total, 1);
}
{
  // INR 账号取第一档 upiPrice 50
  const body = { status: "success", services: [{ service_id: "Paglu_7", name: "Gemini 18M Pro", available_stock: 61, slots: [{ min: 1, max: 10, upiPrice: 50, cryptoPrice: 0.5 }, { min: 11, max: null, upiPrice: 45, cryptoPrice: 0.45 }] }] };
  const a = adapter({ currency: "INR", handler: () => ({ status: 200, body }) });
  const r = await a.listProducts({ page: 1, pageSize: 50 });
  check("slots 第一档 upiPrice 50 → 成本 5000", r.products[0]?.skus[0]?.costMinor, "5000");
}
{
  // prices 与 slots 同时存在时优先 prices
  const body = { status: "success", services: [{ service_id: "Paglu_8", name: "混合", available_stock: 10, prices: { cryptoPrice: 0.2 }, slots: [{ min: 1, max: 10, upiPrice: 50, cryptoPrice: 0.5 }] }] };
  const a = adapter({ currency: "USD", handler: () => ({ status: 200, body }) });
  const r = await a.listProducts({ page: 1, pageSize: 50 });
  check("prices 优先于 slots（0.2 → 20）", r.products[0]?.skus[0]?.costMinor, "20");
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed ? 1 : 0);
