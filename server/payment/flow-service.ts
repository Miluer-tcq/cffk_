import { and, count, eq, isNotNull, isNull } from "drizzle-orm";
import { getContext } from "telefunc";
import { createDrizzleDb } from "@/database/drizzle";
import { card, order, productSku } from "@/database/drizzle/schema";
import { appError } from "@/lib/app-error";
import { normalizeOrderEmail } from "@/lib/local-orders";
import { reportUnexpectedServerError } from "@/server/error-handling";
import { enqueueOrderEvent } from "@/server/email/order-events";
import { closePendingOrder, confirmOrderPayment, createOrder, type CreateOrderInput } from "@/server/order/service";
import { getEnabledPaymentProvider, getPaymentProviderById } from "./config";
import { getSiteSettings } from "@/server/site/public-settings";
import { getProviderDefinition, resolvePaymentUrls } from "./registry";
import { PaymentLogService } from "./log-service";
import { paymentRepository } from "./repository";
import type { PaymentCreateInput, PaymentCreateResult } from "./types";
import type { PaymentChannel, PaymentProviderKind } from "./registry";
import { parseManualUsdtConfig } from "@/lib/config-schemas";
import { buildStablecoinQrUri, probeFreeOffsetUnits, stablecoinOffsetUnits } from "./stablecoin";

type RuntimeContext = {
  env?: Record<string, unknown> & { DB?: D1Database };
  user?: { id: string } | null;
};

function safePaymentCreateError(cause: unknown) {
  if (!(cause instanceof Error)) return "PAYMENT_CREATE_FAILED";
  if (/^[A-Z][A-Z0-9_:-]+$/.test(cause.message) && cause.message.length <= 120) return cause.message;
  const name = cause.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
  const detail = cause.message.replace(/https?:\/\/[^\s]+/gi, "[url]").replace(/[A-Za-z0-9_-]{32,}/g, "[token]").replace(/\s+/g, " ").trim().slice(0, 100);
  return name ? `PAYMENT_RUNTIME_${name}${detail ? `:${detail}` : ""}` : "PAYMENT_CREATE_FAILED";
}

function paymentReturnUrl(value: unknown, orderNo: string) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const url = new URL(raw);
  url.search = "";
  url.hash = "";
  url.searchParams.set("orderNo", orderNo);
  return url.toString();
}

function orderAccess(ownerUserId: string | null, email?: string) {
  const normalizedEmail = normalizeOrderEmail(email ?? "");
  if (normalizedEmail) {
    return and(
      isNull(order.ownerUserId),
      eq(order.contactType, "EMAIL"),
      eq(order.contactEmailNormalized, normalizedEmail),
    );
  }
  return ownerUserId ? eq(order.ownerUserId, ownerUserId) : null;
}

export class PaymentFlowService {
  constructor(private readonly database: D1Database, private readonly runtime: Record<string, unknown> = {}) {}

  async create(input: PaymentCreateInput, ownerUserId: string | null): Promise<PaymentCreateResult> {
    const definition = getProviderDefinition(input.paymentProvider);
    if (!definition) appError("PAYMENT_PROVIDER_NOT_AVAILABLE");
    const provider = input.paymentProviderId
      ? await getPaymentProviderById(this.database, input.paymentProviderId)
      : await getEnabledPaymentProvider(this.database, input.paymentProvider);
    if (!provider || !provider.isEnabled || provider.configStatus !== "valid") appError("PAYMENT_PROVIDER_NOT_AVAILABLE");
    if (input.paymentProviderId && provider.provider !== input.paymentProvider) appError("PAYMENT_PROVIDER_NOT_AVAILABLE");
    const channel = input.paymentChannel ?? provider.channels[0];
    if (provider.channels.length > 0 && (!channel || !provider.channels.includes(channel))) appError("PAYMENT_CHANNEL_INVALID");
    // 稳定币收款:校验用户选择的链/资产是否在该渠道启用范围内,默认取第一个
    let stablecoinChain: string | undefined;
    let stablecoinAsset: string | undefined;
    if (input.paymentProvider === "MANUAL_USDT") {
      const parsed = parseManualUsdtConfig(provider.configJson);
      stablecoinChain = input.paymentChain && parsed.chains.includes(input.paymentChain) ? input.paymentChain : parsed.chains[0];
      stablecoinAsset = input.paymentAsset && parsed.assets.includes(input.paymentAsset) ? input.paymentAsset : parsed.assets[0];
      if (!stablecoinChain || !stablecoinAsset) appError("PAYMENT_CHANNEL_INVALID");
    }
    // For MANUAL_USDT, store the provider ID in paymentChannel so the monitor knows which wallet to check
    const orderChannel = input.paymentProvider === "MANUAL_USDT" ? String(provider.id) : channel;
    const created = await createOrder(this.database, { ...input, paymentChannel: orderChannel, paymentChain: stablecoinChain, paymentAsset: stablecoinAsset, allowPendingPayment: true } as CreateOrderInput, ownerUserId);
    const logs = new PaymentLogService(this.database);
    if (created.amount === 0) {
      try {
        const outcome = await this.confirm(created.orderNo, "ZERO_AMOUNT");
        if (outcome !== "CONFIRMED" && outcome !== "ALREADY_PAID" && outcome !== "DELIVERY_PENDING") {
          appError(outcome === "DELIVERY_FAILED" ? "SUPPLIER_PURCHASE_UNAVAILABLE" : "PAYMENT_CONFIRM_FAILED");
        }
        return { ...created, payment: null, paymentStatus: "PAID" };
      } catch (cause) {
        await closePendingOrder(this.database, created.id).catch((closeCause) => reportUnexpectedServerError("payment-close-zero-order-failed", closeCause, { orderId: created.id, orderNo: created.orderNo }));
        throw cause;
      }
    }
    const repository = paymentRepository(this.database);
    const attemptId = await repository.createAttempt({ orderId: created.id, provider: provider.provider, channel });
    if (attemptId === null) {
      await closePendingOrder(this.database, created.id).catch((cause) => reportUnexpectedServerError("payment-attempt-create-close-failed", cause, { orderId: created.id, orderNo: created.orderNo }));
      appError("PAYMENT_CREATE_FAILED");
    }
    try {
      const config = JSON.parse(provider.configJson) as Record<string, unknown>;
      const site = await getSiteSettings(this.database);
      const urls = resolvePaymentUrls(provider.provider, site.siteUrl, config);
      const adapter = definition.createAdapter(config);
      // 稳定币收款:把用户选择的链和资产传给适配器生成二维码(channel 格式 "链:资产")
      const adapterChannel = input.paymentProvider === "MANUAL_USDT" && stablecoinChain && stablecoinAsset
        ? `${stablecoinChain}:${stablecoinAsset}` as PaymentChannel
        : channel;
      let result = await adapter.create({ orderNo: created.orderNo, amount: created.amount, subject: `订单 ${created.orderNo}`, channel: adapterChannel, notifyUrl: urls.notifyUrl, returnUrl: paymentReturnUrl(urls.returnUrl, created.orderNo) });
      // 稳定币唯一金额去重:哈希偏移池只有 9999 个尾数,两个待支付订单可能派生出相同金额。
      // 下单时查同链同资产的待支付订单,已占用的尾数就顺延找空位,避免一笔转账同时匹配两单
      // (否则先检查的那单会把另一单的转账认领走,被冒领的订单只能人工处理)。
      if (input.paymentProvider === "MANUAL_USDT" && typeof result.tokenAmount === "number" && result.paymentChain && result.paymentAsset && result.walletAddress) {
        const finalAmount = await this.dedupeStablecoinAmount(result.paymentChain, result.paymentAsset, created.orderNo, result.tokenAmount);
        if (finalAmount !== result.tokenAmount) {
          result = { ...result, tokenAmount: finalAmount, payableAmount: Math.round(finalAmount * 100), qrCode: buildStablecoinQrUri({ chain: result.paymentChain, asset: result.paymentAsset, walletAddress: result.walletAddress, tokenAmount: finalAmount }) };
        }
      }
      await repository.completeAttempt(attemptId, result.paymentOrderNo);
      await logs.writeBestEffort({ orderId: created.id, provider: provider.provider, orderNo: created.orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "CREATE", verifyStatus: "PENDING", payload: result });
      // 稳定币:把唯一付款金额存入订单,链上检查时精确匹配用
      if (input.paymentProvider === "MANUAL_USDT" && typeof result.tokenAmount === "number") {
        const db = createDrizzleDb(this.database);
        await db.update(order).set({ paymentTokenAmount: result.tokenAmount }).where(eq(order.id, created.id)).catch(() => undefined);
      }
      return { ...created, payment: result };
    } catch (cause) {
      reportUnexpectedServerError("payment-create", cause, { orderId: created.id, orderNo: created.orderNo, provider: provider.provider });
      await repository.failAttempt(attemptId).catch(() => undefined);
      await logs.writeBestEffort({ orderId: created.id, provider: provider.provider, orderNo: created.orderNo, eventType: "CREATE_FAILED", verifyStatus: "FAILED", message: safePaymentCreateError(cause), payload: { error: safePaymentCreateError(cause) } });
      await closePendingOrder(this.database, created.id).catch((closeCause) => reportUnexpectedServerError("payment-close-failed-order", closeCause, { orderId: created.id, orderNo: created.orderNo }));
      appError("PAYMENT_CREATE_FAILED");
    }
  }

  async resume(orderNo: string, ownerUserId: string | null, email?: string): Promise<PaymentCreateResult> {
    const access = orderAccess(ownerUserId, email);
    if (!orderNo.trim() || !access) appError("ORDER_NOT_FOUND");
    const db = createDrizzleDb(this.database);
    const [record] = await db
      .select({ id: order.id, orderNo: order.orderNo, amount: order.amount, quantity: order.quantity, productId: order.productId, productSkuId: order.productSkuId, deliveryType: order.deliveryTypeSnapshot, physicalStockReserved: order.physicalStockReserved, paymentProvider: order.paymentProvider, paymentChannel: order.paymentChannel, paymentChain: order.paymentChain, paymentAsset: order.paymentAsset, paymentTokenAmount: order.paymentTokenAmount })
      .from(order)
      .where(and(eq(order.orderNo, orderNo.trim()), access, eq(order.status, "PENDING"), eq(order.paymentStatus, "UNPAID")))
      .limit(1);
    if (!record) appError("ORDER_NOT_FOUND");

    if (record.deliveryType === "CARD_AUTO") {
      if (record.productSkuId === null) appError("PRODUCT_SKU_NOT_AVAILABLE");
      const [stock] = await db.select({ available: count() }).from(card).where(and(eq(card.productSkuId, record.productSkuId), eq(card.status, "UNUSED")));
      if ((stock?.available ?? 0) < record.quantity) appError("PRODUCT_STOCK_NOT_ENOUGH");
    } else if ((record.deliveryType === "MANUAL" || record.deliveryType === "EXPRESS") && !record.physicalStockReserved) {
      if (record.productSkuId === null) appError("PRODUCT_SKU_NOT_AVAILABLE");
      const [sku] = await db.select({ physicalStock: productSku.physicalStock }).from(productSku).where(eq(productSku.id, record.productSkuId)).limit(1);
      if (sku?.physicalStock !== null && (sku?.physicalStock ?? 0) < record.quantity) appError("PRODUCT_STOCK_NOT_ENOUGH");
    }

    const provider = await getEnabledPaymentProvider(this.database, record.paymentProvider as PaymentProviderKind);
    const definition = provider && getProviderDefinition(provider.provider);
    if (!provider || !definition) appError("PAYMENT_PROVIDER_NOT_AVAILABLE");

    const repository = paymentRepository(this.database);
    const attemptId = await repository.createAttempt({ orderId: record.id, provider: provider.provider, channel: record.paymentChannel });
    if (attemptId === null) appError("PAYMENT_CREATE_FAILED");
    try {
      const config = JSON.parse(provider.configJson) as Record<string, unknown>;
      const site = await getSiteSettings(this.database);
      const urls = resolvePaymentUrls(provider.provider, site.siteUrl, config);
      // 稳定币收款:恢复支付时用订单里保存的链/资产(老订单回退到渠道配置)
      let resumeChannel = record.paymentChannel as PaymentChannel | undefined;
      let exactTokenAmount: number | undefined;
      if (record.paymentProvider === "MANUAL_USDT") {
        const parsed = parseManualUsdtConfig(provider.configJson);
        const chain = record.paymentChain && parsed.chains.includes(record.paymentChain) ? record.paymentChain : parsed.chains[0];
        const asset = record.paymentAsset && parsed.assets.includes(record.paymentAsset) ? record.paymentAsset : parsed.assets[0];
        if (chain && asset) resumeChannel = `${chain}:${asset}` as PaymentChannel;
        // 老订单没有唯一金额时,用旧公式回填并固定,避免恢复支付时金额变化
        if (typeof record.paymentTokenAmount === "number" && record.paymentTokenAmount > 0) {
          exactTokenAmount = record.paymentTokenAmount;
        } else {
          const rate = Number(parsed.exchangeRate) || 7.2;
          exactTokenAmount = Number(((record.amount / 100) / rate).toFixed(2));
          await db.update(order).set({ paymentTokenAmount: exactTokenAmount }).where(eq(order.id, record.id)).catch(() => undefined);
        }
      }
      const payment = await definition.createAdapter(config).create({ orderNo: record.orderNo, amount: record.amount, subject: `订单 ${record.orderNo}`, channel: resumeChannel, notifyUrl: urls.notifyUrl, returnUrl: paymentReturnUrl(urls.returnUrl, record.orderNo), exactTokenAmount });
      await repository.completeAttempt(attemptId, payment.paymentOrderNo);
      await new PaymentLogService(this.database).writeBestEffort({ orderId: record.id, provider: provider.provider, orderNo: record.orderNo, paymentOrderNo: payment.paymentOrderNo, eventType: "RESUME", verifyStatus: "PENDING", payload: payment });
      return { orderNo: record.orderNo, amount: record.amount, paymentStatus: "UNPAID", payment };
    } catch (cause) {
      reportUnexpectedServerError("payment-resume", cause, { orderId: record.id, orderNo: record.orderNo, provider: provider.provider });
      await repository.failAttempt(attemptId).catch(() => undefined);
      await new PaymentLogService(this.database).writeBestEffort({ orderId: record.id, provider: provider.provider, orderNo: record.orderNo, eventType: "RESUME_FAILED", verifyStatus: "FAILED", message: safePaymentCreateError(cause), payload: { error: safePaymentCreateError(cause) } });
      appError("PAYMENT_CREATE_FAILED");
    }
  }

  async confirm(orderNo: string, source: string, amount?: number, paymentAttemptId?: number) {
    const repository = paymentRepository(this.database);
    const record = await repository.findOrder(orderNo);
    if (!record) appError("ORDER_NOT_FOUND");
    if (amount !== undefined && amount !== record.amount) appError("PAYMENT_AMOUNT_MISMATCH");
    const attempt = paymentAttemptId ? await repository.findAttempt(paymentAttemptId) : null;
    if (paymentAttemptId && (!attempt || attempt.orderId !== record.id)) appError("PAYMENT_CALLBACK_INVALID");
    const duplicatePayment = Boolean(paymentAttemptId && attempt?.status !== "PAID" && await repository.hasOtherPaidAttempt(record.id, paymentAttemptId));
    const result = await confirmOrderPayment(this.database, record.id);
    if (paymentAttemptId && result.outcome !== "NOT_PAYABLE") await repository.markAttemptPaid(paymentAttemptId);

    let outcome = result.outcome;
    let exceptionMessage: string | null = null;
    if (result.outcome === "PAYMENT_EXCEPTION") exceptionMessage = "订单关闭后收到付款，请人工核对支付流水并退款或处理。";
    else if (duplicatePayment) {
      outcome = "PAYMENT_EXCEPTION";
      exceptionMessage = "同一订单收到多个支付尝试的付款，请人工核对并处理重复收款。";
    }
    if (exceptionMessage && paymentAttemptId) {
      await enqueueOrderEvent(this.database, { eventKey: `payment-exception:${paymentAttemptId}`, orderId: record.id, scene: "PAYMENT_EXCEPTION", errorMessage: exceptionMessage });
    }
    await new PaymentLogService(this.database).writeBestEffort({ orderId: record.id, provider: record.paymentProvider as never, orderNo, eventType: "CONFIRM", verifyStatus: outcome === "NOT_PAYABLE" ? "FAILED" : "VERIFIED", message: result.deliveryError ? `${outcome}:${result.deliveryError}` : outcome, payload: { source, paymentAttemptId, exceptionMessage } });
    return outcome;
  }

  async query(orderNo: string, ownerUserId: string | null, email?: string) {
    const queriedOrder = await (await import("@/server/order/service")).getOrderForQuery(this.database, orderNo, ownerUserId, email);
    if (!queriedOrder || queriedOrder.paymentStatus !== "UNPAID") return queriedOrder;
    const record = await paymentRepository(this.database).findOrder(orderNo);
    if (!record) return queriedOrder;
    const provider = await getEnabledPaymentProvider(this.database, record.paymentProvider as never);
    const definition = provider && getProviderDefinition(provider.provider);
    if (!provider || !definition) return queriedOrder;
    try {
      const adapter = definition.createAdapter(JSON.parse(provider.configJson) as Record<string, unknown>);
      if (!adapter.query) return queriedOrder;
      const attempt = await paymentRepository(this.database).latestAttempt(record.id);
      const result = await adapter.query({ orderNo, paymentOrderNo: attempt?.paymentOrderNo ?? undefined, amount: record.amount });
      if (result.verified && result.status === "PAID" && result.amount === record.amount) {
        await this.confirm(orderNo, "QUERY", result.amount, attempt?.id);
        return (await import("@/server/order/service")).getOrderForQuery(this.database, orderNo, ownerUserId, email);
      }
    } catch {
      // A query failure must leave the local pending order queryable and retryable.
    }
    return queriedOrder;
  }

  /**
   * 同链同资产的待支付订单里,确保付款金额不重复,返回最终金额。
   * 注意:调用时本订单的 paymentTokenAmount 尚未写入,查询结果不含自己,无需排除。
   */
  private async dedupeStablecoinAmount(chain: string, asset: string, orderNo: string, tokenAmount: number): Promise<number> {
    const db = createDrizzleDb(this.database);
    const micro = Math.round(tokenAmount * 1e6);
    const baseUnits = micro - stablecoinOffsetUnits(orderNo);
    const rows = await db
      .select({ paymentTokenAmount: order.paymentTokenAmount })
      .from(order)
      .where(and(
        eq(order.paymentProvider, "MANUAL_USDT"),
        eq(order.status, "PENDING"),
        eq(order.paymentStatus, "UNPAID"),
        eq(order.paymentChain, chain),
        eq(order.paymentAsset, asset),
        isNotNull(order.paymentTokenAmount),
      ))
      .limit(10000);
    const used = new Set<number>();
    for (const row of rows) {
      if (typeof row.paymentTokenAmount === "number") used.add(Math.round(row.paymentTokenAmount * 1e6));
    }
    const offset = probeFreeOffsetUnits(orderNo, baseUnits, used);
    return (baseUnits + offset) / 1e6;
  }
}

export function requirePaymentFlowService() {
  const context = getContext<RuntimeContext>();
  if (!context.env?.DB) appError("DATABASE_UNAVAILABLE");
  return new PaymentFlowService(context.env.DB, context.env);
}
