export function parseAmountToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const cents = Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
  return Number.isSafeInteger(cents) ? cents : null;
}

export function formatCentsAsYuan(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("Amount must be a non-negative integer in cents");
  return (value / 100).toFixed(2);
}

export function cacheQrPayment(payment: {
  orderNo: string;
  payment?: { mode?: string; qrCode?: string; payableAmount?: number; paymentChain?: string; paymentAsset?: string; walletAddress?: string; tokenAmount?: number } | null;
}) {
  if (typeof window === "undefined" || payment.payment?.mode !== "qr" || !payment.payment.qrCode) return;
  try {
    sessionStorage.setItem(`payment-qr:${payment.orderNo}`, payment.payment.qrCode);
    if (Number.isSafeInteger(payment.payment.payableAmount) && (payment.payment.payableAmount ?? 0) > 0) sessionStorage.setItem(`payment-payable:${payment.orderNo}`, String(payment.payment.payableAmount));
    else sessionStorage.removeItem(`payment-payable:${payment.orderNo}`);
    // 稳定币收款:缓存链/资产/地址/数量,结账页直接展示
    const extra: Record<string, string> = {};
    if (payment.payment.paymentChain) extra.chain = payment.payment.paymentChain;
    if (payment.payment.paymentAsset) extra.asset = payment.payment.paymentAsset;
    if (payment.payment.walletAddress) extra.wallet = payment.payment.walletAddress;
    if (typeof payment.payment.tokenAmount === "number") extra.tokenAmount = String(payment.payment.tokenAmount);
    if (Object.keys(extra).length) sessionStorage.setItem(`payment-sc:${payment.orderNo}`, JSON.stringify(extra));
    else sessionStorage.removeItem(`payment-sc:${payment.orderNo}`);
  } catch { /* Session storage is optional. */ }
}

export function readCachedStablecoin(orderNo: string): { chain?: string; asset?: string; wallet?: string; tokenAmount?: number } {
  try {
    const raw = sessionStorage.getItem(`payment-sc:${orderNo}`);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      chain: typeof parsed.chain === "string" ? parsed.chain : undefined,
      asset: typeof parsed.asset === "string" ? parsed.asset : undefined,
      wallet: typeof parsed.wallet === "string" ? parsed.wallet : undefined,
      tokenAmount: typeof parsed.tokenAmount === "string" && !Number.isNaN(Number(parsed.tokenAmount)) ? Number(parsed.tokenAmount) : undefined,
    };
  } catch { return {}; }
}

export function formatMinorAmount(value: string | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !/^(0|[1-9]\d*)$/.test(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 8) return "-";
  const digits = value.padStart(decimals + 1, "0");
  if (decimals === 0) return digits;
  const split = digits.length - decimals;
  return `${digits.slice(0, split)}.${digits.slice(split)}`;
}

export function canonicalizeAlipayParameters(parameters: Record<string, string>, excludeSignType = false) {
  return Object.entries(parameters)
    .filter(([key, value]) => key !== "sign" && (!excludeSignType || key !== "sign_type") && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}
