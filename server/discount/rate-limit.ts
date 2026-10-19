import { appError } from "@/lib/app-error";

const WINDOW_MS = 60_000;
// 优惠码预览接口限流：防止暴力枚举优惠码。
// 预览是轻量操作，但返回区分有效/无效码，须严格限流。
const LIMITS = {
  GUEST: 10,
  ACCOUNT: 30,
} as const;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function discountPreviewIdentity(userId: string | null, clientIp: string | null | undefined) {
  if (userId) return `user:${userId}`;
  const normalizedIp = clientIp?.trim();
  return normalizedIp ? `ip:${normalizedIp}` : "ip:unknown";
}

export async function hashDiscountPreviewKey(identity: string) {
  const payload = new TextEncoder().encode(`discount-preview:${identity}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)));
}

export async function enforceDiscountPreviewRateLimit(
  database: D1Database,
  input: {
    userId: string | null;
    clientIp?: string | null;
    now?: Date;
  },
) {
  const now = input.now?.getTime() ?? Date.now();
  const expiresAt = now + WINDOW_MS;
  const identity = discountPreviewIdentity(input.userId, input.clientIp);
  const keyHash = await hashDiscountPreviewKey(identity);
  const limit = LIMITS[input.userId ? "ACCOUNT" : "GUEST"];

  const result = await database
    .prepare(
      `
    INSERT INTO orderRequestRateLimit (keyHash, requestCount, expiresAt, createdAt, updatedAt)
    VALUES (?, 1, ?, ?, ?)
    ON CONFLICT(keyHash) DO UPDATE SET
      requestCount = CASE
        WHEN orderRequestRateLimit.expiresAt <= excluded.updatedAt THEN 1
        ELSE orderRequestRateLimit.requestCount + 1
      END,
      expiresAt = CASE
        WHEN orderRequestRateLimit.expiresAt <= excluded.updatedAt THEN excluded.expiresAt
        ELSE orderRequestRateLimit.expiresAt
      END,
      updatedAt = excluded.updatedAt
    RETURNING requestCount
  `,
    )
    .bind(keyHash, expiresAt, now, now)
    .first<{ requestCount: number }>();

  if (!result || result.requestCount > limit) appError("DISCOUNT_PREVIEW_RATE_LIMITED");
}
