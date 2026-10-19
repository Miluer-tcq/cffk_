import { and, asc, eq, sql } from "drizzle-orm";
import { createDrizzleDb } from "@/database/drizzle";
import { card } from "@/database/drizzle/schema";
import { appError } from "@/lib/app-error";

export async function allocateCardsForPaidOrder(database: D1Database, orderId: number, quantity: number, productSkuId: number) {
  const db = createDrizzleDb(database);
  const count = Math.floor(quantity);
  if (!Number.isInteger(count) || count < 1) throw new Error("CARD_QUANTITY_INVALID");

  // A delivery retry can follow a successful allocation whose snapshot write
  // did not complete. Reuse only cards already sold to this exact order.
  const existing = await db
    .select({ id: card.id, content: card.content })
    .from(card)
    .where(and(eq(card.orderId, orderId), eq(card.status, "SOLD")))
    .orderBy(asc(card.id));
  if (existing.length === count) return existing;
  if (existing.length > count) appError("CARD_DELIVERY_COUNT_MISMATCH");
  let missingCount = count - existing.length;

  // 优先使用下单时为本单预留的卡（RESERVED → SOLD）
  const reserved = await db
    .select({ id: card.id })
    .from(card)
    .where(and(eq(card.orderId, orderId), eq(card.status, "RESERVED")))
    .orderBy(asc(card.id))
    .limit(missingCount);
  const toSellIds: number[] = [];
  if (reserved.length > 0) {
    toSellIds.push(...reserved.map((item) => item.id));
    missingCount -= reserved.length;
  }

  const candidates = missingCount > 0 ? await db
    .select({ id: card.id })
    .from(card)
    .where(and(eq(card.productSkuId, productSkuId), eq(card.status, "UNUSED")))
    .orderBy(asc(card.id))
    .limit(missingCount) : [];
  if (candidates.length < missingCount) appError("CARD_INVENTORY_SHORTAGE");

  const candidateIds = [...toSellIds, ...candidates.map((item) => item.id)];
  const now = Date.now();
  try {
    await database.batch([
      database.prepare(`UPDATE card SET status = 'SOLD', orderId = ?, soldAt = ?, updatedAt = ? WHERE id IN (${candidateIds.map(() => "?").join(",")}) AND status IN ('UNUSED', 'RESERVED')`).bind(orderId, now, now, ...candidateIds),
      database.prepare("INSERT INTO transactionGuard (id, value) VALUES (1, CASE WHEN changes() = ? THEN 1 ELSE 0 END) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(candidateIds.length),
    ]);
  } catch {
    appError("CARD_INVENTORY_SHORTAGE");
  }
  const allocated = await db.select({ id: card.id, content: card.content }).from(card).where(and(eq(card.orderId, orderId), eq(card.status, "SOLD"))).orderBy(asc(card.id));
  if (allocated.length !== count) appError("CARD_DELIVERY_COUNT_MISMATCH");
  return allocated;
}

export async function countAvailableCards(database: D1Database, productSkuId: number) {
  const db = createDrizzleDb(database);
  const [result] = await db
    .select({ count: sql<number>`count(*)` })
    .from(card)
    .where(and(eq(card.productSkuId, productSkuId), eq(card.status, "UNUSED")));
  return result?.count ?? 0;
}

/**
 * 下单时原子预留卡密：把 N 张 UNUSED 卡标为 RESERVED 并挂到订单名下。
 * 库存不足时抛 PRODUCT_STOCK_NOT_ENOUGH。预留的卡在订单过期/关闭时释放，
 * 发货时优先使用本单预留的卡。防止并发下单超卖（下单只检查不预留时，
 * 两单可同时通过检查、付款后其中一单无货）。
 */
export async function reserveCardsForPendingOrder(database: D1Database, orderId: number, quantity: number, productSkuId: number) {
  const db = createDrizzleDb(database);
  const count = Math.floor(quantity);
  if (!Number.isInteger(count) || count < 1) throw new Error("CARD_QUANTITY_INVALID");
  const candidates = await db
    .select({ id: card.id })
    .from(card)
    .where(and(eq(card.productSkuId, productSkuId), eq(card.status, "UNUSED")))
    .orderBy(asc(card.id))
    .limit(count);
  if (candidates.length < count) appError("PRODUCT_STOCK_NOT_ENOUGH");
  const candidateIds = candidates.map((item) => item.id);
  const now = Date.now();
  try {
    await database.batch([
      database.prepare(`UPDATE card SET status = 'RESERVED', orderId = ?, updatedAt = ? WHERE id IN (${candidateIds.map(() => "?").join(",")}) AND status = 'UNUSED'`).bind(orderId, now, ...candidateIds),
      database.prepare("INSERT INTO transactionGuard (id, value) VALUES (1, CASE WHEN changes() = ? THEN 1 ELSE 0 END) ON CONFLICT(id) DO UPDATE SET value = excluded.value").bind(count),
    ]);
  } catch {
    appError("PRODUCT_STOCK_NOT_ENOUGH");
  }
}

/** 释放订单预留但未使用的卡密（订单过期/关闭时调用）。 */
export async function releaseReservedCards(database: D1Database, orderId: number) {
  const now = Date.now();
  await database.prepare("UPDATE card SET status = 'UNUSED', orderId = NULL, updatedAt = ? WHERE orderId = ? AND status = 'RESERVED'").bind(now, orderId).run().catch(() => undefined);
}
