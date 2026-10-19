// 订单状态颜色:用户侧 + 后台共用同一套,每种状态不同色。
// 待支付琥珀 / 已支付蓝 / 已发货绿 / 已关闭灰 / 已过期橙 / 失败红。
// 发货中用青,未发货用灰,与订单状态同色系保持一致。

const ORDER_STATUS_BADGE_CLASS: Record<string, string> = {
  PENDING: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
  PAID: "border-blue-300 bg-blue-100 text-blue-800 dark:border-blue-700 dark:bg-blue-900/40 dark:text-blue-200",
  DELIVERED: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200",
  CLOSED: "border-zinc-300 bg-zinc-100 text-zinc-600 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  EXPIRED: "border-orange-300 bg-orange-100 text-orange-800 dark:border-orange-700 dark:bg-orange-900/40 dark:text-orange-200",
  FAILED: "border-red-300 bg-red-100 text-red-800 dark:border-red-700 dark:bg-red-900/40 dark:text-red-200",
};

const PAYMENT_STATUS_BADGE_CLASS: Record<string, string> = {
  UNPAID: ORDER_STATUS_BADGE_CLASS.PENDING,
  PAID: ORDER_STATUS_BADGE_CLASS.PAID,
  FAILED: ORDER_STATUS_BADGE_CLASS.FAILED,
};

const DELIVERY_STATUS_BADGE_CLASS: Record<string, string> = {
  NOT_DELIVERED: ORDER_STATUS_BADGE_CLASS.CLOSED,
  DELIVERING: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200",
  DELIVERED: ORDER_STATUS_BADGE_CLASS.DELIVERED,
  FAILED: ORDER_STATUS_BADGE_CLASS.FAILED,
};

export function orderStatusBadgeClass(status: string): string {
  return ORDER_STATUS_BADGE_CLASS[status] ?? ORDER_STATUS_BADGE_CLASS.CLOSED;
}

export function paymentStatusBadgeClass(status: string): string {
  return PAYMENT_STATUS_BADGE_CLASS[status] ?? PAYMENT_STATUS_BADGE_CLASS.UNPAID;
}

export function deliveryStatusBadgeClass(status: string): string {
  return DELIVERY_STATUS_BADGE_CLASS[status] ?? DELIVERY_STATUS_BADGE_CLASS.NOT_DELIVERED;
}
