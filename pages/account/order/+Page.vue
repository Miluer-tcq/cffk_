<template>
  <main class="min-h-screen bg-muted/30">
    <header class="fixed inset-x-0 top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div class="mx-auto flex min-h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <StorefrontBrand />
        <PublicNav />
      </div>
    </header>

    <section class="mx-auto max-w-6xl px-4 pb-12 pt-24 sm:px-6 sm:pb-16 sm:pt-28">
      <div class="mb-6">
        <h1 class="text-2xl font-semibold">{{ messages.accountOrders.title }}</h1>
        <p class="mt-1 text-sm text-muted-foreground">{{ messages.accountOrders.description }}</p>
      </div>

      <div class="grid items-stretch gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <aside class="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle class="text-base">{{ messages.accountOrders.lookup.title }}</CardTitle>
              <CardDescription>{{ messages.accountOrders.lookup.description }}</CardDescription>
            </CardHeader>
            <form novalidate @submit.prevent="submitQuery">
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel for="account-order-number">{{ messages.accountOrders.lookup.orderNumber }}</FieldLabel>
                    <Input id="account-order-number" v-model="orderNoInput" autocomplete="off" :placeholder="messages.accountOrders.lookup.placeholder" />
                  </Field>
                </FieldGroup>
                <Alert v-if="loadError" class="mt-4" variant="destructive"><AlertTitle>{{ messages.accountOrders.lookup.failed }}</AlertTitle><AlertDescription>{{ loadError }}</AlertDescription></Alert>
              </CardContent>
              <CardFooter class="pt-5"><Button type="submit" class="w-full" :disabled="loading"><SearchIcon data-icon="inline-start" />{{ loading ? messages.accountOrders.lookup.loading : messages.accountOrders.lookup.title }}</Button></CardFooter>
            </form>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle class="text-base">{{ messages.accountOrders.guestLookup.title }}</CardTitle>
              <CardDescription>{{ messages.accountOrders.guestLookup.description }}</CardDescription>
            </CardHeader>
            <CardContent><Button variant="outline" as-child><a href="/order">{{ messages.accountOrders.guestLookup.action }}</a></Button></CardContent>
          </Card>
        </aside>

        <section class="min-w-0 lg:flex" aria-live="polite">
          <Card v-if="result" class="h-full w-full">
            <CardHeader class="border-b">
              <div class="flex items-center justify-between gap-4"><div class="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground" role="link" tabindex="0" :aria-label="messages.accountOrders.backAriaLabel" @click="backToList" @keydown.enter="backToList" @keydown.space.prevent="backToList"><ArrowLeftIcon class="size-4" />{{ messages.accountOrders.back }}</div><Badge variant="outline" :class="orderStatusBadgeClass(result.status)">{{ statusLabel(result.status) }}</Badge></div>
              <CardDescription class="mt-3">{{ messages.accountOrders.detail.title }}</CardDescription>
              <div class="flex min-w-0 items-baseline justify-between gap-4"><CardTitle class="min-w-0 truncate text-xl">{{ result.productName }}</CardTitle><p class="shrink-0 break-all text-right font-mono text-xs leading-5 text-muted-foreground">{{ result.orderNo }}</p></div>
            </CardHeader>
            <CardContent class="flex flex-col gap-6 pt-6 text-sm"><dl class="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4"><div><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.quantity }}</dt><dd class="mt-1 font-medium">{{ result.quantity }}</dd></div><div><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.amount }}</dt><dd class="mt-1 font-medium">¥{{ result.amount }}</dd></div><div><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.paymentStatus }}</dt><dd class="mt-1 font-medium">{{ paymentStatusLabel(result.paymentStatus) }}</dd></div><div><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.deliveryStatus }}</dt><dd class="mt-1 font-medium">{{ deliveryStatusLabel(result.deliveryStatus) }}</dd></div><div class="col-span-2 sm:col-span-4"><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.paymentMethod }}</dt><dd class="mt-1 font-medium">{{ paymentMethodLabel }}</dd></div><div v-if="txScanUrl" class="col-span-2 sm:col-span-4"><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.txRecord }}</dt><dd class="mt-1 font-medium"><a :href="txScanUrl" target="_blank" rel="noopener noreferrer" class="text-primary underline underline-offset-4">{{ messages.accountOrders.detail.viewOnExplorer }}</a></dd></div><div v-if="result.paymentProvider === 'MANUAL_USDT' && result.paymentStatus === 'PAID' && typeof result.paymentTokenAmount === 'number' && result.paymentTokenAmount > 0" class="col-span-2 sm:col-span-4"><dt class="text-xs text-muted-foreground">{{ messages.accountOrders.detail.paidAmount }}</dt><dd class="mt-1 font-medium">{{ result.paymentTokenAmount }} {{ (result.paymentAsset ?? "").toUpperCase() }}</dd></div></dl><div v-if="result.deliveries.length" class="min-w-0 border-t pt-6"><p class="mb-3 font-medium">{{ messages.accountOrders.detail.deliveryContents }}</p><pre class="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-4 font-mono text-xs leading-6">{{ result.deliveries.join("\n") }}</pre></div><Alert v-else-if="result.paymentStatus === 'PAID'"><AlertTitle>{{ messages.accountOrders.detail.awaitingDeliveryTitle }}</AlertTitle><AlertDescription>{{ messages.accountOrders.detail.awaitingDeliveryDescription }}</AlertDescription></Alert></CardContent>
            <CardFooter v-if="result.paymentStatus === 'UNPAID' && result.status !== 'EXPIRED'" class="justify-end border-t pt-5"><Button v-if="isFaceToFacePayment" as-child><a :href="`/checkout?orderNo=${encodeURIComponent(result.orderNo)}`">{{ messages.accountOrders.payment.goToPayment }}</a></Button><Button v-else :disabled="resumingPayment" @click="resumePayment">{{ resumingPayment ? messages.accountOrders.payment.generating : messages.accountOrders.payment.resume }}</Button></CardFooter>
          </Card>
          <Card v-else class="h-full w-full lg:flex lg:flex-col"><CardHeader class="border-b"><CardDescription>{{ messages.accountOrders.list.eyebrow }}</CardDescription><CardTitle class="text-xl">{{ messages.accountOrders.list.title }}</CardTitle><p class="text-sm leading-6 text-muted-foreground">{{ messages.accountOrders.list.description }}</p></CardHeader><CardContent v-if="loading" class="p-6 text-sm text-muted-foreground">{{ messages.accountOrders.list.loading }}</CardContent><CardContent v-else-if="loadError" class="p-6"><Alert variant="destructive"><AlertTitle>{{ messages.accountOrders.list.loadFailed }}</AlertTitle><AlertDescription>{{ loadError }}</AlertDescription></Alert><Button class="mt-4" type="button" variant="outline" size="sm" @click="loadOrders">{{ messages.accountOrders.list.reload }}</Button></CardContent><CardContent v-else-if="orders.length" class="min-h-0 flex-1 overflow-hidden p-0"><OrderList :groups="[{ key: 'account', orders }]" :on-select="item => openOrder(item as AccountOrderSummary)" :status-label="statusLabel" :status-class="orderStatusBadgeClass" /></CardContent><CardContent v-else class="flex-1 p-6 text-sm text-muted-foreground">{{ messages.accountOrders.list.empty }}</CardContent><CardFooter v-if="orders.length && truncated" class="border-t pt-4 text-xs text-muted-foreground">{{ t(messages.accountOrders.list.truncated, { limit: 50 }) }}</CardFooter></Card>
        </section>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { ArrowLeftIcon, SearchIcon } from "@lucide/vue";
import { toast } from "vue-sonner";
import { usePageContext } from "vike-vue/usePageContext";

import OrderList from "@/components/storefront/OrderList.vue";
import PublicNav from "@/components/storefront/PublicNav.vue";
import StorefrontBrand from "@/components/storefront/StorefrontBrand.vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { runTelefunc, userErrorMessage } from "@/lib/telefunc-client";
import { orderStatusBadgeClass } from "@/lib/order-status-ui";
import { cacheQrPayment } from "@/lib/payment-utils";
import { getStablecoinTxScanUrl } from "@/server/payment/stablecoin";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";
import { onListAccountOrders, onQueryOrder, onResumeOrderPayment, type AccountOrderSummary, type PublicOrder } from "@/server/order/public.telefunc";

const { messages, t } = useStorefrontPreferences();
const pageContext = usePageContext();
const rawOrderNo = pageContext.urlParsed.search.orderNo;
const requestedOrderNo = (typeof rawOrderNo === "string" ? rawOrderNo : "").trim();
const orders = ref<AccountOrderSummary[]>([]);
const loading = ref(false);
const loadError = ref<string | null>(null);
const truncated = ref(false);
const result = ref<PublicOrder | null>(null);
const resumingPayment = ref(false);

const activeOrderNo = ref("");
const orderNoInput = ref(requestedOrderNo);
const isFaceToFacePayment = computed(() => result.value?.paymentChannel === "face_to_face");
const STABLECOIN_CHAIN_LABELS: Record<string, string> = { trc20: "Tron", bep20: "BSC", erc20: "Ethereum", polygon: "Polygon", arbitrum: "Arbitrum", optimism: "Optimism", base: "Base", sol: "Solana" };
const paymentMethodLabel = computed(() => {
  const p = result.value?.paymentProvider;
  if (!p) return "-";
  if (p === "MANUAL_USDT") {
    const chain = result.value?.paymentChain;
    const asset = result.value?.paymentAsset;
    if (chain && asset) {
      const chainLabel = STABLECOIN_CHAIN_LABELS[chain] ?? chain.toUpperCase();
      return `${asset.toUpperCase()} · ${chainLabel}`;
    }
    return "稳定币转账";
  }
  const labels: Record<string, string> = { ALIPAY: "支付宝", EPAY: "易支付", BEPUSDT: "BEpusdt", NOWPAYMENTS: "NOWPayments", STRIPE: "Stripe", HASHPAY: "HashPay", PERPAY: "PerPay" };
  return labels[p] ?? p;
});
/** 稳定币订单的转账记录链接(由已存的 hash + 链推导)。 */
const txScanUrl = computed(() => {
  if (result.value?.paymentProvider !== "MANUAL_USDT") return null;
  return getStablecoinTxScanUrl(result.value?.paymentChain ?? "", result.value?.paymentTxHash ?? "");
});

function submitQuery() {
  const orderNo = orderNoInput.value.trim();
  if (orderNo) void queryOrder(orderNo);
}

function backToList() {
  result.value = null;
  loadError.value = null;
}

onMounted(() => {
  void loadOrders();
  if (requestedOrderNo) void queryOrder(requestedOrderNo);
});

onUnmounted(() => { stopDeliveryPoll(); });

// 支付后发货状态轮询:订单已支付但未发货时,每 5 秒刷新一次,直到已发货(最长 2 分钟)
let deliveryPollTimer: ReturnType<typeof setInterval> | null = null;
let deliveryPollCount = 0;
function stopDeliveryPoll() {
  if (deliveryPollTimer) {
    clearInterval(deliveryPollTimer);
    deliveryPollTimer = null;
  }
}
function startDeliveryPoll() {
  stopDeliveryPoll();
  deliveryPollCount = 0;
  deliveryPollTimer = setInterval(async () => {
    deliveryPollCount += 1;
    if (!result.value || !activeOrderNo.value || deliveryPollCount > 24) { stopDeliveryPoll(); return; }
    try {
      const record = await runTelefunc(() => onQueryOrder({ orderNo: activeOrderNo.value }), { notifyError: false });
      if (!record) return;
      result.value = record;
      if (record.deliveryStatus === "DELIVERED" || record.paymentStatus !== "PAID") stopDeliveryPoll();
    } catch { /* 下一次轮询重试 */ }
  }, 5000);
}


async function loadOrders() {
  if (loading.value) return;
  loading.value = true;
  loadError.value = null;
  try {
    const response = await runTelefunc(() => onListAccountOrders(), { notifyError: false });
    orders.value = response.orders;
    truncated.value = response.truncated;
  } catch (cause) {
    loadError.value = userErrorMessage(cause);
  } finally {
    loading.value = false;
  }
}
function openOrder(item: AccountOrderSummary) { if (result.value?.orderNo === item.orderNo) return; void queryOrder(item.orderNo); }
async function queryOrder(orderNo: string) {
  result.value = null;

  activeOrderNo.value = orderNo;
  try {
    const record = await runTelefunc(() => onQueryOrder({ orderNo }), { notifyError: false });
    if (!record) { toast.error(messages.value.accountOrders.lookup.notFound); return; }
    result.value = record;
    // 已支付未发货时启动发货状态轮询;已发货/未支付时停止
    if (record.paymentStatus === "PAID" && record.deliveryStatus !== "DELIVERED") startDeliveryPoll();
    else stopDeliveryPoll();

  } catch (cause) { toast.error(userErrorMessage(cause)); }
}

async function resumePayment() {
  if (!result.value || resumingPayment.value || !activeOrderNo.value) return;
  resumingPayment.value = true;
  try {
    const payment = await runTelefunc(() => onResumeOrderPayment({ orderNo: activeOrderNo.value }), { notifyError: false });
    if (payment.payment?.mode === "redirect" && payment.payment.url) { window.location.assign(payment.payment.url); return; }
    if (payment.payment?.mode === "qr") { cacheQrPayment(payment); window.location.assign(`/checkout?orderNo=${encodeURIComponent(payment.orderNo)}`); return; }
    toast.error(messages.value.accountOrders.payment.generateFailed);
  } catch (cause) { toast.error(userErrorMessage(cause, messages.value.accountOrders.payment.resumeFailed)); } finally { resumingPayment.value = false; }
}
function statusLabel(status: string) { return ({ PENDING: messages.value.accountOrders.status.pending, PAID: messages.value.accountOrders.status.paid, DELIVERED: messages.value.accountOrders.status.delivered, CLOSED: messages.value.accountOrders.status.closed, EXPIRED: messages.value.accountOrders.status.expired, FAILED: messages.value.accountOrders.status.failed } as Record<string, string>)[status] ?? status; }
function paymentStatusLabel(status: PublicOrder["paymentStatus"]) { return { UNPAID: messages.value.accountOrders.paymentStatus.unpaid, PAID: messages.value.accountOrders.paymentStatus.paid, FAILED: messages.value.accountOrders.paymentStatus.failed }[status]; }
function deliveryStatusLabel(status: PublicOrder["deliveryStatus"]) { return { NOT_DELIVERED: messages.value.accountOrders.deliveryStatus.notDelivered, DELIVERING: messages.value.accountOrders.deliveryStatus.delivering, DELIVERED: messages.value.accountOrders.deliveryStatus.delivered, FAILED: messages.value.accountOrders.deliveryStatus.failed }[status]; }
</script>
