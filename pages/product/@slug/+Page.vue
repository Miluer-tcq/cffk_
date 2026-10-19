<template>
  <div class="nj-page">
    <StorefrontHeader />
    <div class="nj-detail">
      <nav class="nj-crumb" aria-label="面包屑导航">
        <a href="/">首页</a>
        <template v-if="data.categoryName"><span class="nj-crumb-sep">/</span><span>{{ data.categoryName }}</span></template>
        <span class="nj-crumb-sep">/</span><b>{{ data.name }}</b>
      </nav>
      <div class="nj-detail-grid">
        <article class="nj-dmain">
          <div class="nj-dhero">
            <div class="nj-dicon"><img v-if="productVisual" :src="productVisual" :alt="data.name" /></div>
            <div class="nj-dinfo">
              <h1>{{ data.name }}</h1>
              <p v-if="data.subtitle" class="nj-dsub">{{ data.subtitle }}</p>
              <div class="nj-tags">
                <span v-if="isAutoDelivery" class="nj-tag nj-tag-green">自动交付</span>
                <span class="nj-tag nj-tag-blue">游客可购</span>
                <span v-if="data.categoryName" class="nj-tag nj-tag-gray">{{ data.categoryName }}</span>
              </div>
            </div>
          </div>
          <div v-if="data.coverImage" class="nj-dcover"><img :src="data.coverImage" :alt="data.name" /></div>
          <section v-if="data.description" class="nj-dcard">
            <h2>{{ messages.productCheckout.productDetails }}</h2>
            <!-- eslint-disable vue/no-v-html -->
            <div ref="descriptionRef" class="product-rich-content mt-4 text-sm leading-7 text-foreground [&_a]:text-primary [&_a]:underline [&_blockquote]:my-2 [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-2 [&_h3]:mt-3 [&_h3]:text-[1.1rem] [&_h3]:font-semibold [&_img]:my-4 [&_img]:block [&_img]:max-w-full [&_img]:cursor-zoom-in [&_img]:rounded-lg [&_img]:border [&_img]:transition-opacity [&_img]:hover:opacity-90 [&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6" @click="previewDescriptionImage" v-html="data.description" />
            <!-- eslint-enable vue/no-v-html -->
          </section>
          <section class="nj-dcard">
            <h2>{{ messages.productCheckout.purchaseInstructions }}</h2>
            <div class="mt-3 grid gap-3 text-muted-foreground"><p class="whitespace-pre-wrap">{{ purchaseNote }}</p><p v-if="deliveryHint" class="whitespace-pre-wrap">{{ deliveryHint }}</p></div>
          </section>
        </article>
        <aside class="nj-buy">
          <Card class="nj-buycard">
            <CardHeader><CardDescription>{{ messages.productCheckout.currentPrice }}</CardDescription><CardTitle class="text-3xl text-orange-600">¥{{ selectedSku.price }}</CardTitle></CardHeader><form class="grid min-w-0 gap-6" novalidate @submit.prevent="submit">
              <CardContent class="grid min-w-0 gap-4">
                <div v-if="data.skus.length > 1" class="grid gap-2 text-sm font-medium">
                  <span>选择规格</span>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="选择规格">
                    <Button v-for="sku in data.skus" :key="sku.id" type="button" :variant="String(sku.id) === selectedSkuId ? 'default' : 'outline'" class="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left text-sm leading-5" :aria-pressed="String(sku.id) === selectedSkuId" @click="selectedSkuId = String(sku.id)">
                      {{ sku.name }} · ¥{{ sku.price }}
                    </Button>
                  </div>
                </div>
                <p v-if="requiresPayment && !methods.length" class="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{{ messages.productCheckout.noPaymentMethod }}</p>
                <label class="grid min-w-0 gap-2 text-sm font-medium"><span class="flex items-center gap-1"><span class="text-destructive">*</span> {{ messages.productCheckout.contactEmail }}</span><Input v-model="contactValue" type="email" autocomplete="email" required /></label>
                <label class="grid min-w-0 gap-2 text-sm font-medium"><span class="flex items-center gap-1"><span class="text-destructive">*</span> {{ messages.productCheckout.quantity }}</span><Input v-model.number="quantity" type="number" :min="selectedSku.minBuy" :max="purchaseLimit" required /><span v-if="isStockLimited" class="text-xs font-normal text-muted-foreground">{{ t(messages.productCheckout.availableStock, { count: availableStock }) }}</span></label>
                <FieldSet v-if="selectedSku.deliveryType === 'EXPRESS'" class="min-w-0 gap-4">
                  <FieldLegend>{{ messages.productCheckout.shippingAddress }}</FieldLegend>
                  <Field v-if="addresses.length" class="min-w-0"><FieldLabel for="checkout-address">{{ messages.productCheckout.selectSavedAddress }}</FieldLabel><Select :model-value="selectedAddress" class="block w-full min-w-0" @update:model-value="onAddressSelectionChange"><SelectTrigger id="checkout-address" class="w-full! min-w-0 max-w-full **:data-[slot=select-value]:min-w-0 **:data-[slot=select-value]:flex-1 **:data-[slot=select-value]:truncate"><SelectValue :placeholder="messages.productCheckout.selectShippingAddress" /></SelectTrigger><SelectContent><SelectItem v-for="item in addresses" :key="String(item.id)" :value="String(item.id)">{{ item.recipientName }} · {{ item.phone }} · {{ addressSummary(item) }}</SelectItem><SelectItem value="new">{{ messages.productCheckout.enterNewAddress }}</SelectItem><SelectItem v-if="!user" value="clear-local-addresses" class="text-destructive focus:text-destructive">{{ messages.productCheckout.clearBrowserAddresses }}</SelectItem></SelectContent></Select></Field>
                  <p v-else-if="addressesLoading" class="text-sm text-muted-foreground">{{ messages.productCheckout.loadingSavedAddresses }}</p>
                  <div v-if="selectedAddress === 'new' || !addresses.length" class="grid gap-4 sm:grid-cols-2">
                    <VeeField v-for="field in addressFieldsWithoutPostalCode" :key="field.name" v-slot="{ componentField, errors }" :name="field.name" :validate-on-input="true"><Field :class="'wide' in field && field.wide ? 'sm:col-span-2' : ''" :data-invalid="errors.length > 0"><FieldLabel :for="`checkout-${field.name}`"><span v-if="field.required" class="text-destructive">*</span> {{ field.label }}</FieldLabel><Input :id="`checkout-${field.name}`" v-bind="componentField" :autocomplete="field.autocomplete" :aria-invalid="errors.length > 0" /><FieldError v-if="errors.length" :errors="errors" /></Field></VeeField>
                    <div class="grid gap-4 sm:col-span-2">
                      <VeeField v-slot="{ componentField, errors }" name="postalCode" :validate-on-input="true"><Field :data-invalid="errors.length > 0"><FieldLabel for="checkout-postalCode">{{ messages.productCheckout.address.postalCode }}</FieldLabel><Input id="checkout-postalCode" v-bind="componentField" autocomplete="postal-code" :aria-invalid="errors.length > 0" /><FieldError v-if="errors.length" :errors="errors" /></Field></VeeField>
                      <Button type="button" variant="outline" class="w-full" :disabled="savingAddress" @click="saveCurrentAddress">{{ savingAddress ? messages.productCheckout.savingAddress : messages.productCheckout.saveAddress }}</Button>
                    </div>
                  </div>
                </FieldSet>
                <div v-if="methods.length" class="grid gap-2 text-sm font-medium">
                  <span>{{ messages.productCheckout.paymentMethod }}</span>
                  <div class="grid grid-cols-2 gap-2" role="group" :aria-label="messages.productCheckout.paymentMethod">
                    <Button
                      v-for="item in methods"
                      :key="item.key"
                      type="button"
                      :variant="selectedMethod === item.key ? 'default' : 'outline'"
                      class="h-auto min-h-10 justify-start whitespace-normal px-3 py-2 text-left text-sm leading-5"
                      :aria-pressed="selectedMethod === item.key"
                      @click="selectedMethod = item.key"
                    >
                      {{ item.name }}{{ item.channel && !(item.provider === "ALIPAY" && item.channel === "face_to_face") ? `（${channelLabel(item.channel)}）` : "" }}
                    </Button>
                  </div>
                  <!-- 稳定币收款:折叠选择链与资产 -->
                  <div v-if="selectedMethodInfo?.provider === 'MANUAL_USDT'" class="rounded-md border bg-muted/30 p-3">
                    <p class="mb-2 text-xs text-muted-foreground">选择链</p>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        v-for="chain in selectedMethodInfo.stablecoinChains ?? []"
                        :key="chain"
                        type="button"
                        size="sm"
                        :variant="selectedStablecoinChain === chain ? 'default' : 'outline'"
                        @click="selectedStablecoinChain = chain"
                      >{{ STABLECOIN_CHAIN_LABELS[chain] ?? chain }}</Button>
                    </div>
                    <p class="mb-2 mt-3 text-xs text-muted-foreground">选择资产</p>
                    <div class="flex flex-wrap gap-2">
                      <Button
                        v-for="asset in availableStablecoinAssets"
                        :key="asset"
                        type="button"
                        size="sm"
                        :variant="selectedStablecoinAsset === asset ? 'default' : 'outline'"
                        @click="selectedStablecoinAsset = asset"
                      >{{ asset.toUpperCase() }}</Button>
                    </div>
                  </div>
                </div>
                <div v-if="discountPreview" class="grid gap-1 rounded-md border bg-muted/30 p-3 text-sm"><div class="flex justify-between gap-4"><span class="text-muted-foreground">{{ messages.productCheckout.originalAmount }}</span><span>¥{{ discountPreview.originalAmount }}</span></div><div class="flex justify-between gap-4"><span class="text-muted-foreground">{{ t(messages.productCheckout.appliedDiscount, { code: discountPreview.code }) }}</span><span class="text-destructive">-¥{{ discountPreview.discountAmount }}</span></div><div class="flex justify-between gap-4 border-t pt-2 font-medium"><span>{{ messages.productCheckout.amountDue }}</span><span>¥{{ discountPreview.finalAmount }}</span></div></div>
              </CardContent><CardFooter class="flex-col items-stretch gap-3"><Button type="submit" :disabled="loading || isOutOfStock || (requiresPayment && !methods.length)">{{ loading ? messages.productCheckout.processingOrder : isOutOfStock ? messages.storefront.outOfStock : requiresPayment ? messages.productCheckout.submitAndPay : messages.productCheckout.createFreeOrder }}</Button><p class="text-xs text-muted-foreground">{{ messages.productCheckout.paymentAmountNotice }}</p></CardFooter>
            </form>
          </Card>
        </aside>
      </div>
    </div>
    <StorefrontFooter />
    <Dialog :open="Boolean(previewImage)" @update:open="(open) => { if (!open) previewImage = null; }">
      <DialogContent :show-close-button="false" class="w-fit! max-w-[calc(100vw-2rem)]! border-0 bg-transparent p-0 shadow-none sm:max-w-[calc(100vw-4rem)]!" @interact-outside="previewImage = null">
        <DialogTitle class="sr-only">{{ messages.productCheckout.imagePreview }}</DialogTitle>
        <div class="relative inline-flex">
          <img v-if="previewImage" :src="previewImage.src" :alt="previewImage.alt" class="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] rounded-lg object-contain sm:max-w-[calc(100vw-4rem)]" />
          <DialogClose as-child><Button type="button" variant="ghost" size="icon" class="absolute right-2 top-2 size-10 rounded-full bg-black/55 text-white hover:bg-black/75 hover:text-white" :aria-label="messages.productCheckout.closeImagePreview"><XIcon /></Button></DialogClose>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog :open="clearAddressesDialogOpen" @update:open="(open) => { clearAddressesDialogOpen = open; if (!open) selectedAddress = previousAddressSelection; }">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ messages.productCheckout.confirmClearAddressesTitle }}</DialogTitle>
          <DialogDescription>{{ messages.productCheckout.confirmClearAddressesDescription }}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" @click="clearAddressesDialogOpen = false">{{ messages.productCheckout.cancel }}</Button>
          <Button type="button" variant="destructive" @click="confirmClearSavedAddresses">{{ messages.productCheckout.confirmClearAddresses }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>
<script lang="ts" setup>
import { computed, onMounted, ref, watch } from "vue";
import { pickBrandIcon } from "@/lib/category-icons";
import { toTypedSchema } from "@vee-validate/zod";
import { Field as VeeField, useForm } from "vee-validate";
import { z } from "zod";
import { XIcon } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useData } from "vike-vue/useData";
import { usePageContext } from "vike-vue/usePageContext";

import StorefrontFooter from "@/components/storefront/StorefrontFooter.vue";
import StorefrontHeader from "@/components/storefront/StorefrontHeader.vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

import { clearLocalAddresses, getLocalAddresses, saveLocalAddress, type LocalAddress } from "@/lib/local-addresses";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";
import { saveGuestOrder } from "@/lib/local-orders";
import { cacheQrPayment } from "@/lib/payment-utils";
import { runTelefunc, userErrorMessage } from "@/lib/telefunc-client";
import { onCreateAddress, onListAddresses } from "@/server/address/index.telefunc";
import { onPreviewDiscount } from "@/server/discount/preview.telefunc";
import { onCreatePayment } from "@/server/payment/checkout.telefunc";
import type { PaymentChannel, PaymentProviderKind } from "@/server/payment/registry";
import type { Data } from "./+data.server";
const { messages, t } = useStorefrontPreferences();
const data = useData<Data>();
const productVisual = computed(() => data.coverImage || pickBrandIcon(data.categoryName) || pickBrandIcon(data.name) || pickBrandIcon("tool") || "");
const isAutoDelivery = computed(() => ["CARD_AUTO", "FIXED_CARD", "SUPPLIER"].includes(selectedSku.value.deliveryType));
const pageContext = usePageContext() as ReturnType<typeof usePageContext> & { user?: { id: string; email?: string | null } | null };
const user = pageContext.user ?? null;
type Address = Awaited<ReturnType<typeof onListAddresses>>[number];
type SavedAddress = Address | LocalAddress;
type AddressForm = { recipientName: string; phone: string; country: string; province: string; city: string; district: string; addressLine: string; postalCode: string };
type PaymentMethod = { key: string; provider: PaymentProviderKind; providerId: number; channel?: PaymentChannel; name: string; stablecoinChains?: string[]; stablecoinAssets?: string[] };
const STABLECOIN_CHAIN_LABELS: Record<string, string> = { trc20: "Tron", bep20: "BSC", erc20: "Ethereum", polygon: "Polygon", arbitrum: "Arbitrum", optimism: "Optimism", base: "Base", sol: "Solana" };
const methods = computed<PaymentMethod[]>(() => {
  const all = data.paymentProviders.flatMap((provider): PaymentMethod[] => provider.channels.length ? provider.channels.map((channel) => ({ key: `${provider.id}:${channel}`, provider: provider.provider, providerId: provider.id, channel, name: provider.name })) : [{ key: `${provider.id}:`, provider: provider.provider, providerId: provider.id, name: provider.name, stablecoinChains: (provider as { stablecoinChains?: string[] }).stablecoinChains, stablecoinAssets: (provider as { stablecoinAssets?: string[] }).stablecoinAssets }]);
  // 支付宝放第一位(同时成为默认选中),其余保持原顺序
  return [...all].sort((a, b) => (a.provider === "ALIPAY" ? 0 : 1) - (b.provider === "ALIPAY" ? 0 : 1));
});
const purchaseNote = computed(() => data.purchaseNote || messages.value.productCheckout.defaultPurchaseNote);
const deliveryHint = computed(() => {
  if (selectedSku.value.deliveryType === "MANUAL") return data.manualDeliveryHint || messages.value.productCheckout.defaultManualDeliveryHint;
  if (selectedSku.value.deliveryType === "EXPRESS") return data.manualDeliveryHint || messages.value.productCheckout.defaultExpressDeliveryHint;
  return null;
});
const descriptionRef = ref<HTMLElement | null>(null); const previewImage = ref<{ src: string; alt: string } | null>(null);
const selectedMethod = ref(methods.value[0]?.key ?? ""); const selectedSkuId = ref(String(data.skus[0]?.id ?? "")); const selectedSku = computed(() => data.skus.find((sku) => String(sku.id) === selectedSkuId.value) ?? data.skus[0] ?? data); const quantity = ref(selectedSku.value.minBuy);
const selectedStablecoinChain = ref("");
const selectedStablecoinAsset = ref("");
const selectedMethodInfo = computed(() => methods.value.find((item) => item.key === selectedMethod.value));
// 该链支持的资产 (如 TRON 只支持 USDT),取链与渠道启用的交集
const CHAIN_ASSET_MAP: Record<string, string[]> = { trc20: ["usdt", "usdc"], bep20: ["usdt", "usdc"], erc20: ["usdt", "usdc"], polygon: ["usdt", "usdc"], arbitrum: ["usdt", "usdc"], optimism: ["usdt", "usdc"], base: ["usdt", "usdc"], sol: ["usdt", "usdc"] };
const availableStablecoinAssets = computed(() => {
  const chainAssets = CHAIN_ASSET_MAP[selectedStablecoinChain.value] ?? [];
  const channelAssets = selectedMethodInfo.value?.stablecoinAssets ?? [];
  return chainAssets.filter((a) => channelAssets.includes(a));
});
watch(selectedMethodInfo, (method) => {
  if (method?.provider === "MANUAL_USDT") {
    if (!method.stablecoinChains?.includes(selectedStablecoinChain.value)) selectedStablecoinChain.value = method.stablecoinChains?.[0] ?? "";
    if (!availableStablecoinAssets.value.includes(selectedStablecoinAsset.value)) selectedStablecoinAsset.value = availableStablecoinAssets.value[0] ?? "";
  }
}, { immediate: true });
watch(selectedStablecoinChain, () => {
  if (!availableStablecoinAssets.value.includes(selectedStablecoinAsset.value)) selectedStablecoinAsset.value = availableStablecoinAssets.value[0] ?? "";
});
watch(selectedSku, (sku) => { if (sku) { quantity.value = sku.minBuy; discountPreview.value = null; } });
const contactValue = ref(user?.email?.trim() ?? ""); const discountCode = ref(""); const discountApplying = ref(false); type DiscountPreview = Awaited<ReturnType<typeof onPreviewDiscount>>; const discountPreview = ref<DiscountPreview | null>(null); const loading = ref(false);
const addresses = ref<SavedAddress[]>([]); const addressesLoading = ref(false); const selectedAddress = ref("new"); const previousAddressSelection = ref("new"); const clearAddressesDialogOpen = ref(false); const savingAddress = ref(false);
const addressSchema = z.object({ recipientName: z.string().trim().min(1, messages.value.productCheckout.validation.recipientNameRequired).max(100), phone: z.string().trim().regex(/^[0-9+()\-\s]{5,32}$/, messages.value.productCheckout.validation.phoneInvalid), country: z.string().trim().min(1, messages.value.productCheckout.validation.countryRequired).max(100), province: z.string().trim().min(1, messages.value.productCheckout.validation.provinceRequired).max(100), city: z.string().trim().min(1, messages.value.productCheckout.validation.cityRequired).max(100), district: z.string().trim().min(1, messages.value.productCheckout.validation.districtRequired).max(100), addressLine: z.string().trim().min(1, messages.value.productCheckout.validation.addressLineRequired).max(500), postalCode: z.string().trim().max(20).refine((value) => !value || /^[A-Za-z0-9][A-Za-z0-9\- ]{0,19}$/.test(value), messages.value.productCheckout.validation.postalCodeInvalid) });
const { handleSubmit, validate, values } = useForm<AddressForm>({ validationSchema: toTypedSchema(addressSchema), initialValues: { recipientName: "", phone: "", country: messages.value.productCheckout.address.defaultCountry, province: "", city: "", district: "", addressLine: "", postalCode: "" }, keepValuesOnUnmount: true });
const addressFields = computed(() => [{ name: "recipientName", label: messages.value.productCheckout.address.recipientName, autocomplete: "name", required: true }, { name: "phone", label: messages.value.productCheckout.address.phone, autocomplete: "tel", required: true }, { name: "country", label: messages.value.productCheckout.address.country, autocomplete: "country-name", required: true }, { name: "province", label: messages.value.productCheckout.address.province, autocomplete: "address-level1", required: true }, { name: "city", label: messages.value.productCheckout.address.city, autocomplete: "address-level2", required: true }, { name: "district", label: messages.value.productCheckout.address.district, autocomplete: "address-level3", required: true }, { name: "addressLine", label: messages.value.productCheckout.address.addressLine, autocomplete: "street-address", required: true, wide: true }, { name: "postalCode", label: messages.value.productCheckout.address.postalCode, autocomplete: "postal-code", required: false }] as const);
const addressFieldsWithoutPostalCode = computed(() => addressFields.value.filter((field) => field.name !== "postalCode"));
const requiresPayment = computed(() => (discountPreview.value?.finalAmount ?? selectedSku.value.price) !== "0.00");
const isStockLimited = computed(() => selectedSku.value.availableStock !== null);
const availableStock = computed(() => selectedSku.value.availableStock ?? 0);
const purchaseLimit = computed(() => isStockLimited.value ? Math.max(selectedSku.value.minBuy, Math.min(selectedSku.value.maxBuy, availableStock.value)) : selectedSku.value.maxBuy);
const isOutOfStock = computed(() => isStockLimited.value && availableStock.value < selectedSku.value.minBuy);
watch([discountCode, quantity], () => { discountPreview.value = null; });
function previewDescriptionImage(event: MouseEvent) { const image = event.target instanceof HTMLImageElement ? event.target : null; if (image && descriptionRef.value?.contains(image)) previewImage.value = { src: image.currentSrc || image.src, alt: image.alt || data.name }; }
async function onApplyDiscount() { const code = discountCode.value; if (!code.trim()) return; const requestedQuantity = quantity.value; const requestedSkuId = selectedSku.value.id; discountPreview.value = null; discountApplying.value = true; try { const preview = await runTelefunc(() => onPreviewDiscount({ productId: data.id, productSkuId: requestedSkuId, quantity: requestedQuantity, discountCode: code }), { notifyError: false }); if (discountCode.value === code && quantity.value === requestedQuantity && selectedSku.value.id === requestedSkuId) discountPreview.value = preview; } catch (cause) { if (discountCode.value === code && quantity.value === requestedQuantity && selectedSku.value.id === requestedSkuId) toast.error(userErrorMessage(cause, messages.value.productCheckout.discountPreviewFailed)); } finally { discountApplying.value = false; } }
async function onSubmit(address: AddressForm) { if (isOutOfStock.value || (isStockLimited.value && quantity.value > availableStock.value)) { toast.error(messages.value.productCheckout.insufficientStock); return; } if (discountCode.value.trim() && !discountPreview.value) { toast.info(messages.value.productCheckout.applyDiscountFirst); return; } const method = methods.value.find((item) => item.key === selectedMethod.value); if (!method && requiresPayment.value) { toast.error(messages.value.productCheckout.noPaymentMethod); return; } const savedAddress = addresses.value.find((item) => String(item.id) === selectedAddress.value); const useStoredAddress = selectedSku.value.deliveryType === "EXPRESS" && selectedAddress.value !== "new" && savedAddress; const expressAddress = selectedSku.value.deliveryType === "EXPRESS" ? (useStoredAddress ? (user ? { addressId: Number(savedAddress.id) } : { address: { recipientName: savedAddress.recipientName, phone: savedAddress.phone, country: savedAddress.country, province: savedAddress.province, city: savedAddress.city, district: savedAddress.district, addressLine: savedAddress.addressLine, postalCode: savedAddress.postalCode || undefined } }) : { address: { ...address, postalCode: address.postalCode || undefined } }) : {}; loading.value = true; try { const created = await runTelefunc(() => onCreatePayment({ productId: data.id, productSkuId: selectedSku.value.id, quantity: quantity.value, paymentProvider: method?.provider ?? "ALIPAY", paymentProviderId: method?.providerId, paymentChannel: method?.channel, ...(method?.provider === "MANUAL_USDT" ? { paymentChain: selectedStablecoinChain.value || undefined, paymentAsset: selectedStablecoinAsset.value || undefined } : {}), contactType: "EMAIL", contactValue: contactValue.value, ...expressAddress, discountCode: discountPreview.value?.code }), { notifyError: false }); if (!pageContext.user) saveGuestOrder(contactValue.value, { orderNo: created.orderNo, productName: data.name, amount: requiresPayment.value ? (discountPreview.value?.finalAmount ?? selectedSku.value.price) : "0.00", createdAt: new Date().toISOString(), status: "PENDING" }); if (created.payment?.mode === "redirect" && created.payment.url) { window.location.assign(created.payment.url); return; } if (created.payment?.mode === "qr") { cacheQrPayment(created); window.location.assign(`/checkout?orderNo=${encodeURIComponent(created.orderNo)}`); return; } window.location.assign(`${pageContext.user ? "/account/order" : "/order"}?orderNo=${encodeURIComponent(created.orderNo)}`); } catch (cause) { toast.error(userErrorMessage(cause, messages.value.productCheckout.orderSubmissionFailed)); } finally { loading.value = false; } }
const submitAddress = handleSubmit(onSubmit, () => toast.error(messages.value.productCheckout.shippingAddressIncomplete));
function submit(event: Event) {
  const requiresAddressForm = selectedSku.value.deliveryType === "EXPRESS" && (!user || selectedAddress.value === "new" || !addresses.value.length);
  if (requiresAddressForm) return submitAddress(event);
  void onSubmit({ recipientName: "", phone: "", country: "", province: "", city: "", district: "", addressLine: "", postalCode: "" });
}
async function saveCurrentAddress() { const result = await validate(); if (!result.valid) { toast.error(messages.value.productCheckout.shippingAddressIncomplete); return; } savingAddress.value = true; try { const input = { ...values, postalCode: values.postalCode || undefined, isDefault: addresses.value.length === 0 }; const saved = user ? await runTelefunc(() => onCreateAddress(input), { notifyError: false }) : saveLocalAddress({ ...input, postalCode: input.postalCode ?? null }); if (!saved) { toast.error(messages.value.productCheckout.addressSaveStorageFailed); return; } addresses.value = [...addresses.value, saved]; selectedAddress.value = String(saved.id); toast.success(messages.value.productCheckout.addressSaved); } catch (cause) { toast.error(userErrorMessage(cause, messages.value.productCheckout.addressSaveFailed)); } finally { savingAddress.value = false; } }
function onAddressSelectionChange(value: unknown) { if (value === "clear-local-addresses") { previousAddressSelection.value = selectedAddress.value; clearAddressesDialogOpen.value = true; return; } if (typeof value === "string") selectedAddress.value = value; }
function confirmClearSavedAddresses() { if (!clearLocalAddresses()) { toast.error(messages.value.productCheckout.clearAddressesFailed); return; } addresses.value = []; selectedAddress.value = "new"; clearAddressesDialogOpen.value = false; toast.success(messages.value.productCheckout.addressesCleared); }
async function loadAddresses() { if (selectedSku.value.deliveryType !== "EXPRESS") return; addressesLoading.value = true; try { addresses.value = user ? await runTelefunc(() => onListAddresses(), { notifyError: false }) : getLocalAddresses(); const preferred = addresses.value.find((item) => item.isDefault) ?? addresses.value[0]; selectedAddress.value = preferred ? String(preferred.id) : "new"; } catch (cause) { toast.error(userErrorMessage(cause, messages.value.productCheckout.addressLoadFailed)); selectedAddress.value = "new"; } finally { addressesLoading.value = false; } }
function addressSummary(address: SavedAddress) { return `${address.province}${address.city}${address.district}${address.addressLine}`; }
onMounted(loadAddresses);
function channelLabel(channel: string) { return ({ web: messages.value.productCheckout.paymentChannels.web, wap: messages.value.productCheckout.paymentChannels.wap, face_to_face: messages.value.productCheckout.paymentChannels.faceToFace, alipay: messages.value.productCheckout.paymentChannels.alipay, wxpay: messages.value.productCheckout.paymentChannels.wxpay } as Record<string, string>)[channel] ?? channel; }
</script>

<style scoped>
.nj-page { background: var(--nj-bg); min-height: 100vh; }
.nj-detail { max-width: 1200px; margin: 0 auto; padding: 26px 24px 10px; }
.nj-crumb { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--nj-muted); margin-bottom: 18px; }
.nj-crumb a { color: var(--nj-muted); text-decoration: none; }
.nj-crumb a:hover { color: #2fc4b5; }
.nj-crumb-sep { color: var(--nj-muted); }
.nj-crumb b { color: var(--nj-text); font-weight: 600; }
.nj-detail-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 22px; align-items: start; }
.nj-dmain { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.nj-dhero {
  background: var(--nj-card); border-radius: 22px; padding: 28px;
  display: flex; gap: 22px; align-items: center;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.nj-dicon {
  width: 96px; height: 96px; border-radius: 24px; overflow: hidden; flex-shrink: 0;
  background: var(--nj-bg); box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
}
.nj-dicon img { width: 100%; height: 100%; object-fit: cover; }
.nj-dinfo h1 { font-size: 26px; font-weight: 800; color: var(--nj-text); margin: 0; }
.nj-dsub { font-size: 14px; color: var(--nj-muted); margin: 8px 0 0; }
.nj-tags { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.nj-tag { font-size: 12px; font-weight: 600; padding: 5px 13px; border-radius: 999px; }
.nj-tag-green { background: rgba(20, 184, 166, 0.12); color: var(--nj-accent-strong); }
.nj-tag-blue { background: rgba(59, 130, 246, 0.1); color: #2563eb; }
.nj-tag-gray { background: var(--nj-bg); color: var(--nj-text-2); }
.nj-dcover { background: var(--nj-card); border-radius: 22px; overflow: hidden; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04); }
.nj-dcover img { width: 100%; max-height: 420px; object-fit: cover; display: block; }
.nj-dcard {
  background: var(--nj-card); border-radius: 22px; padding: 26px 28px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.04);
}
.nj-dcard h2 { font-size: 16px; font-weight: 700; color: var(--nj-text); margin: 0 0 4px; }
.nj-buy { position: sticky; top: 84px; }
.nj-buycard { border-radius: 22px !important; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06) !important; border: 1px solid var(--nj-border) !important; }
@media (max-width: 1024px) {
  .nj-detail-grid { grid-template-columns: 1fr; }
  .nj-buy { position: static; }
}
</style>

<style>
/* 浅色模式:商品描述是 v-html 渲染的富文本,里面可能写死了深色模式的配色
   (白字 / 深色底 / 彩色字)。浅色下任何写死的颜色都不可信,一律重置为主题色,
   保证可读;深色模式保持原文排版不变。(v-html 内容不受 scoped 限制,需全局样式) */
html:not(.dark) .product-rich-content [style],
html:not(.dark) .product-rich-content font[color],
html:not(.dark) .product-rich-content [color] {
  color: var(--nj-text) !important;
  -webkit-text-fill-color: var(--nj-text) !important;
  background-color: transparent !important;
  background-image: none !important;
  border-color: var(--nj-border) !important;
}
/* 链接在浅色下保持主题强调色,不跟正文一起变黑 */
html:not(.dark) .product-rich-content a[style] {
  color: var(--primary) !important;
  -webkit-text-fill-color: var(--primary) !important;
}
</style>
