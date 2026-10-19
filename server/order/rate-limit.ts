import { appError } from "@/lib/app-error";

export type OrderRequestAction = "QUERY" | "CHECK" | "RESUME" | "RECOVERY";

const WINDOW_MS = 60_000;
// QUERY(查单,便宜的库查询)与 CHECK(链上查账,走 Alchemy/RPC,贵)分开计费:
// 之前 CHECK 复用 QUERY 额度,5 秒自动检测 + 5 秒轮询把游客 10 次/分钟的额度吃光,点列表里的订单就被限流。
const LIMITS = {
  GUEST: { QUERY: 30, CHECK: 15, RESUME: 10, RECOVERY: 3 },
  ACCOUNT: { QUERY: 60, CHECK: 30, RESUME: 20, RECOVERY: 3 },
} as const;

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export function orderRequestLimit(action: OrderRequestAction, authenticated: boolean) {
  return LIMITS[authenticated ? "ACCOUNT" : "GUEST"][action];
}

export function orderRequestIdentity(userId: string | null, clientIp: string | null | undefined) {
  if (userId) return `user:${userId}`;
  const normalizedIp = clientIp?.trim();
  return normalizedIp ? `ip:${normalizedIp}` : "ip:unknown";
}

export async function hashOrderRequestKey(action: OrderRequestAction, identity: string) {
  const payload = new TextEncoder().encode(`order-request:${action}:${identity}`);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", payload)));
}

export async function enforceOrderRequestRateLimit(
  database: D1Database,
  input: {
    action: OrderRequestAction;
    userId: string | null;
    clientIp?: string | null;
    now?: Date;
  },
) {
  const now = input.now?.getTime() ?? Date.now();
  const expiresAt = now + WINDOW_MS;
  const identity = orderRequestIdentity(input.userId, input.clientIp);
  const keyHash = await hashOrderRequestKey(input.action, identity);
  const limit = orderRequestLimit(input.action, Boolean(input.userId));

  const result = await database.prepare(`
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
  `).bind(keyHash, expiresAt, now, now).first<{ requestCount: number }>();

  if (!result || result.requestCount > limit) appError(input.action === "RECOVERY" ? "OTP_RATE_LIMITED" : "ORDER_QUERY_RATE_LIMITED");
}
