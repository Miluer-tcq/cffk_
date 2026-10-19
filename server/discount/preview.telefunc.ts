import { telefuncAction } from "@/server/telefunc-action";
import { getContext } from "telefunc";
import { appError } from "@/lib/app-error";
import { previewDiscount } from "./service";
import { enforceDiscountPreviewRateLimit } from "./rate-limit";

type RuntimeContext = { env?: { DB?: D1Database }; user?: { id: string } | null; clientIp?: string | null };

async function internalOnPreviewDiscount(input: { productId: number; productSkuId: number; quantity: number; discountCode: string }) {
  const context = getContext<RuntimeContext>();
  if (!context.env?.DB) appError("DATABASE_UNAVAILABLE");
  await enforceDiscountPreviewRateLimit(context.env.DB, {
    userId: context.user?.id ?? null,
    clientIp: context.clientIp,
  });
  return previewDiscount(context.env.DB, input);
}

export const onPreviewDiscount = telefuncAction(internalOnPreviewDiscount);
