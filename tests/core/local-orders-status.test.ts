// 回归测试:游客订单的 status 字段必须在 localStorage 往返中保留,
// 否则匿名订单列表的状态徽章永远显示不出来(2026-10-15 线上 bug)。
// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { test } from "bun:test";
// @ts-expect-error Tests run with Bun, while this project intentionally omits Bun's global type package.
import { beforeEach } from "bun:test";
import assert from "node:assert/strict";
import {
  getLocalOrdersByEmail,
  replaceLocalOrdersForEmail,
  saveGuestOrder,
} from "../../lib/local-orders";

const store = new Map<string, string>();
// lib/local-orders 只在函数体内访问 localStorage,模块加载时不需要垫片,
// 但为稳妥起见在导入前就装好。
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
} as Storage;

beforeEach(() => {
  store.clear();
});

function makeOrder(orderNo: string, status?: string) {
  return {
    orderNo,
    productName: "测试",
    amount: "0.01",
    createdAt: new Date().toISOString(),
    ...(status === undefined ? {} : { status }),
  };
}

test("saveGuestOrder 保留 status,新订单列表能读到 PENDING", () => {
  assert.equal(saveGuestOrder("TCQ@Example.COM", makeOrder("ORD-NEW-1", "PENDING")), true);
  const orders = getLocalOrdersByEmail("tcq@example.com");
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, "PENDING");
});

test("replaceLocalOrdersForEmail 保留 status(查详情同步状态的路径)", () => {
  assert.equal(saveGuestOrder("a@b.c", makeOrder("ORD-SYNC-1")), true);
  const updated = [{ ...makeOrder("ORD-SYNC-1"), status: "PAID" }];
  assert.equal(replaceLocalOrdersForEmail("a@b.c", updated), true);
  const orders = getLocalOrdersByEmail("a@b.c");
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, "PAID");
});

test("老数据(无 status)照常读写,不强制补字段", () => {
  assert.equal(saveGuestOrder("a@b.c", makeOrder("ORD-OLD-1")), true);
  const orders = getLocalOrdersByEmail("a@b.c");
  assert.equal(orders.length, 1);
  assert.equal(orders[0].status, undefined);
});

test("空字符串 status 不保留", () => {
  assert.equal(saveGuestOrder("a@b.c", makeOrder("ORD-EMPTY-1", "")), true);
  const orders = getLocalOrdersByEmail("a@b.c");
  assert.equal(orders[0].status, undefined);
});
