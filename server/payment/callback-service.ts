

import { reportUnexpectedServerError } from "@/server/error-handling";
import { getPaymentProvider } from "./config";
import { PaymentFlowService } from "./flow-service";
import { PaymentLogService } from "./log-service";
import { paymentRepository } from "./repository";
import { getProviderDefinition } from "./registry";
import type { PaymentProviderKind } from "./registry";

export function paymentCallbackResponse(ok: boolean) {
  return { body: ok ? "success" : "fail", contentType: "text/plain", status: ok ? 200 : 400 };
}

export class PaymentCallbackService {
  constructor(private readonly database: D1Database, private readonly runtime: Record<string, unknown> = {}) {}

  async handle(provider: PaymentProviderKind, input: { payload: Record<string, string>; rawBody?: string; rawBodyBytes?: Uint8Array; headers?: Headers }) {
    const logs = new PaymentLogService(this.database);
    const configured = await getPaymentProvider(this.database, provider);
    if (!configured || configured.configStatus !== "valid") {
      await logs.writeBestEffort({ provider, eventType: "NOTIFY", verifyStatus: "FAILED", message: "PAYMENT_PROVIDER_NOT_AVAILABLE", payload: input.payload });
      return this.response(provider, false, input);
    }
    const definition = getProviderDefinition(provider);
    if (!definition) return this.response(provider, false, input);
    let result;
    try {
      const config = JSON.parse(configured.configJson) as Record<string, unknown>;
      result = await definition.createAdapter(config).verify(input);
    } catch (cause) {
      reportUnexpectedServerError("payment-callback-verify", cause, { provider });
      await logs.writeBestEffort({ provider, eventType: "NOTIFY", verifyStatus: "FAILED", message: "PAYMENT_CALLBACK_INVALID", payload: input.payload });
      return this.response(provider, false, input);
    }
    const config = JSON.parse(configured.configJson) as Record<string, unknown>;
    const expectedCurrency = typeof config.currency === "string" ? config.currency.toUpperCase() : undefined;
    const record = result.orderNo ? await paymentRepository(this.database).findOrder(result.orderNo, provider) : null;
    const attempt = record ? await paymentRepository(this.database).findMatchingAttempt(record.id, provider, result.paymentOrderNo) : null;
    if (provider === "PERPAY" && result.verified && result.message === "PERPAY_REFUND_UPDATED") {
      await logs.writeBestEffort({ orderId: record?.id, provider, orderNo: result.orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "VERIFIED", message: result.message, payload: input.payload });
      return this.response(provider, true, input);
    }
    const amountMatches = result.amount !== undefined && record != null && result.amount === record.amount;
    const currencyMatches = !expectedCurrency || (result.currency !== undefined && result.currency.toUpperCase() === expectedCurrency);
    const callbackMatches = result.verified
      && result.orderNo
      && record
      && attempt
      && amountMatches
      && currencyMatches
      && record.paymentStatus !== "FAILED"
      && result.status === "PAID";
    if (!callbackMatches) {
      // 幂等回执:签名有效、订单已按相同金额确认收款,直接回 success 让上游停止重试,
      // 避免已付款订单的异步通知反复失败刷屏(支付宝约 4 天 25 次重试)。
      // 注意:不能要求通知解析出的状态为 PAID。支付宝对同一笔已付款订单可能重发
      // 非支付结果类通知(如退款结果、交易关闭同步),适配器会把未知 trade_status
      // 映射为 FAILED;此时以订单自身的已付款状态为准,直接回 success。
      if (result.verified && record && amountMatches && record.paymentStatus === "PAID") {
        const notifyStatusSuffix = result.status === "PAID" ? "" : `:notify-status=${result.status ?? "unknown"}`;
        await logs.writeBestEffort({ orderId: record.id, provider, orderNo: result.orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "VERIFIED", message: `PAYMENT_CALLBACK_ALREADY_PAID${notifyStatusSuffix}`, payload: input.payload });
        return this.response(provider, true, input);
      }
      const mismatchReason = !result.verified ? "verify-failed"
        : !result.orderNo ? "missing-order-no"
        : !record ? "order-not-found"
        : !attempt ? "attempt-not-found"
        : !amountMatches ? `amount-mismatch:notify=${result.amount}:order=${record.amount}`
        : !currencyMatches ? "currency-mismatch"
        : record.paymentStatus === "FAILED" ? "order-failed"
        : result.status !== "PAID" ? `status-not-paid:${result.status}`
        : "unknown";
      await logs.writeBestEffort({ orderId: record?.id, provider, orderNo: result.orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "FAILED", message: `PAYMENT_CALLBACK_INVALID:${mismatchReason}`, payload: input.payload });
      return this.response(provider, false, input);
    }
    if (!record || !result.orderNo || result.amount === undefined) return this.response(provider, false, input);
    const orderNo = result.orderNo;

    try {
      const outcome = await new PaymentFlowService(this.database, this.runtime).confirm(orderNo, "CALLBACK", result.amount, attempt!.id);
      if (outcome === "NOT_PAYABLE") {
        await logs.writeBestEffort({ orderId: record.id, provider, orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "FAILED", message: "PAYMENT_CALLBACK_NOT_PAYABLE", payload: input.payload });
        return this.response(provider, false, input);
      }
      await logs.writeBestEffort({ orderId: record.id, provider, orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "VERIFIED", message: outcome, payload: input.payload });
      return this.response(provider, outcome === "CONFIRMED" || outcome === "DELIVERY_PENDING" || outcome === "DELIVERY_FAILED" || outcome === "ALREADY_PAID" || outcome === "PAYMENT_EXCEPTION", input);
    } catch (cause) {
      reportUnexpectedServerError("payment-callback-confirm", cause, { provider, orderNo });
      await logs.writeBestEffort({ orderId: record.id, provider, orderNo, paymentOrderNo: result.paymentOrderNo, eventType: "NOTIFY", verifyStatus: "FAILED", message: "PAYMENT_CONFIRM_FAILED", payload: input.payload });
      return this.response(provider, false, input);
    }
  }

  private response(provider: PaymentProviderKind, ok: boolean, metadata?: { headers?: Headers }) {
    if (provider === "PERPAY") return { body: JSON.stringify({ schema: "perpay:webhook-ack:v1", ack: ok, event_id: metadata?.headers?.get("X-PerPay-Webhook-Event-Id") ?? "", delivery_id: metadata?.headers?.get("X-PerPay-Webhook-Delivery-Id") ?? "" }), contentType: "application/json", status: ok ? 200 : 400 };
    return paymentCallbackResponse(ok);
  }
}
