// 回归测试:支付宝异步通知的幂等回执与失败原因诊断。
// 背景:已付款订单的支付宝异步通知曾因匹配失败被回 "fail",导致支付宝按退避计划
// 重试约 4 天、每次重试都写一条 PAYMENT_CALLBACK_INVALID 日志刷屏。
import { generateKeyPairSync, sign as signData } from "node:crypto";
// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { test } from "bun:test";
// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { Database } from "bun:sqlite";
import assert from "node:assert/strict";
import { canonicalizeAlipayParameters } from "../../lib/payment-utils";
import { PaymentCallbackService } from "../../server/payment/callback-service";
import { createTestDatabase } from "../helpers/sqlite-d1";

const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privatePem = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = keyPair.publicKey.export({ type: "spki", format: "pem" }).toString();

function rawPemBody(pem: string) {
  return pem.replace(/-----BEGIN [^-]+-----/g, "").replace(/-----END [^-]+-----/g, "").replace(/\s+/g, "");
}

function setupDb() {
  // createTestDatabase 已应用 0000-0006 + 0008，无需重复执行迁移。
  const { database, sqlite } = createTestDatabase();
  return { database: database as unknown as D1Database, sqlite: sqlite as Database };
}

function seedOrder(sqlite: Database, orderNo: string, paid: boolean, withAttempt: boolean) {
  const now = Date.now();
  const configJson = JSON.stringify({
    schemaVersion: 1,
    modes: ["web"],
    baseUrl: "https://openapi.alipay.example",
    appId: "test-app",
    sellerId: "test-seller",
    privateKey: privatePem,
    alipayPublicKey: rawPemBody(publicPem),
    notifyUrl: "https://shop.example/api/payments/alipay/notify",
    returnUrl: "https://shop.example/payment-result",
  });
  sqlite.query("INSERT INTO paymentProvider (provider, name, isEnabled, sort, configJson, createdAt, updatedAt) VALUES ('ALIPAY', 'Alipay', 1, 0, ?, ?, ?)").run(configJson, now, now);
  sqlite.query("INSERT INTO `order` (orderNo, productNameSnapshot, unitPrice, quantity, amount, paymentProvider, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (?, 'Test', 1, 1, 1, 'ALIPAY', 'MANUAL', ?, ?, 'NOT_DELIVERED', ?, ?)").run(orderNo, paid ? "PAID" : "PENDING", paid ? "PAID" : "UNPAID", now, now);
  const row = sqlite.query("SELECT id FROM `order` WHERE orderNo = ?").get(orderNo) as { id: number };
  if (withAttempt) {
    sqlite.query("INSERT INTO paymentAttempt (orderId, provider, channel, paymentOrderNo, status, createdAt, updatedAt) VALUES (?, 'ALIPAY', 'web', ?, ?, ?, ?)").run(row.id, orderNo, paid ? "PAID" : "PENDING", now, now);
  }
  return row.id;
}

function signedNotify(orderNo: string, tradeStatus = "TRADE_SUCCESS"): Record<string, string> {
  const payload: Record<string, string> = {
    app_id: "test-app",
    out_trade_no: orderNo,
    trade_no: "2026101522001412345678",
    total_amount: "0.01",
    trade_status: tradeStatus,
    seller_id: "test-seller",
    sign_type: "RSA2",
    charset: "utf-8",
  };
  const sign = signData("RSA-SHA256", Buffer.from(canonicalizeAlipayParameters(payload, true)), privatePem).toString("base64");
  return { ...payload, sign };
}

async function handleNotify(database: D1Database, orderNo: string, tradeStatus?: string) {
  const service = new PaymentCallbackService(database, {});
  return service.handle("ALIPAY", { payload: signedNotify(orderNo, tradeStatus) });
}

function lastLog(sqlite: Database) {
  return sqlite.query("SELECT verifyStatus, message FROM paymentLog ORDER BY id DESC LIMIT 1").get() as { verifyStatus: string; message: string };
}

test("未付款订单的支付宝通知走正常确认并回 success", async () => {
  const { database, sqlite } = setupDb();
  seedOrder(sqlite, "ORD-CB-1", false, true);
  const response = await handleNotify(database, "ORD-CB-1");
  assert.equal(response.body, "success");
  assert.equal(response.status, 200);
  const log = lastLog(sqlite);
  assert.equal(log.verifyStatus, "VERIFIED");
  assert.equal(log.message, "CONFIRMED");
  sqlite.close();
});

test("已付款订单的支付宝通知直接回 success(幂等,不再确认)", async () => {
  const { database, sqlite } = setupDb();
  seedOrder(sqlite, "ORD-CB-2", true, true);
  const response = await handleNotify(database, "ORD-CB-2");
  assert.equal(response.body, "success");
  assert.equal(response.status, 200);
  const log = lastLog(sqlite);
  assert.equal(log.verifyStatus, "VERIFIED");
  assert.equal(log.message, "ALREADY_PAID");
  sqlite.close();
});

test("已付款但缺少支付尝试的订单,签名有效通知也回 success 停止上游重试", async () => {
  const { database, sqlite } = setupDb();
  seedOrder(sqlite, "ORD-CB-3", true, false);
  const response = await handleNotify(database, "ORD-CB-3");
  assert.equal(response.body, "success");
  assert.equal(response.status, 200);
  const log = lastLog(sqlite);
  assert.equal(log.verifyStatus, "VERIFIED");
  assert.equal(log.message, "PAYMENT_CALLBACK_ALREADY_PAID");
  sqlite.close();
});

test("未付款且缺少支付尝试的通知回 fail,并记录具体失败原因", async () => {
  const { database, sqlite } = setupDb();
  seedOrder(sqlite, "ORD-CB-4", false, false);
  const response = await handleNotify(database, "ORD-CB-4");
  assert.equal(response.body, "fail");
  assert.equal(response.status, 400);
  const log = lastLog(sqlite);
  assert.equal(log.verifyStatus, "FAILED");
  assert.ok(log.message.includes("attempt-not-found"), `unexpected message: ${log.message}`);
  sqlite.close();
});

test("已付款订单收到签名有效的非支付结果通知(如退款/关闭同步)也回 success,不再刷屏", async () => {
  // 线上真实场景:已付款订单的异步通知 trade_status 非 TRADE_SUCCESS/ TRADE_FINISHED,
  // 适配器解析为 FAILED。旧逻辑要求通知状态为 PAID 才幂等回 success,导致 400 刷屏。
  const { database, sqlite } = setupDb();
  seedOrder(sqlite, "ORD-CB-5", true, true);
  const response = await handleNotify(database, "ORD-CB-5", "TRADE_CLOSED");
  assert.equal(response.body, "success");
  assert.equal(response.status, 200);
  const log = lastLog(sqlite);
  assert.equal(log.verifyStatus, "VERIFIED");
  assert.ok(log.message.startsWith("PAYMENT_CALLBACK_ALREADY_PAID"), `unexpected message: ${log.message}`);
  assert.ok(log.message.includes("notify-status=FAILED"), `unexpected message: ${log.message}`);
  sqlite.close();
});
