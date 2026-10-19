import { and, count, desc, eq, like } from "drizzle-orm";
import { telefuncAction } from "@/server/telefunc-action";
import { requireAdmin } from "@/server/telefunc-context";
import { appError } from "@/lib/app-error";
import { supplierBinding, supplierOrder, order } from "@/database/drizzle/schema";
import { processSupplierOrder } from "./process";
import { supplierOrderActionSchema, supplierOrderListQuerySchema } from "./schema";

export const onListSupplierOrders = telefuncAction(async (input: unknown = {}) => {
  const { db } = requireAdmin();
  const parsed = supplierOrderListQuerySchema.safeParse(input);
  if (!parsed.success) appError("SUPPLIER_ORDER_INPUT_INVALID");
  const page = parsed.data.page ?? 1;
  const pageSize = parsed.data.pageSize ?? 20;
  const conditions = [];
  if (parsed.data.query) conditions.push(like(order.orderNo, `%${parsed.data.query}%`));
  if (parsed.data.state) conditions.push(eq(supplierOrder.state, parsed.data.state));
  const where = conditions.length ? and(...conditions) : undefined;
  const [items, totalRows] = await Promise.all([
    db.select({ id: supplierOrder.id, orderId: supplierOrder.orderId, orderNo: order.orderNo, provider: supplierBinding.provider, upstreamSkuName: supplierBinding.upstreamSkuName, quantity: supplierOrder.quantity, unitCostMinor: supplierOrder.quotedUnitCostMinor, totalCostMinor: supplierOrder.totalCostMinor, state: supplierOrder.state, selectedAccountId: supplierOrder.selectedAccountId, attemptCount: supplierOrder.attemptCount, selectionCount: supplierOrder.selectionCount, upstreamOrderId: supplierOrder.upstreamOrderId, lastErrorCode: supplierOrder.lastErrorCode, lastErrorMessage: supplierOrder.lastErrorMessage, nextRetryAt: supplierOrder.nextRetryAt, createdAt: supplierOrder.createdAt, updatedAt: supplierOrder.updatedAt }).from(supplierOrder).innerJoin(order, eq(order.id, supplierOrder.orderId)).innerJoin(supplierBinding, eq(supplierBinding.id, supplierOrder.supplierBindingId)).where(where).orderBy(desc(supplierOrder.createdAt), desc(supplierOrder.id)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ value: count() }).from(supplierOrder).innerJoin(order, eq(order.id, supplierOrder.orderId)).where(where),
  ]);
  return { items, total: totalRows[0]?.value ?? 0, page, pageSize };
});

async function parseAction(input: unknown) {
  const parsed = supplierOrderActionSchema.safeParse(input);
  if (!parsed.success) appError("SUPPLIER_ORDER_INPUT_INVALID");
  return parsed.data;
}

export const onRetrySupplierOrder = telefuncAction(async (input: unknown) => {
  const { id } = await parseAction(input);
  const { database, db, runtime } = requireAdmin();
  const [task] = await db.select({ id: supplierOrder.id, state: supplierOrder.state, upstreamOrderId: supplierOrder.upstreamOrderId, selectedAccountId: supplierOrder.selectedAccountId, accountLockedAt: supplierOrder.accountLockedAt }).from(supplierOrder).where(eq(supplierOrder.id, id)).limit(1);
  if (!task) appError("SUPPLIER_ORDER_NOT_FOUND");
  if (["supplied", "refunded"].includes(task.state)) appError("SUPPLIER_ORDER_ALREADY_FINISHED");
  if (task.state === "uncertain" && !task.upstreamOrderId) {
    // 待对账且无上游单号：用同一幂等键重试下单（上游若已建单则返回已有订单，不重复扣款）。
    // 保留账号锁定与资金预留，process 内不再重复预留。
    if (!task.selectedAccountId || !task.accountLockedAt) appError("SUPPLIER_UNCERTAIN_RETRY_UNAVAILABLE");
    await db.update(supplierOrder).set({ state: "pending", nextRetryAt: new Date(), lastErrorCode: null, lastErrorMessage: null, updatedAt: new Date() }).where(eq(supplierOrder.id, task.id));
    return processSupplierOrder(database, task.id, runtime);
  }
  await db.update(supplierOrder).set({ nextRetryAt: new Date(), updatedAt: new Date() }).where(eq(supplierOrder.id, task.id));
  return processSupplierOrder(database, task.id, runtime);
});

/** 放弃待对账（无上游单号）的采购单：释放预留资金，标记终态失败，本地订单走人工退款/补单。 */
export const onAbandonSupplierOrder = telefuncAction(async (input: unknown) => {
  const { id } = await parseAction(input);
  const { database, db } = requireAdmin();
  const [task] = await db.select({ id: supplierOrder.id, state: supplierOrder.state, upstreamOrderId: supplierOrder.upstreamOrderId, selectedAccountId: supplierOrder.selectedAccountId, totalCostMinor: supplierOrder.totalCostMinor }).from(supplierOrder).where(eq(supplierOrder.id, id)).limit(1);
  if (!task) appError("SUPPLIER_ORDER_NOT_FOUND");
  if (task.state !== "uncertain" || task.upstreamOrderId) appError("SUPPLIER_ORDER_NOT_UNCERTAIN");
  if (["supplied", "refunded"].includes(task.state)) appError("SUPPLIER_ORDER_ALREADY_FINISHED");
  const now = new Date();
  // 释放该单占用的预留资金
  if (task.selectedAccountId && task.totalCostMinor) {
    await database.prepare("UPDATE supplierAccount SET reserveBalanceMinor = MAX(0, CAST(reserveBalanceMinor AS INTEGER) - ?), updatedAt = ? WHERE id = ?").bind(task.totalCostMinor, Date.now(), task.selectedAccountId).run().catch(() => undefined);
  }
  await db.update(supplierOrder).set({ state: "failed", nextRetryAt: null, selectedAccountId: null, selectedCredentialsRevision: null, accountLockedAt: null, providerRequestNo: null, lastErrorCode: "supplier_uncertain_abandoned", lastErrorMessage: "管理员放弃待对账采购单", updatedAt: now }).where(eq(supplierOrder.id, task.id));
  return { id: task.id, state: "failed" as const };
});

export const onReconcileSupplierOrder = telefuncAction(async (input: unknown) => {
  const { id } = await parseAction(input);
  const { database, db, runtime } = requireAdmin();
  const [task] = await db.select({ id: supplierOrder.id, upstreamOrderId: supplierOrder.upstreamOrderId, state: supplierOrder.state }).from(supplierOrder).where(eq(supplierOrder.id, id)).limit(1);
  if (!task) appError("SUPPLIER_ORDER_NOT_FOUND");
  if (!task.upstreamOrderId) appError("SUPPLIER_UPSTREAM_ORDER_MISSING");
  await db.update(supplierOrder).set({ nextRetryAt: new Date(), state: "uncertain", updatedAt: new Date() }).where(eq(supplierOrder.id, task.id));
  return processSupplierOrder(database, task.id, runtime);
});

export const onReselectSupplierOrderAccount = telefuncAction(async (input: unknown) => {
  const { id } = await parseAction(input);
  const { db } = requireAdmin();
  const [task] = await db.select({ id: supplierOrder.id, state: supplierOrder.state, upstreamOrderId: supplierOrder.upstreamOrderId }).from(supplierOrder).where(eq(supplierOrder.id, id)).limit(1);
  if (!task) appError("SUPPLIER_ORDER_NOT_FOUND");
  if (task.upstreamOrderId) appError("SUPPLIER_ACCOUNT_LOCKED");
  if (task.state === "uncertain") appError("SUPPLIER_REQUEST_UNCERTAIN");
  if (["supplied", "refunded"].includes(task.state)) appError("SUPPLIER_ORDER_ALREADY_FINISHED");
  await db.update(supplierOrder).set({ selectedAccountId: null, selectedCredentialsRevision: null, accountLockedAt: null, nextRetryAt: new Date(), state: "pending", updatedAt: new Date() }).where(eq(supplierOrder.id, task.id));
  return { id: task.id, state: "pending" as const };
});
