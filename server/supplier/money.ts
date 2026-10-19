import { SupplierDomainError } from "./error";

/**
 * 把任意数值字符串/数字转成 minor 单位，四舍五入到 decimals 位。
 * 与 decimalToMinor 的区别：decimalToMinor 是严格模式（小数位超了直接抛错），
 * 而上游 API 返回的余额/价格经常带超过 decimals 位的小数（加密钱包余额常带 6-8 位），
 * 对余额和价格做四舍五入才是正确行为，不应报错。
 * 兼容：千分位逗号、前后空格、科学计数法（1e-7、1.5e3）。
 */
export function decimalToMinorRounded(value: number | string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier returned an invalid monetary value");
  }
  let text = String(value).trim().replace(/,/g, "");
  // 科学计数法展开为普通十进制字符串
  const sci = /^([+-]?)(\d*)(?:\.(\d*))?[eE]([+-]?\d+)$/.exec(text);
  if (sci) {
    const sign = sci[1] === "-" ? "-" : "";
    const intPart = sci[2] || "0";
    const fracPart = sci[3] || "";
    const exp = Number(sci[4]);
    const digits = `${intPart}${fracPart}`;
    const pointPos = intPart.length + exp;
    if (pointPos <= 0) text = `${sign}0.${"0".repeat(-pointPos)}${digits}`;
    else if (pointPos >= digits.length) text = `${sign}${digits}${"0".repeat(pointPos - digits.length)}`;
    else text = `${sign}${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  }
  const match = /^(-)?(0|[1-9]\d*)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier returned an invalid monetary value");
  }
  const negative = match[1] === "-";
  const intPart = match[2] ?? "0";
  let frac = match[3] ?? "";
  // 四舍五入到 decimals 位：看第 decimals+1 位
  let roundedFrac = frac.slice(0, decimals).padEnd(decimals, "0");
  const roundDigit = frac.length > decimals ? Number(frac[decimals]) : 0;
  let intBig = BigInt(intPart);
  if (roundDigit >= 5) {
    const scaled = BigInt(roundedFrac || "0") + 1n;
    if (scaled >= 10n ** BigInt(decimals)) {
      intBig += 1n;
      roundedFrac = "0".repeat(decimals);
    } else {
      roundedFrac = scaled.toString().padStart(decimals, "0");
    }
  }
  const minor = intBig * 10n ** BigInt(decimals) + BigInt(roundedFrac || "0");
  return (negative ? -minor : minor).toString();
}

export function decimalToMinor(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 8) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier returned an invalid monetary value");
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > decimals) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier returned an invalid monetary value");
  }
  const fraction = (match[2] ?? "").padEnd(decimals, "0");
  return (BigInt(match[1] ?? "0") * 10n ** BigInt(decimals) + BigInt(fraction || "0")).toString();
}

/**
 * 上游成本（上游币种 minor 单位）按账号汇率换算成人民币 minor 单位，四舍五入。
 * exchangeRateToCny: "1 上游币种 = X 人民币"，如 "7.2"。必须为正数。
 */
export function convertToCnyMinor(costMinor: string, exchangeRateToCny: string): string {
  if (!/^(0|[1-9]\d*)$/.test(costMinor)) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier returned an invalid monetary value");
  }
  const rate = exchangeRateToCny.trim();
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/.exec(rate);
  if (!match || Number(rate) <= 0) {
    throw new SupplierDomainError("invalid_supplier_money", 502, "Supplier account has an invalid exchange rate");
  }
  const num = BigInt((match[1] ?? "0") + (match[2] ?? ""));
  const den = 10n ** BigInt((match[2] ?? "").length);
  const cost = BigInt(costMinor);
  // 四舍五入：round(cost * num / den)
  return ((cost * num * 2n + den) / (2n * den)).toString();
}
