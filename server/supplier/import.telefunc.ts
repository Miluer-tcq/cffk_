import { telefuncAction } from "@/server/telefunc-action";
import { appError } from "@/lib/app-error";
import { asc, eq } from "drizzle-orm";
import { supplierProviderSchema, supplierProtocolVersionSchema } from "./schema";
import { fetchSupplierCatalog } from "./catalog";
import { associateSupplierToLocalSku, importSupplierProduct, switchSupplierBinding, unlinkSupplierBinding, updateBindingMaxCost } from "./import";
import { requireAdmin } from "@/server/telefunc-context";
import { and } from "drizzle-orm";
import { category, productSku, productV2, supplierBinding } from "@/database/drizzle/schema";

function readSourceInput(input: unknown) {
  if (!input || typeof input !== "object") appError("SUPPLIER_IMPORT_INPUT_INVALID");
  const value = input as Record<string, unknown>;
  const provider = supplierProviderSchema.safeParse(value.provider);
  const normalizedApiOrigin = typeof value.normalizedApiOrigin === "string" ? value.normalizedApiOrigin.trim() : "";
  const protocolVersion = supplierProtocolVersionSchema.safeParse(value.protocolVersion);
  if (!provider.success || !protocolVersion.success || !normalizedApiOrigin) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  return { value, provider: provider.data, normalizedApiOrigin, protocolVersion: protocolVersion.data };
}

export const onImportSupplierProduct = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuIds = Array.isArray(value.skuIds) && value.skuIds.every((id) => typeof id === "string") ? value.skuIds : [];
  const fixedMarkupMinor = typeof value.fixedMarkupMinor === "string" ? value.fixedMarkupMinor : "0";
  const markupBps = typeof value.markupBps === "number" ? value.markupBps : 0;
  const publish = value.publish === true;
  const page = typeof value.page === "number" && Number.isInteger(value.page) && value.page > 0 ? value.page : 1;
  const categoryId = typeof value.categoryId === "number" && Number.isInteger(value.categoryId) && value.categoryId > 0 ? value.categoryId : null;
  const fixedPriceMinor = typeof value.fixedPriceMinor === "string" && value.fixedPriceMinor !== "" ? value.fixedPriceMinor : null;
  if (!productId || !skuIds.length) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  const result = await fetchSupplierCatalog({ provider, normalizedApiOrigin, protocolVersion }, "", page);
  const product = result.products.find((item) => item.id === productId);
  if (!product) appError("SUPPLIER_PRODUCT_NOT_FOUND");
  return importSupplierProduct(db, { provider, normalizedApiOrigin, protocolVersion, productId, skuIds, fixedMarkupMinor, markupBps, publish, categoryId, fixedPriceMinor }, product);
});

export const onListSupplierCategories = telefuncAction(async () => {
  const { db } = requireAdmin();
  return db.select({ id: category.id, name: category.name, slug: category.slug }).from(category).where(eq(category.status, "ACTIVE")).orderBy(asc(category.sort), asc(category.id));
});

export const onListLocalSkusForAssociation = telefuncAction(async () => {
  const { db } = requireAdmin();
  const rows = await db.select({ productSkuId: productSku.id, productSkuName: productSku.name, price: productSku.price, status: productSku.status, fulfillmentSource: productSku.fulfillmentSource, deliveryType: productSku.deliveryType, productId: productV2.id, productName: productV2.name }).from(productSku).innerJoin(productV2, eq(productV2.id, productSku.productId)).orderBy(asc(productV2.name), asc(productSku.sort), asc(productSku.id));
  return rows;
});

export const onAssociateSupplierToLocalSku = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuId = typeof value.skuId === "string" ? value.skuId : "";
  const localProductSkuId = typeof value.localProductSkuId === "number" ? value.localProductSkuId : 0;
  const page = typeof value.page === "number" && Number.isInteger(value.page) && value.page > 0 ? value.page : 1;
  if (!productId || !skuId || !Number.isInteger(localProductSkuId) || localProductSkuId < 1) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  const result = await fetchSupplierCatalog({ provider, normalizedApiOrigin, protocolVersion }, "", page);
  const product = result.products.find((item) => item.id === productId);
  if (!product) appError("SUPPLIER_PRODUCT_NOT_FOUND");
  return associateSupplierToLocalSku(db, { provider, normalizedApiOrigin, protocolVersion, productId, skuId, localProductSkuId }, product);
});

export const onGetBindingCost = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuId = typeof value.skuId === "string" ? value.skuId : "";
  if (!productId || !skuId) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  const [binding] = await db.select({ id: supplierBinding.id, productSkuId: supplierBinding.productSkuId, referenceCostMinor: supplierBinding.referenceCostMinor, maxCostMinor: supplierBinding.maxCostMinor, stockQuantity: supplierBinding.stockQuantity }).from(supplierBinding).where(and(eq(supplierBinding.provider, provider), eq(supplierBinding.normalizedApiOrigin, normalizedApiOrigin), eq(supplierBinding.protocolVersion, protocolVersion), eq(supplierBinding.upstreamProductId, productId), eq(supplierBinding.upstreamSkuId, skuId), eq(supplierBinding.enabled, true))).limit(1);
  if (!binding) appError("SUPPLIER_BINDING_NOT_FOUND");
  const [local] = await db.select({ price: productSku.price }).from(productSku).where(eq(productSku.id, binding.productSkuId)).limit(1);
  return { ...binding, localPriceMinor: local ? String(local.price) : null };
});

export const onUpdateBindingMaxCost = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuId = typeof value.skuId === "string" ? value.skuId : "";
  const newMaxCostMinor = typeof value.newMaxCostMinor === "string" ? value.newMaxCostMinor : "";
  if (!productId || !skuId || !newMaxCostMinor) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  return updateBindingMaxCost(db, { provider, normalizedApiOrigin, protocolVersion, productId, skuId, newMaxCostMinor });
});

export const onUnlinkSupplierBinding = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuId = typeof value.skuId === "string" ? value.skuId : "";
  if (!productId || !skuId) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  return unlinkSupplierBinding(db, { provider, normalizedApiOrigin, protocolVersion, productId, skuId });
});

export const onSwitchSupplierBinding = telefuncAction(async (input: unknown) => {
  const { db } = requireAdmin();
  const { value, provider, normalizedApiOrigin, protocolVersion } = readSourceInput(input);
  const productSkuId = typeof value.productSkuId === "number" ? value.productSkuId : 0;
  const productId = typeof value.productId === "string" ? value.productId : "";
  const skuId = typeof value.skuId === "string" ? value.skuId : "";
  if (!Number.isInteger(productSkuId) || productSkuId < 1 || !productId || !skuId) appError("SUPPLIER_IMPORT_INPUT_INVALID");
  const result = await fetchSupplierCatalog({ provider, normalizedApiOrigin, protocolVersion }, "", 1, 100);
  const product = result.products.find((item) => item.id === productId);
  if (!product) appError("SUPPLIER_PRODUCT_NOT_FOUND");
  return switchSupplierBinding(db, { productSkuId, provider, normalizedApiOrigin, protocolVersion, productId, skuId }, product);
});
