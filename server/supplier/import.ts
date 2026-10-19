import { and, eq, inArray } from "drizzle-orm";
import { appError } from "@/lib/app-error";

import { slugify } from "@/lib/slugify";
import { convertToCnyMinor } from "./money";
import { supplierPurchaseContextSchema } from "./schema";
import { category, productSku, productV2, supplierAccount, supplierBinding } from "@/database/drizzle/schema";
import type { requireAdmin } from "@/server/telefunc-context";

export type SupplierDb = ReturnType<typeof requireAdmin>["db"];
import type { SupplierProduct } from "./providers/types";
import type { SupplierProvider } from "./schema";
import { assertSupplierSkuPublishable } from "./eligibility";

export type SupplierImportInput = {
  provider: SupplierProvider;
  normalizedApiOrigin: string;
  protocolVersion: string;
  productId: string;
  skuIds: string[];
  fixedMarkupMinor: string;
  markupBps: number;
  publish: boolean;
  /** 新建本地商品时使用的分类；不传则回退 default 分类。 */
  categoryId?: number | null;
  /** 固定售价（人民币 minor 单位）；传了则忽略加价，直接按此价卖。 */
  fixedPriceMinor?: string | null;
};

function markupMinor(costMinor: string, fixedMarkupMinor: string, markupBps: number) {
  const cost = BigInt(costMinor);
  const fixed = BigInt(fixedMarkupMinor);
  return (cost * BigInt(10_000 + markupBps) / 10_000n + fixed).toString();
}

function uniqueSlug(base: string, suffix: string) {
  const value = slugify(base) || "supplier-product";
  return `${value}-${slugify(suffix) || "item"}`.slice(0, 180);
}

export async function importSupplierProduct(db: SupplierDb, input: SupplierImportInput, catalogProduct: SupplierProduct) {
  if (catalogProduct.id !== input.productId) appError("SUPPLIER_PRODUCT_NOT_FOUND");
  const selected = catalogProduct.skus.filter((sku) => input.skuIds.includes(sku.id));
  if (!selected.length) appError("SUPPLIER_SKU_REQUIRED");
  if (!/^(0|[1-9]\d*)$/.test(input.fixedMarkupMinor) || input.markupBps < 0 || input.markupBps > 1_000_000) appError("SUPPLIER_MARKUP_INVALID");
  if (input.fixedPriceMinor !== undefined && input.fixedPriceMinor !== null && !/^(0|[1-9]\d*)$/.test(input.fixedPriceMinor)) appError("SUPPLIER_MARKUP_INVALID");
  const [account] = await db.select({ currency: supplierAccount.currency, exchangeRateToCny: supplierAccount.exchangeRateToCny }).from(supplierAccount).where(and(eq(supplierAccount.provider, input.provider), eq(supplierAccount.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierAccount.protocolVersion, input.protocolVersion), eq(supplierAccount.enabled, true))).limit(1);
  if (!account) appError("SUPPLIER_SOURCE_NO_ACCOUNT");
  const now = new Date();
  const [existing] = await db.select({ productId: productV2.id }).from(supplierBinding).innerJoin(productSku, eq(productSku.id, supplierBinding.productSkuId)).innerJoin(productV2, eq(productV2.id, productSku.productId)).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId))).limit(1);
  // 分类：优先用前端选的分类，其次回退 default 分类；两者都没有才报错（修复“请选择商品分类”导入失败）。
  let categoryIdToUse: number | null = null;
  if (!existing) {
    if (input.categoryId && Number.isInteger(input.categoryId) && input.categoryId > 0) {
      const [chosen] = await db.select({ id: category.id }).from(category).where(and(eq(category.id, input.categoryId), eq(category.status, "ACTIVE"))).limit(1);
      if (!chosen) appError("PRODUCT_CATEGORY_INVALID");
      categoryIdToUse = chosen.id;
    } else {
      const [defaultCategory] = await db.select({ id: category.id }).from(category).where(and(eq(category.slug, "default"), eq(category.status, "ACTIVE"))).limit(1);
      if (!defaultCategory) appError("PRODUCT_CATEGORY_REQUIRED");
      categoryIdToUse = defaultCategory.id;
    }
  }
  const localProduct = existing ? (await db.select().from(productV2).where(eq(productV2.id, existing.productId)).limit(1))[0] : (await db.insert(productV2).values({ categoryId: categoryIdToUse!, name: catalogProduct.name, slug: uniqueSlug(catalogProduct.name, `${input.provider}-${input.productId}`), description: catalogProduct.description || catalogProduct.name, status: "DRAFT", createdAt: now, updatedAt: now }).returning())[0];
  if (!localProduct) appError("SUPPLIER_IMPORT_FAILED");
  // A previous import may have created one synthetic SKU using the product
  // code. Once ACG exposes category SKUs, that binding is stale and must not
  // remain active alongside 月费/季费/年费. Keep its local row for order
  // history, but remove it from the selectable supplier catalog.
  const currentBindings = await db.select({ id: supplierBinding.id, upstreamSkuId: supplierBinding.upstreamSkuId, productSkuId: supplierBinding.productSkuId }).from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.enabled, true)));
  const selectedSkuIds = new Set(selected.map((sku) => sku.id));
  const nowForStale = new Date();
  for (const binding of currentBindings) {
    if (selectedSkuIds.has(binding.upstreamSkuId)) continue;
    await db.update(supplierBinding).set({ enabled: false, updatedAt: nowForStale }).where(eq(supplierBinding.id, binding.id));
    await db.update(productSku).set({ status: "INACTIVE", updatedAt: nowForStale }).where(eq(productSku.id, binding.productSkuId));
  }
  const coverImage = catalogProduct.imageUrls[0] ?? null;
  if (!localProduct.coverImage && coverImage) {
    await db.update(productV2).set({ coverImage, updatedAt: now }).where(eq(productV2.id, localProduct.id));
  }
  let imported = 0;
  for (const sku of selected) {
    // 上游成本先按账号汇率换算成人民币，再做加价。本地售价统一为人民币。
    // 固定售价模式：输入即人民币售价，直接使用。
    const cnyCostMinor = convertToCnyMinor(sku.costMinor, account.exchangeRateToCny ?? "1");
    const priceMinor = input.fixedPriceMinor !== undefined && input.fixedPriceMinor !== null
      ? BigInt(input.fixedPriceMinor)
      : BigInt(markupMinor(cnyCostMinor, input.fixedMarkupMinor, input.markupBps));
    if (priceMinor < 1n || priceMinor > BigInt(Number.MAX_SAFE_INTEGER)) appError("SUPPLIER_MARKUP_INVALID");
    const price = Number(priceMinor);
    const purchaseContext = sku.purchaseContext ? supplierPurchaseContextSchema.parse(sku.purchaseContext) : undefined;
    const [existingBinding] = await db.select().from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.upstreamSkuId, sku.id), eq(supplierBinding.enabled, true))).limit(1);
    if (existingBinding) {
      // Re-import is the safe replacement for deleting a supplier product that
      // already has orders. Keep local IDs and history, but refresh the
      // presentation and the complete upstream snapshot.
      // TCQ 2026-10-15：重新导入（更新价格）不再强制下架。本地 SKU 保持原状态，
      // 只有上游已下架/无货时才设为 INACTIVE，避免更新价格后商品从用户端消失。
      const [currentSku] = await db.select({ status: productSku.status }).from(productSku).where(eq(productSku.id, existingBinding.productSkuId)).limit(1);
      const upstreamActive = catalogProduct.active && sku.active;
      await db.update(productSku).set({ name: sku.name, price, status: upstreamActive ? (currentSku?.status ?? "INACTIVE") : "INACTIVE", updatedAt: now }).where(eq(productSku.id, existingBinding.productSkuId));
      await db.update(supplierBinding).set({ upstreamProductName: catalogProduct.name, upstreamSkuName: sku.name, purchaseContextJson: purchaseContext ? JSON.stringify(purchaseContext) : null, referenceCostMinor: sku.costMinor, maxCostMinor: priceMinor.toString(), stockQuantity: sku.stockQuantity, remoteStatus: catalogProduct.active && sku.active ? "active" : "inactive", lastSyncedAt: now, lastErrorCode: null, updatedAt: now }).where(eq(supplierBinding.id, existingBinding.id));
      imported += 1;
      continue;
    }
    const [localSku] = await db.insert(productSku).values({ productId: localProduct.id, name: sku.name, price, status: "INACTIVE", fulfillmentSource: "SUPPLIER", deliveryType: "SUPPLIER", physicalStock: null, minBuy: 1, maxBuy: 1, sort: imported, createdAt: now, updatedAt: now }).returning();
    if (!localSku) appError("SUPPLIER_IMPORT_FAILED");
    await db.insert(supplierBinding).values({ productSkuId: localSku.id, provider: input.provider, normalizedApiOrigin: input.normalizedApiOrigin, protocolVersion: input.protocolVersion, upstreamProductId: input.productId, upstreamSkuId: sku.id, upstreamProductName: catalogProduct.name, upstreamSkuName: sku.name, purchaseContextJson: purchaseContext ? JSON.stringify(purchaseContext) : null, referenceCostMinor: sku.costMinor, maxCostMinor: priceMinor.toString(), stockQuantity: sku.stockQuantity, remoteStatus: catalogProduct.active && sku.active ? "active" : "inactive", lastSyncedAt: now, enabled: true, createdAt: now, updatedAt: now });
    imported += 1;
  }
  // A re-import is a complete replacement for this upstream product's active
  // SKU set. Do not leave an old synthetic/code SKU or a previously imported
  // category SKU active when it is no longer present in the selected set.
  const refreshedBindings = await db.select({ id: supplierBinding.id, productSkuId: supplierBinding.productSkuId, upstreamSkuId: supplierBinding.upstreamSkuId }).from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.enabled, true)));
  for (const binding of refreshedBindings) {
    if (!selectedSkuIds.has(binding.upstreamSkuId)) {
      await db.update(supplierBinding).set({ enabled: false, updatedAt: now }).where(eq(supplierBinding.id, binding.id));
      await db.update(productSku).set({ status: "INACTIVE", updatedAt: now }).where(eq(productSku.id, binding.productSkuId));
    }
  }
  if (input.publish) {
    if (!catalogProduct.active || selected.some((sku) => !sku.active)) appError("SUPPLIER_SKU_UNAVAILABLE");
    const selectedBindings = await db.select({ productSkuId: supplierBinding.productSkuId }).from(supplierBinding).where(and(
      eq(supplierBinding.provider, input.provider),
      eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin),
      eq(supplierBinding.protocolVersion, input.protocolVersion),
      eq(supplierBinding.upstreamProductId, input.productId),
      inArray(supplierBinding.upstreamSkuId, selected.map((sku) => sku.id)),
      eq(supplierBinding.enabled, true),
    ));
    const selectedLocalSkuIds = selectedBindings.map((binding) => binding.productSkuId);
    if (!selectedLocalSkuIds.length) appError("SUPPLIER_IMPORT_FAILED");
    for (const productSkuId of selectedLocalSkuIds) await assertSupplierSkuPublishable(db, productSkuId);
    await db.update(productSku).set({ status: "ACTIVE", updatedAt: now }).where(and(inArray(productSku.id, selectedLocalSkuIds), eq(productSku.fulfillmentSource, "SUPPLIER")));
    await db.update(productV2).set({ status: "ACTIVE", updatedAt: now }).where(eq(productV2.id, localProduct.id));
  }
  return { productId: localProduct.id, imported, currency: account.currency };
}

export type SupplierBindingSwitchInput = {
  productSkuId: number;
  provider: SupplierProvider;
  normalizedApiOrigin: string;
  protocolVersion: string;
  productId: string;
  skuId: string;
};

export async function switchSupplierBinding(db: SupplierDb, input: SupplierBindingSwitchInput, catalogProduct: SupplierProduct) {
  const sku = catalogProduct.skus.find((item) => item.id === input.skuId);
  if (catalogProduct.id !== input.productId || !sku) appError("SUPPLIER_SKU_NOT_FOUND");
  const [target] = await db.select().from(productSku).where(eq(productSku.id, input.productSkuId)).limit(1);
  if (!target) appError("PRODUCT_SKU_NOT_FOUND");
  if (target.fulfillmentSource !== "SUPPLIER" || target.deliveryType !== "SUPPLIER") appError("SUPPLIER_FULFILLMENT_INVALID");
  const [account] = await db.select({ currency: supplierAccount.currency }).from(supplierAccount).where(and(eq(supplierAccount.provider, input.provider), eq(supplierAccount.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierAccount.protocolVersion, input.protocolVersion), eq(supplierAccount.enabled, true))).limit(1);
  if (!account) appError("SUPPLIER_SOURCE_NO_ACCOUNT");
  const [duplicate] = await db.select({ id: supplierBinding.id }).from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.upstreamSkuId, input.skuId), eq(supplierBinding.enabled, true))).limit(1);
  if (duplicate) appError("SUPPLIER_BINDING_DUPLICATE");
  const [current] = await db.select({ id: supplierBinding.id }).from(supplierBinding).where(and(eq(supplierBinding.productSkuId, input.productSkuId), eq(supplierBinding.enabled, true))).limit(1);
  const purchaseContext = sku.purchaseContext ? supplierPurchaseContextSchema.parse(sku.purchaseContext) : undefined;
  const now = new Date();
  if (current) await db.update(supplierBinding).set({ enabled: false, updatedAt: now }).where(eq(supplierBinding.id, current.id));
  const [created] = await db.insert(supplierBinding).values({ productSkuId: target.id, provider: input.provider, normalizedApiOrigin: input.normalizedApiOrigin, protocolVersion: input.protocolVersion, upstreamProductId: input.productId, upstreamSkuId: input.skuId, upstreamProductName: catalogProduct.name, upstreamSkuName: sku.name, purchaseContextJson: purchaseContext ? JSON.stringify(purchaseContext) : null, referenceCostMinor: sku.costMinor, maxCostMinor: sku.costMinor, stockQuantity: sku.stockQuantity, remoteStatus: catalogProduct.active && sku.active ? "active" : "inactive", lastSyncedAt: now, enabled: true, createdAt: now, updatedAt: now }).returning({ id: supplierBinding.id });
  if (!created) appError("SUPPLIER_BINDING_SWITCH_FAILED");
  return { id: created.id, productSkuId: target.id, currency: account.currency };
}

export type SupplierUnlinkInput = {
  provider: SupplierProvider;
  normalizedApiOrigin: string;
  protocolVersion: string;
  productId: string;
  skuId: string;
};

/**
 * 取消关联：停用该上游 SKU 的绑定，并把本地 SKU 恢复为关联前的发货方式。
 * 价格、名称、状态保持不变；历史订单不受影响（订单快照里仍有旧绑定信息）。
 * 已关联的本地 SKU 取消后不再走供应商自动采购，需手动发货或重新关联。
 * 若绑定没有记录原发货方式（老数据），回退为手动发货（LOCAL / MANUAL）。
 */
export async function unlinkSupplierBinding(db: SupplierDb, input: SupplierUnlinkInput) {
  const [binding] = await db.select().from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.upstreamSkuId, input.skuId), eq(supplierBinding.enabled, true))).limit(1);
  if (!binding) appError("SUPPLIER_BINDING_NOT_FOUND");
  const now = new Date();
  // 该本地 SKU 的全部启用绑定都停用（可能有跨供应商的旧绑定残留），SKU 恢复关联前的发货方式。
  await db.update(supplierBinding).set({ enabled: false, updatedAt: now }).where(and(eq(supplierBinding.productSkuId, binding.productSkuId), eq(supplierBinding.enabled, true)));
  const restoreSource = binding.previousFulfillmentSource === "LOCAL" || binding.previousFulfillmentSource === "SUPPLIER" ? binding.previousFulfillmentSource : "LOCAL";
  const restoreType = ["CARD_AUTO", "FIXED_CARD", "MANUAL", "EXPRESS"].includes(binding.previousDeliveryType ?? "") ? binding.previousDeliveryType! : "MANUAL";
  await db.update(productSku).set({ fulfillmentSource: restoreSource, deliveryType: restoreType as typeof productSku.$inferSelect.deliveryType, updatedAt: now }).where(eq(productSku.id, binding.productSkuId));
  return { id: binding.id, productSkuId: binding.productSkuId };
}

export type SupplierUpdateMaxCostInput = {
  provider: SupplierProvider;
  normalizedApiOrigin: string;
  protocolVersion: string;
  productId: string;
  skuId: string;
  /** 新成本上限（minor 单位，非负整数，如售价 0.10 USD 对应 "10"）。 */
  newMaxCostMinor: string;
};

/**
 * 调整成本上限：发货时上游实时拿货价超过 maxCostMinor 会被拦截（supplier_live_quote_exceeds_limit），
 * 上游涨价后需在这里把上限提高到不低于当前拿货价（通常设为售价或售价以上），再到供应商订单页重试。
 */
export async function updateBindingMaxCost(db: SupplierDb, input: SupplierUpdateMaxCostInput) {
  if (!/^(0|[1-9]\d*)$/.test(input.newMaxCostMinor) || BigInt(input.newMaxCostMinor) > BigInt(Number.MAX_SAFE_INTEGER)) appError("SUPPLIER_BINDING_MAX_COST_INVALID");
  const [binding] = await db.select().from(supplierBinding).where(and(eq(supplierBinding.provider, input.provider), eq(supplierBinding.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierBinding.protocolVersion, input.protocolVersion), eq(supplierBinding.upstreamProductId, input.productId), eq(supplierBinding.upstreamSkuId, input.skuId), eq(supplierBinding.enabled, true))).limit(1);
  if (!binding) appError("SUPPLIER_BINDING_NOT_FOUND");
  await db.update(supplierBinding).set({ maxCostMinor: input.newMaxCostMinor, updatedAt: new Date() }).where(eq(supplierBinding.id, binding.id));
  return { id: binding.id, productSkuId: binding.productSkuId, maxCostMinor: input.newMaxCostMinor };
}

export type SupplierAssociateInput = {
  provider: SupplierProvider;
  normalizedApiOrigin: string;
  protocolVersion: string;
  productId: string;
  skuId: string;
  /** 手动上架的本地 SKU id（任意发货方式均可，关联后改走供应商发货，价格保持手动价不变）。 */
  localProductSkuId: number;
};

/**
 * 关联手动商品：把上游 SKU 绑定到已有手动本地 SKU。
 * 不新建商品、不改本地售价/名称/状态，只把该 SKU 的发货方式切为供应商发货，并新建 supplierBinding。
 * 若该本地 SKU 已有绑定、或同一上游 SKU 已绑定到别的本地 SKU，先停用旧绑定，避免一单双发。
 */
export async function associateSupplierToLocalSku(db: SupplierDb, input: SupplierAssociateInput, catalogProduct: SupplierProduct) {
  const sku = catalogProduct.skus.find((item) => item.id === input.skuId);
  if (catalogProduct.id !== input.productId || !sku) appError("SUPPLIER_SKU_NOT_FOUND");
  const [target] = await db.select().from(productSku).where(eq(productSku.id, input.localProductSkuId)).limit(1);
  if (!target) appError("PRODUCT_SKU_NOT_FOUND");
  const [account] = await db.select({ currency: supplierAccount.currency }).from(supplierAccount).where(and(eq(supplierAccount.provider, input.provider), eq(supplierAccount.normalizedApiOrigin, input.normalizedApiOrigin), eq(supplierAccount.protocolVersion, input.protocolVersion), eq(supplierAccount.enabled, true))).limit(1);
  if (!account) appError("SUPPLIER_SOURCE_NO_ACCOUNT");
  const now = new Date();
  // 停用该本地 SKU 的全部旧绑定（跨供应商：如下单仍走独角 Next 是因为旧的独角绑定还启用着，
  // 下单时取的是第一条启用的绑定）。同时停用同一上游 SKU 绑到别处的旧绑定，避免一单双发。
  const stale = await db.select().from(supplierBinding).where(eq(supplierBinding.enabled, true));
  for (const b of stale) {
    const sameLocalSku = b.productSkuId === input.localProductSkuId;
    const sameUpstreamElsewhere = b.provider === input.provider
      && b.normalizedApiOrigin === input.normalizedApiOrigin
      && b.protocolVersion === input.protocolVersion
      && b.upstreamProductId === input.productId
      && b.upstreamSkuId === input.skuId
      && b.productSkuId !== input.localProductSkuId;
    if (sameLocalSku || sameUpstreamElsewhere) {
      await db.update(supplierBinding).set({ enabled: false, updatedAt: now }).where(eq(supplierBinding.id, b.id));
    }
  }
  // 切发货方式前先记录原发货方式，取消关联时恢复
  await db.update(productSku).set({ fulfillmentSource: "SUPPLIER", deliveryType: "SUPPLIER", updatedAt: now }).where(eq(productSku.id, target.id));
  const purchaseContext = sku.purchaseContext ? supplierPurchaseContextSchema.parse(sku.purchaseContext) : undefined;
  const [created] = await db.insert(supplierBinding).values({ productSkuId: target.id, provider: input.provider, normalizedApiOrigin: input.normalizedApiOrigin, protocolVersion: input.protocolVersion, upstreamProductId: input.productId, upstreamSkuId: input.skuId, upstreamProductName: catalogProduct.name, upstreamSkuName: sku.name, purchaseContextJson: purchaseContext ? JSON.stringify(purchaseContext) : null, referenceCostMinor: sku.costMinor, maxCostMinor: String(target.price), previousFulfillmentSource: target.fulfillmentSource, previousDeliveryType: target.deliveryType, stockQuantity: sku.stockQuantity, remoteStatus: catalogProduct.active && sku.active ? "active" : "inactive", lastSyncedAt: now, enabled: true, createdAt: now, updatedAt: now }).returning({ id: supplierBinding.id });
  if (!created) appError("SUPPLIER_BINDING_SWITCH_FAILED");
  return { id: created.id, productSkuId: target.id, currency: account.currency };
}
