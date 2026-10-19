// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { afterEach, describe, expect, test } from "bun:test";
// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import type { Database } from "bun:sqlite";
import { processOrderEvents } from "../../server/email/order-events.ts";
import { createOrder, confirmOrderPayment, getOrderForQuery } from "../../server/order/service.ts";
import { createTestDatabase } from "../helpers/sqlite-d1.ts";

type FlowIdentity = {
  name: string;
  ownerUserId: string | null;
  email: string;
};

type SentEmail = {
  to: string;
  subject: string;
  text?: string;
};

const databases: Array<ReturnType<typeof createTestDatabase>> = [];

afterEach(() => {
  while (databases.length) databases.pop()!.close();
});

function insertFixtures(sqlite: Database, identity: FlowIdentity) {
  const now = Date.now();
  if (identity.ownerUserId) {
    sqlite.query("INSERT INTO user (id, name, email, emailVerified, twoFactorEnabled, createdAt, updatedAt) VALUES (?, ?, ?, 1, 0, ?, ?)")
      .run(identity.ownerUserId, identity.name, identity.email, now, now);
  }
  sqlite.query("INSERT INTO siteSetting (id, siteName, siteUrl, registrationEnabled, timezone, createdAt, updatedAt) VALUES (1, 'Core Shop', 'https://shop.example.com', 1, 'Asia/Shanghai', ?, ?)").run(now, now);
  sqlite.query("INSERT INTO product_v2 (name, slug, status, sort, createdAt, updatedAt) VALUES ('Core product', ?, 'ACTIVE', 0, ?, ?)")
    .run(`core-${identity.ownerUserId ?? "guest"}`, now, now);
  const product = sqlite.query("SELECT id FROM product_v2 WHERE slug = ?").get(`core-${identity.ownerUserId ?? "guest"}`) as { id: number };
  sqlite.query("INSERT INTO productSku (productId, name, price, status, deliveryType, fixedDeliveryContent, minBuy, maxBuy, sort, createdAt, updatedAt) VALUES (?, 'Default', 1000, 'ACTIVE', 'FIXED_CARD', 'LICENSE-CORE-001', 1, 1, 0, ?, ?)")
    .run(product.id, now, now);
  sqlite.query("INSERT INTO discountCode (code, type, value, usedCount, reservedCount, isActive, createdAt, updatedAt) VALUES (?, 'FIXED', 1000, 0, 0, 1, ?, ?)")
    .run(`FREE-${(identity.ownerUserId ?? "GUEST").toUpperCase()}`, now, now);
  sqlite.query("INSERT INTO pushChannelConfig (channel, provider, name, isEnabled, configJson, createdAt, updatedAt) VALUES ('EMAIL', 'CLOUDFLARE', 'Test Email', 1, ?, ?, ?)")
    .run(JSON.stringify({ schemaVersion: 1, kind: "cloudflare", from: "shop@example.com" }), now, now);
  for (const scene of ["ORDER_PAID", "DELIVERY_SUCCESS"] as const) {
    sqlite.query("INSERT INTO emailTemplate (scene, name, templateJson, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)")
      .run(scene, scene, JSON.stringify({ schemaVersion: 1, format: "text", subject: `${scene} {{orderNo}}`, body: "{{queryUrl}}\n{{deliveryItems}}" }), now, now);
  }
}

async function runStorefrontFlow(identity: FlowIdentity) {
  const context = createTestDatabase();
  databases.push(context);
  insertFixtures(context.sqlite, identity);
  const product = context.sqlite.query("SELECT id FROM product_v2 LIMIT 1").get() as { id: number };
  const discountCode = `FREE-${(identity.ownerUserId ?? "GUEST").toUpperCase()}`;
  const sent: SentEmail[] = [];

  const created = await createOrder(context.database, {
    productId: product.id,
    productSkuId: (context.sqlite.query("SELECT id FROM productSku WHERE productId = ?").get(product.id) as { id: number }).id,
    quantity: 1,
    paymentProvider: "ALIPAY",
    contactType: "EMAIL",
    contactValue: identity.email,
    discountCode,
  }, identity.ownerUserId);
  expect(created).toMatchObject({ amount: 0, originalAmount: 1000, discountAmount: 1000, discountCode });

  expect(await confirmOrderPayment(context.database, created.id)).toEqual({ outcome: "CONFIRMED" });
  const order = context.sqlite.query("SELECT ownerUserId, status, paymentStatus, deliveryStatus FROM `order` WHERE id = ?").get(created.id);
  expect(order).toEqual({ ownerUserId: identity.ownerUserId, status: "DELIVERED", paymentStatus: "PAID", deliveryStatus: "DELIVERED" });
  expect(context.sqlite.query("SELECT usedCount, reservedCount FROM discountCode WHERE code = ?").get(discountCode)).toEqual({ usedCount: 1, reservedCount: 0 });

  const eventResult = await processOrderEvents(context.database, {
    EMAIL: {
      async send(message: SentEmail) {
        sent.push(message);
        return { messageId: `test-${sent.length}` };
      },
    },
  });
  expect(eventResult).toEqual({ attempted: 2, processed: 2, failed: 0 });

  expect(context.sqlite.query("SELECT scene, status FROM orderEvent ORDER BY id").all()).toEqual([
    { scene: "ORDER_PAID", status: "PROCESSED" },
    { scene: "DELIVERY_SUCCESS", status: "PROCESSED" },
  ]);
  expect(sent.map((message) => message.subject)).toEqual([
    `ORDER_PAID ${created.orderNo}`,
    `DELIVERY_SUCCESS ${created.orderNo}`,
  ]);
  expect(sent.every((message) => message.to === identity.email)).toBe(true);
  expect(sent[1]?.text).toContain("LICENSE-CORE-001");

  return { context, created };
}

describe("core storefront flows", () => {
  test("guest uses a full discount, receives delivery, and triggers both push nodes", async () => {
    const identity = { name: "Guest", ownerUserId: null, email: "guest@example.com" };
    const { context, created } = await runStorefrontFlow(identity);

    const queried = await getOrderForQuery(context.database, created.orderNo, null, identity.email);
    expect(queried).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID", deliveries: ["LICENSE-CORE-001"] });
    expect(await getOrderForQuery(context.database, created.orderNo, null, "other@example.com")).toBeNull();
  });

  test("account user owns the same purchase flow and queries it through the account", async () => {
    const identity = { name: "Core User", ownerUserId: "core-user", email: "user@example.com" };
    const { context, created } = await runStorefrontFlow(identity);

    const queried = await getOrderForQuery(context.database, created.orderNo, identity.ownerUserId);
    expect(queried).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID", deliveries: ["LICENSE-CORE-001"] });
    expect(await getOrderForQuery(context.database, created.orderNo, "another-user")).toBeNull();
  });
});

test("stablecoin auto-confirm path redeems the coupon (ALREADY_PAID branch)", async () => {
  const { database, sqlite, close } = createTestDatabase();
  try {
    const now = Date.now();
    sqlite.query("INSERT INTO discountCode (code, type, value, usedCount, reservedCount, isActive, createdAt, updatedAt) VALUES ('SAVE10', 'FIXED', 100, 0, 1, 1, ?, ?)").run(now, now);
    const coupon = sqlite.query("SELECT id FROM discountCode WHERE code = 'SAVE10'").get() as { id: number };
    // 模拟稳定币 monitor：先直接置 PAID（跳过正常批次），再调 confirmOrderPayment
    sqlite.query("INSERT INTO `order` (orderNo, productNameSnapshot, unitPrice, quantity, amount, paymentProvider, deliveryTypeSnapshot, status, paymentStatus, discountCodeId, createdAt, updatedAt) VALUES ('ORD-COUPON-1', 'Test', 1000, 1, 900, 'MANUAL_USDT', 'MANUAL', 'PAID', 'PAID', ?, ?, ?)").run(coupon.id, now, now);
    const orderRow = sqlite.query("SELECT id FROM `order` WHERE orderNo = 'ORD-COUPON-1'").get() as { id: number };
    await confirmOrderPayment(database, orderRow.id);
    const after = sqlite.query("SELECT usedCount, reservedCount FROM discountCode WHERE id = ?").get(coupon.id) as { usedCount: number; reservedCount: number };
    expect(after.usedCount).toBe(1);
    expect(after.reservedCount).toBe(0);
    // 幂等：再调一次不重复扣
    await confirmOrderPayment(database, orderRow.id);
    const again = sqlite.query("SELECT usedCount, reservedCount FROM discountCode WHERE id = ?").get(coupon.id) as { usedCount: number; reservedCount: number };
    expect(again.usedCount).toBe(1);
    expect(again.reservedCount).toBe(0);
  } finally {
    close();
  }
});

test("card reservation prevents oversell on concurrent orders", async () => {
  const { database, sqlite, close } = createTestDatabase();
  try {
    const now = Date.now();
    sqlite.query("INSERT INTO product_v2 (name, slug, status, createdAt, updatedAt) VALUES ('Card Product', 'card-product', 'ACTIVE', ?, ?)").run(now, now);
    const product = sqlite.query("SELECT id FROM product_v2 WHERE slug = 'card-product'").get() as { id: number };
    sqlite.query("INSERT INTO productSku (productId, name, price, status, fulfillmentSource, deliveryType, minBuy, maxBuy, createdAt, updatedAt) VALUES (?, 'Default', 1000, 'ACTIVE', 'LOCAL', 'CARD_AUTO', 1, 5, ?, ?)").run(product.id, now, now);
    const sku = sqlite.query("SELECT id FROM productSku WHERE productId = ?").get(product.id) as { id: number };
    // 只有 1 张卡
    sqlite.query("INSERT INTO card (productId, productSkuId, content, status, createdAt, updatedAt) VALUES (?, ?, 'CARD-1', 'UNUSED', ?, ?)").run(product.id, sku.id, now, now);

    const input = { productId: product.id, productSkuId: sku.id, quantity: 1, paymentProvider: "ALIPAY" as const, contactType: "EMAIL" as const, contactValue: "buyer@example.com", allowPendingPayment: true };
    const first = await createOrder(database, input, null);
    // 第一单预留成功：卡变为 RESERVED 并挂到订单名下
    expect(sqlite.query("SELECT status, orderId FROM card WHERE content = 'CARD-1'").get()).toEqual({ status: "RESERVED", orderId: first.id });

    // 第二单：库存已被预留，应直接失败，不建单
    await expect(createOrder(database, input, null)).rejects.toThrow();
    const orderCount = (sqlite.query("SELECT COUNT(*) AS count FROM `order`").get() as { count: number }).count;
    expect(orderCount).toBe(1);

    // 第一单关闭后，卡释放回 UNUSED
    const { closePendingOrder } = await import("../../server/order/service");
    await closePendingOrder(database, first.id);
    expect(sqlite.query("SELECT status, orderId FROM card WHERE content = 'CARD-1'").get()).toEqual({ status: "UNUSED", orderId: null });

    // 释放后可以重新下单
    const third = await createOrder(database, input, null);
    expect(third.id).toBeGreaterThan(0);
    expect(sqlite.query("SELECT status FROM card WHERE content = 'CARD-1'").get()).toEqual({ status: "RESERVED" });
  } finally {
    close();
  }
});
