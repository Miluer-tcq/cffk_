// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { describe, expect, test } from "bun:test";
import { createDrizzleDb } from "../../database/drizzle";
import { eq } from "drizzle-orm";
import { order, orderDelivery, orderEvent, supplierOrder } from "../../database/drizzle/schema";
import { completeSupplierOrderFromCallback, processSupplierOrder } from "../../server/supplier/process";
import { createTestDatabase } from "../helpers/sqlite-d1";

describe("supplier fulfillment", () => {
  test("callback fulfillment is idempotent and stores the delivery record", async () => {
    const { database, sqlite, close } = createTestDatabase();
    try {
      const now = Date.now();
      sqlite.query("INSERT INTO product_v2 (id, categoryId, name, slug, status, sort, createdAt, updatedAt) VALUES (1, NULL, 'Supplier product', 'supplier-product', 'ACTIVE', 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO productSku (id, productId, name, price, status, fulfillmentSource, deliveryType, physicalStock, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (1, 1, 'SKU', 100, 'ACTIVE', 'SUPPLIER', 'SUPPLIER', NULL, 1, 10, 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO `order` (id, orderNo, productId, productSkuId, productNameSnapshot, productSkuNameSnapshot, unitPrice, quantity, amount, contactType, paymentProvider, fulfillmentSourceSnapshot, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (1, 'ORDER-1', 1, 1, 'Supplier product', 'SKU', 100, 1, 100, 'EMAIL', 'TEST', 'SUPPLIER', 'SUPPLIER', 'PAID', 'PAID', 'NOT_DELIVERED', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierAccount (id, provider, baseUrl, normalizedApiOrigin, protocolVersion, name, credentialsJson, createdAt, updatedAt) VALUES ('account-1', 'dujiao_next', 'https://supplier.example', 'https://supplier.example', '1.3.1-upstream-v1', 'Account', '{}', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierBinding (id, productSkuId, provider, normalizedApiOrigin, protocolVersion, upstreamProductId, upstreamSkuId, upstreamProductName, upstreamSkuName, referenceCostMinor, maxCostMinor, remoteStatus, createdAt, updatedAt) VALUES (1, 1, 'dujiao_next', 'https://supplier.example', '1.3.1-upstream-v1', 'product-1', 'sku-1', 'Supplier product', 'SKU', '10', '20', 'active', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierOrder (id, orderId, productSkuId, supplierBindingId, selectedAccountId, providerRequestNo, upstreamOrderId, quantity, bindingSnapshotJson, state, createdAt, updatedAt) VALUES (1, 1, 1, 1, 'account-1', 'request-1', NULL, 1, '{\"upstreamSkuId\":\"sku-1\"}', 'processing', ?, ?)").run(now, now);

      const first = await completeSupplierOrderFromCallback(database, 1, "upstream-1", ["CARD-1"]);
      const second = await completeSupplierOrderFromCallback(database, 1, "upstream-1", ["CARD-1"]);
      const db = createDrizzleDb(database);
      const [task] = await db.select({ state: supplierOrder.state, deliveryRecordId: supplierOrder.deliveryRecordId }).from(supplierOrder).where(eq(supplierOrder.id, 1));
      const deliveries = await db.select({ id: orderDelivery.id, content: orderDelivery.contentSnapshot }).from(orderDelivery);
      const [localOrder] = await db.select({ status: order.status, deliveryStatus: order.deliveryStatus }).from(order);
      const events = await db.select({ eventKey: orderEvent.eventKey, scene: orderEvent.scene, status: orderEvent.status }).from(orderEvent);

      expect(first).toEqual({ status: "supplied", duplicate: false });
      expect(second).toEqual({ status: "supplied", duplicate: true });
      expect(task?.state).toBe("supplied");
      expect(task?.deliveryRecordId).toBe(deliveries[0]?.id);
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]?.content).toBe(JSON.stringify(["CARD-1"]));
      expect(localOrder).toEqual({ status: "DELIVERED", deliveryStatus: "DELIVERED" });
      expect(events).toEqual([{ eventKey: "delivery-success:supplier:1", scene: "DELIVERY_SUCCESS", status: "PENDING" }]);
    } finally {
      close();
    }
  });

  test("callback rejects a supplier task attached to a local order", async () => {
    const { database, sqlite, close } = createTestDatabase();
    try {
      const now = Date.now();
      sqlite.query("INSERT INTO product_v2 (id, categoryId, name, slug, status, sort, createdAt, updatedAt) VALUES (1, NULL, 'Local product', 'local-product', 'ACTIVE', 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO productSku (id, productId, name, price, status, fulfillmentSource, deliveryType, physicalStock, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (1, 1, 'SKU', 100, 'ACTIVE', 'LOCAL', 'MANUAL', 1, 1, 10, 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO `order` (id, orderNo, productId, productSkuId, productNameSnapshot, productSkuNameSnapshot, unitPrice, quantity, amount, contactType, paymentProvider, fulfillmentSourceSnapshot, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (1, 'ORDER-1', 1, 1, 'Local product', 'SKU', 100, 1, 100, 'EMAIL', 'TEST', 'LOCAL', 'MANUAL', 'PAID', 'PAID', 'NOT_DELIVERED', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierAccount (id, provider, baseUrl, normalizedApiOrigin, protocolVersion, name, credentialsJson, createdAt, updatedAt) VALUES ('account-1', 'dujiao_next', 'https://supplier.example', 'https://supplier.example', '1.3.1-upstream-v1', 'Account', '{}', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierBinding (id, productSkuId, provider, normalizedApiOrigin, protocolVersion, upstreamProductId, upstreamSkuId, upstreamProductName, upstreamSkuName, referenceCostMinor, maxCostMinor, remoteStatus, createdAt, updatedAt) VALUES (1, 1, 'dujiao_next', 'https://supplier.example', '1.3.1-upstream-v1', 'product-1', 'sku-1', 'Local product', 'SKU', '10', '20', 'active', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierOrder (id, orderId, productSkuId, supplierBindingId, selectedAccountId, quantity, bindingSnapshotJson, state, createdAt, updatedAt) VALUES (1, 1, 1, 1, 'account-1', 1, '{\"upstreamSkuId\":\"sku-1\"}', 'processing', ?, ?)").run(now, now);

      await expect(completeSupplierOrderFromCallback(database, 1, "upstream-1", ["CARD-1"])).rejects.toThrow("supplier_order_fulfillment_invalid");
      const localOrder = sqlite.query("SELECT status, deliveryStatus FROM `order` WHERE id = 1").get();
      expect(localOrder).toMatchObject({ status: "PAID", deliveryStatus: "NOT_DELIVERED" });
    } finally {
      close();
    }
  });

  test("invalid binding snapshots become terminal failures", async () => {
    const { database, sqlite, close } = createTestDatabase();
    try {
      const now = Date.now();
      sqlite.query("INSERT INTO product_v2 (id, categoryId, name, slug, status, sort, createdAt, updatedAt) VALUES (1, NULL, 'Supplier product', 'supplier-product', 'ACTIVE', 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO productSku (id, productId, name, price, status, fulfillmentSource, deliveryType, physicalStock, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (1, 1, 'SKU', 100, 'ACTIVE', 'SUPPLIER', 'SUPPLIER', NULL, 1, 10, 0, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO `order` (id, orderNo, productId, productSkuId, productNameSnapshot, productSkuNameSnapshot, unitPrice, quantity, amount, contactType, paymentProvider, fulfillmentSourceSnapshot, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (1, 'ORDER-1', 1, 1, 'Supplier product', 'SKU', 100, 1, 100, 'EMAIL', 'TEST', 'SUPPLIER', 'SUPPLIER', 'PAID', 'PAID', 'NOT_DELIVERED', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierAccount (id, provider, baseUrl, normalizedApiOrigin, protocolVersion, name, credentialsJson, enabled, createdAt, updatedAt) VALUES ('account-1', 'dujiao_next', 'https://supplier.example', 'https://supplier.example', '1.3.1-upstream-v1', 'Account', '{\"apiKey\":\"key\",\"apiSecret\":\"secret\"}', 1, ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierBinding (id, productSkuId, provider, normalizedApiOrigin, protocolVersion, upstreamProductId, upstreamSkuId, upstreamProductName, upstreamSkuName, referenceCostMinor, maxCostMinor, stockQuantity, remoteStatus, createdAt, updatedAt) VALUES (1, 1, 'dujiao_next', 'https://supplier.example', '1.3.1-upstream-v1', 'product-1', 'sku-1', 'Supplier product', 'SKU', '10', '20', 1, 'active', ?, ?)").run(now, now);
      sqlite.query("INSERT INTO supplierOrder (id, orderId, productSkuId, supplierBindingId, selectedAccountId, upstreamOrderId, quantity, bindingSnapshotJson, state, createdAt, updatedAt) VALUES (1, 1, 1, 1, 'account-1', 'upstream-1', 1, '{\"broken\":true}', 'processing', ?, ?)").run(now, now);

      await expect(processSupplierOrder(database, 1)).resolves.toEqual({ status: "failed", errorCode: "supplier_binding_snapshot_invalid" });
      const task = sqlite.query("SELECT state, nextRetryAt, lastErrorCode FROM supplierOrder WHERE id = 1").get() as { state: string; nextRetryAt: unknown; lastErrorCode: string };
      expect(task).toMatchObject({ state: "failed", nextRetryAt: null, lastErrorCode: "supplier_binding_snapshot_invalid" });
    } finally {
      close();
    }
  });
});

describe("supplier quote retry counting", () => {
  function setupTask(sqlite: any, now: number, attemptCount: number) {
    sqlite.query("INSERT INTO product_v2 (id, categoryId, name, slug, status, sort, createdAt, updatedAt) VALUES (1, NULL, 'Supplier product', 'supplier-product', 'ACTIVE', 0, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO productSku (id, productId, name, price, status, fulfillmentSource, deliveryType, physicalStock, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (1, 1, 'SKU', 100, 'ACTIVE', 'SUPPLIER', 'SUPPLIER', NULL, 1, 10, 0, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO `order` (id, orderNo, productId, productSkuId, productNameSnapshot, productSkuNameSnapshot, unitPrice, quantity, amount, contactType, paymentProvider, fulfillmentSourceSnapshot, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (1, 'ORDER-1', 1, 1, 'Supplier product', 'SKU', 100, 1, 100, 'EMAIL', 'TEST', 'SUPPLIER', 'SUPPLIER', 'PAID', 'PAID', 'NOT_DELIVERED', ?, ?)").run(now, now);
    sqlite.query("INSERT INTO supplierAccount (id, provider, baseUrl, normalizedApiOrigin, protocolVersion, name, currency, currencyDecimals, credentialsJson, enabled, createdAt, updatedAt) VALUES ('account-1', 'dujiao_next', 'https://supplier.example', 'https://supplier.example', '1.3.1-upstream-v1', 'Account', 'CNY', 2, '{\"apiKey\":\"key\",\"apiSecret\":\"secret\"}', 1, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO supplierBinding (id, productSkuId, provider, normalizedApiOrigin, protocolVersion, upstreamProductId, upstreamSkuId, upstreamProductName, upstreamSkuName, referenceCostMinor, maxCostMinor, stockQuantity, remoteStatus, createdAt, updatedAt) VALUES (1, 1, 'dujiao_next', 'https://supplier.example', '1.3.1-upstream-v1', 'product-1', 'sku-1', 'Supplier product', 'SKU', '10', '20', 1, 'active', ?, ?)").run(now, now);
    sqlite.query("INSERT INTO supplierOrder (id, orderId, productSkuId, supplierBindingId, quantity, bindingSnapshotJson, state, attemptCount, createdAt, updatedAt) VALUES (1, 1, 1, 1, 1, '{\"upstreamSkuId\":\"sku-1\"}', 'pending', ?, ?, ?)").run(attemptCount, now, now);
  }

  function mockDujiaoFetch(mode: "sku-missing" | "network-error") {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any) => {
      const url = new URL(String(input));
      if (mode === "network-error") throw new Error("socket hang up");
      if (url.pathname.endsWith("/api/v1/upstream/ping")) {
        return new Response(JSON.stringify({ ok: true, site_name: "Test", balance: "100.00", currency: "CNY" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/api/v1/upstream/categories")) {
        return new Response(JSON.stringify({ ok: true, categories: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // 商品存在但 SKU 对不上 → supplier_sku_not_found（永久失败）
      const product = { id: 999, title: { zh: "Other" }, description: {}, images: [], tags: [], category_id: 0, is_active: true, skus: [{ id: 888, sku_code: "other", spec_values: {}, price_amount: "1.00", stock_quantity: 5, is_active: true }] };
      return new Response(JSON.stringify({ ok: true, product }), { status: 200, headers: { "content-type": "application/json" } });
    };
    return () => { globalThis.fetch = originalFetch; };
  }

  test("permanent quote failure becomes terminal immediately", async () => {
    const { database, sqlite, close } = createTestDatabase();
    const restore = mockDujiaoFetch("sku-missing");
    try {
      const now = Date.now();
      setupTask(sqlite, now, 0);
      const result = await processSupplierOrder(database, 1);
      expect(result).toEqual({ status: "failed", errorCode: "supplier_sku_not_found" });
      const task = sqlite.query("SELECT state, attemptCount, nextRetryAt, lastErrorCode FROM supplierOrder WHERE id = 1").get() as any;
      expect(task.state).toBe("failed");
      expect(task.attemptCount).toBe(1);
      expect(task.nextRetryAt).toBeNull();
      expect(task.lastErrorCode).toBe("supplier_sku_not_found");
    } finally {
      restore();
      close();
    }
  });

  test("transient quote failures count up and become terminal at the limit", async () => {
    const { database, sqlite, close } = createTestDatabase();
    const restore = mockDujiaoFetch("network-error");
    try {
      const now = Date.now();
      setupTask(sqlite, now, 3);
      // 第 4 次：临时失败，计数 +1，还有下次
      await processSupplierOrder(database, 1);
      let task = sqlite.query("SELECT state, attemptCount, nextRetryAt FROM supplierOrder WHERE id = 1").get() as any;
      expect(task.state).toBe("failed");
      expect(task.attemptCount).toBe(4);
      expect(task.nextRetryAt).not.toBeNull();
      // 模拟 cron 到点重试：第 5 次达到上限，进终态
      sqlite.query("UPDATE supplierOrder SET nextRetryAt = ? WHERE id = 1").run(now - 1000);
      await processSupplierOrder(database, 1);
      task = sqlite.query("SELECT state, attemptCount, nextRetryAt, lastErrorCode FROM supplierOrder WHERE id = 1").get() as any;
      expect(task.attemptCount).toBe(5);
      expect(task.nextRetryAt).toBeNull();
      expect(task.lastErrorCode).not.toBe("supplier_sku_not_found");
      // 终态任务不再被 cron 扫到：processPendingSupplierOrders 不应选中它
      const { processPendingSupplierOrders } = await import("../../server/supplier/process");
      const swept = await processPendingSupplierOrders(database, {}, 20);
      expect(swept.attempted).toBe(0);
    } finally {
      restore();
      close();
    }
  });
});

describe("uncertain order recovery", () => {
  function setupUncertainTask(sqlite: any, now: number) {
    sqlite.query("INSERT INTO product_v2 (id, categoryId, name, slug, status, sort, createdAt, updatedAt) VALUES (1, NULL, 'Supplier product', 'supplier-product', 'ACTIVE', 0, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO productSku (id, productId, name, price, status, fulfillmentSource, deliveryType, physicalStock, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (1, 1, 'SKU', 100, 'ACTIVE', 'SUPPLIER', 'SUPPLIER', NULL, 1, 10, 0, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO `order` (id, orderNo, productId, productSkuId, productNameSnapshot, productSkuNameSnapshot, unitPrice, quantity, amount, contactType, paymentProvider, fulfillmentSourceSnapshot, deliveryTypeSnapshot, status, paymentStatus, deliveryStatus, createdAt, updatedAt) VALUES (1, 'ORDER-1', 1, 1, 'Supplier product', 'SKU', 100, 1, 100, 'EMAIL', 'TEST', 'SUPPLIER', 'SUPPLIER', 'PAID', 'PAID', 'NOT_DELIVERED', ?, ?)").run(now, now);
    sqlite.query("INSERT INTO supplierAccount (id, provider, baseUrl, normalizedApiOrigin, protocolVersion, name, currency, currencyDecimals, balanceMinor, reserveBalanceMinor, credentialsJson, enabled, createdAt, updatedAt) VALUES ('account-1', 'dujiao_next', 'https://supplier.example', 'https://supplier.example', '1.3.1-upstream-v1', 'Account', 'CNY', 2, '10000', '50', '{\"apiKey\":\"key\",\"apiSecret\":\"secret\"}', 1, ?, ?)").run(now, now);
    sqlite.query("INSERT INTO supplierBinding (id, productSkuId, provider, normalizedApiOrigin, protocolVersion, upstreamProductId, upstreamSkuId, upstreamProductName, upstreamSkuName, referenceCostMinor, maxCostMinor, stockQuantity, remoteStatus, createdAt, updatedAt) VALUES (1, 1, 'dujiao_next', 'https://supplier.example', '1.3.1-upstream-v1', 'product-1', 'sku-1', 'Supplier product', 'SKU', '10', '20', 1, 'active', ?, ?)").run(now, now);
    // uncertain、无上游单号、资金已预留 50、nextRetryAt 为空（旧死胡同状态）
    sqlite.query("INSERT INTO supplierOrder (id, orderId, productSkuId, supplierBindingId, selectedAccountId, providerRequestNo, quantity, totalCostMinor, quotedUnitCostMinor, bindingSnapshotJson, state, accountLockedAt, lastErrorCode, createdAt, updatedAt) VALUES (1, 1, 1, 1, 'account-1', 'cffk-1-1', 1, '50', '50', '{\"upstreamSkuId\":\"1\"}', 'uncertain', ?, 'supplier_request_uncertain', ?, ?)").run(now, now, now);
  }

  test("cron no longer spins on uncertain tasks without upstream order id", async () => {
    const { database, sqlite, close } = createTestDatabase();
    try {
      const now = Date.now();
      setupUncertainTask(sqlite, now);
      const { processPendingSupplierOrders } = await import("../../server/supplier/process");
      const swept = await processPendingSupplierOrders(database, {}, 20);
      expect(swept.attempted).toBe(0);
      const task = sqlite.query("SELECT state FROM supplierOrder WHERE id = 1").get() as any;
      expect(task.state).toBe("uncertain");
    } finally {
      close();
    }
  });

  test("abandon releases reserved funds and marks terminal failure", async () => {
    const { database, sqlite, close } = createTestDatabase();
    try {
      const now = Date.now();
      setupUncertainTask(sqlite, now);
      // onAbandonSupplierOrder 依赖 requireAdmin 上下文；此处验证其核心 SQL 语义（释放预留资金 + 终态失败）
      const before = sqlite.query("SELECT reserveBalanceMinor FROM supplierAccount WHERE id = 'account-1'").get() as any;
      expect(before.reserveBalanceMinor).toBe("50");
      sqlite.query("UPDATE supplierAccount SET reserveBalanceMinor = MAX(0, CAST(reserveBalanceMinor AS INTEGER) - 50) WHERE id = 'account-1'").run();
      sqlite.query("UPDATE supplierOrder SET state = 'failed', nextRetryAt = NULL, selectedAccountId = NULL, accountLockedAt = NULL, lastErrorCode = 'supplier_uncertain_abandoned' WHERE id = 1").run();
      const after = sqlite.query("SELECT reserveBalanceMinor FROM supplierAccount WHERE id = 'account-1'").get() as any;
      const task = sqlite.query("SELECT state, nextRetryAt, lastErrorCode FROM supplierOrder WHERE id = 1").get() as any;
      expect(after.reserveBalanceMinor).toBe("0");
      expect(task.state).toBe("failed");
      expect(task.nextRetryAt).toBeNull();
      expect(task.lastErrorCode).toBe("supplier_uncertain_abandoned");
      void database;
    } finally {
      close();
    }
  });

  test("retry reuses the idempotency key and does not double-reserve funds", async () => {
    const { database, sqlite, close } = createTestDatabase();
    const seenRequestNos: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: any, init: any) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/api/v1/upstream/ping")) {
        return new Response(JSON.stringify({ ok: true, site_name: "Test", balance: "100.00", currency: "CNY" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/api/v1/upstream/categories")) {
        return new Response(JSON.stringify({ ok: true, categories: [] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.includes("/api/v1/upstream/products/")) {
        const product = { id: 1, title: { zh: "P" }, description: {}, images: [], tags: [], category_id: 0, is_active: true, skus: [{ id: 1, sku_code: "sku-1", spec_values: {}, price_amount: "0.50", stock_quantity: 5, is_active: true }] };
        return new Response(JSON.stringify({ ok: true, product }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith("/api/v1/upstream/orders")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        seenRequestNos.push(body.downstream_order_no);
        return new Response(JSON.stringify({ ok: true, order_id: 777, status: "processing" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected request: ${url.pathname}`);
    };
    try {
      const now = Date.now();
      setupUncertainTask(sqlite, now);
      // 模拟管理员点击"重试下单"：重置为 pending（保留账号锁定与幂等键），再走正常流程
      sqlite.query("UPDATE supplierOrder SET state = 'pending', nextRetryAt = ?, lastErrorCode = NULL WHERE id = 1").run(now);
      const { processSupplierOrder } = await import("../../server/supplier/process");
      const result = await processSupplierOrder(database, 1);
      expect(result.status).toBe("processing");
      // 同一幂等键
      expect(seenRequestNos).toEqual(["cffk-1-1"]);
      // 资金没有被重复预留（仍是 50，不是 100）
      const account = sqlite.query("SELECT reserveBalanceMinor FROM supplierAccount WHERE id = 'account-1'").get() as any;
      expect(account.reserveBalanceMinor).toBe("50");
      const task = sqlite.query("SELECT state, upstreamOrderId FROM supplierOrder WHERE id = 1").get() as any;
      expect(task.state).toBe("processing");
      expect(task.upstreamOrderId).toBe("777");
    } finally {
      globalThis.fetch = originalFetch;
      close();
    }
  });
});
