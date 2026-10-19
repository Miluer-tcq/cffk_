<!-- checkout-page-v2 -->
<template>
  <main class="min-h-screen bg-muted/30">
    <header class="fixed inset-x-0 top-0 z-50 border-b bg-background/95 backdrop-blur">
      <div class="mx-auto flex min-h-16 max-w-2xl items-center justify-between px-5">
        <StorefrontBrand />
        <PublicNav />
      </div>
    </header>

    <section class="mx-auto max-w-2xl px-5 pb-12 pt-26">
      <Card>
        <CardHeader>
          <CardTitle>订单支付</CardTitle>
          <CardDescription>{{ order ? `订单号：${order.orderNo}` : "正在确认订单信息..." }}</CardDescription>
        </CardHeader>
        <CardContent class="flex flex-col gap-6">
          <div v-if="order" class="flex flex-col gap-6">
            <dl class="grid grid-cols-2 gap-x-6 gap-y-5 text-sm sm:grid-cols-3">
              <div><dt class="text-xs text-muted-foreground">商品</dt><dd class="mt-1 font-medium">{{ order.productName || "—" }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">订单金额</dt><dd class="mt-1 font-medium">¥{{ order.amount }}</dd></div>
              <div v-if="isManualUsdtOrder(order) && stablecoinInfo"><dt class="text-xs text-muted-foreground">应付 ({{ stablecoinInfo.label }})</dt><dd class="mt-1 font-medium">${{ stablecoinInfo.tokenAmount.toFixed(2) }}</dd></div>
              <div v-else-if="payableAmount !== null"><dt class="text-xs text-muted-foreground">扫码支付</dt><dd class="mt-1 font-medium">¥{{ formatCentsAsYuan(payableAmount) }}</dd></div>
              <div><dt class="text-xs text-muted-foreground">支付状态</dt><dd class="mt-1 font-medium">{{ paymentStatusLabel(order.paymentStatus) }}</dd></div>
            </dl>
            <div v-if="order.paymentStatus === 'UNPAID' && order.status !== 'EXPIRED'" class="grid justify-items-center gap-4 border-t pt-6 text-center">
              <p v-if="countdownText" class="text-sm font-medium">支付剩余时间 <span class="font-mono text-base text-foreground">{{ countdownText }}</span></p>
              <p v-if="!qrCode && isManualUsdtOrder(order)" class="py-8 text-center text-sm text-muted-foreground">正在准备收款二维码...</p>
              <template v-if="isQrPaymentOrder(order)">
                <div v-if="isPerpayQrPaymentOrder(order) && payableAmount !== null" class="w-full rounded-xl border-2 border-primary/35 px-5 py-4 text-center shadow-sm" aria-live="polite">
                  <p class="mt-1 text-4xl font-bold tracking-tight text-primary sm:text-5xl"><span class="text-2xl sm:text-3xl">¥</span>{{ formatCentsAsYuan(payableAmount) }}</p>
                  <p class="mt-3 text-sm font-medium leading-6 text-foreground">请按此金额付款，金额必须完全一致</p>
                </div>
                <template v-if="isManualUsdtOrder(order)">
                  <div class="w-full max-w-72">
                    <PaymentQrCode v-if="qrCode && stablecoinInfo" :value="qrCode" :icon="stablecoinInfo.asset === 'usdt' ? '₮' : '$'" :icon-bg="stablecoinInfo.asset === 'usdt' ? '#26A17B' : '#2775CA'" />
                    <p v-else class="py-16 text-center text-sm text-muted-foreground">正在准备收款二维码...</p>
                  </div>
                  <p class="text-sm text-muted-foreground">仅支持接收 {{ stablecoinInfo?.chainLabel }} 资产</p>
                  <div v-if="stablecoinInfo" class="w-full rounded-xl border px-5 py-4 text-center">
                    <p class="text-2xl font-bold">{{ formatTokenAmount(stablecoinInfo.tokenAmount) }} {{ stablecoinInfo.assetLabel }}</p>
                    <p class="mt-1 text-sm text-muted-foreground">≈ ${{ formatTokenAmount(stablecoinInfo.tokenAmount) }}</p>
                    <p class="mt-2 text-xs text-muted-foreground">尾数是订单识别码,请按精确金额付款,勿四舍五入</p>
                  </div>
                  <div v-if="stablecoinInfo" class="w-full rounded-xl border px-5 py-4 text-left">
                    <p class="font-medium">{{ stablecoinInfo.assetLabel }} <span class="ml-1 rounded bg-muted px-2 py-0.5 text-xs">{{ stablecoinInfo.chainLabel }}</span></p>
                    <p class="mt-2 break-all font-mono text-sm">{{ stablecoinInfo.walletAddress }}</p>
                    <div class="mt-3 flex gap-2">
                      <Button type="button" variant="outline" size="sm" @click="copyWalletAddress">复制地址</Button>
                      <Button type="button" variant="outline" size="sm" @click="copyTokenAmount">复制金额</Button>
                    </div>
                  </div>
                  <p class="text-xs text-muted-foreground">{{ qrHintText }}</p>
                  <p v-if="checkMessage" class="text-sm" :class="checkPaid ? 'text-primary' : 'text-muted-foreground'">{{ checkMessage }}</p>
                  <div class="flex gap-3">
                    <Button v-if="!autoChecking" :disabled="checkingPayment" @click="startManualCheck">{{ checkingPayment ? "正在检查..." : "我已转账，开始检查" }}</Button>
                    <Button v-else disabled variant="outline">等待确认中 ({{ autoCheckCount }}/60)...</Button>
                  </div>
                </template>
                <template v-else>
                  <p class="font-medium">请使用支付宝扫码付款</p>
                  <div class="w-full max-w-72"><PaymentQrCode v-if="qrCode" :value="qrCode" /><p v-else class="py-16 text-sm text-muted-foreground">正在准备收款二维码...</p></div>
                  <p class="text-xs text-muted-foreground">支付完成后，页面会自动更新订单状态。</p>
                </template>
              </template>
              <p v-else class="text-sm text-muted-foreground">该订单不使用站内扫码支付，请返回订单页面继续支付。</p>
            </div>
            <Alert v-else-if="order.status === 'EXPIRED'"><AlertTitle>订单已过期</AlertTitle><AlertDescription>该订单已超过 30 分钟支付时限，请重新下单。</AlertDescription></Alert>
            <Alert v-else><AlertTitle>{{ order.paymentStatus === "PAID" ? "支付成功" : "订单已结束" }}</AlertTitle><AlertDescription>{{ order.paymentStatus === "PAID" ? "支付已确认，可返回订单查看发货进度。" : "该订单当前无法继续支付。" }}</AlertDescription></Alert>
          </div>
          <Alert v-if="error" variant="destructive"><AlertTitle>无法继续支付</AlertTitle><AlertDescription>{{ error }}</AlertDescription></Alert>
          <p v-if="!order && !error" class="py-16 text-center text-sm text-muted-foreground">正在准备收款二维码...</p>
        </CardContent>
        <CardFooter v-if="order" class="justify-end gap-3 border-t pt-5">
          <Button v-if="order.paymentStatus === 'UNPAID' && order.status !== 'EXPIRED' && isQrPaymentOrder(order)" variant="outline" :disabled="resuming" @click="resumePayment">{{ resuming ? "正在生成..." : "重新生成二维码" }}</Button>
          <Button as-child><a :href="orderHref">查看订单</a></Button>
        </CardFooter>
      </Card>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";

import PaymentQrCode from "@/components/PaymentQrCode.vue";
import PublicNav from "@/components/storefront/PublicNav.vue";
import StorefrontBrand from "@/components/storefront/StorefrontBrand.vue";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCentsAsYuan, cacheQrPayment, readCachedStablecoin } from "@/lib/payment-utils";
import { getLocalOrderGroups } from "@/lib/local-orders";
import { runTelefunc, userErrorMessage } from "@/lib/telefunc-client";
import { onQueryOrder, onResumeOrderPayment, onCheckManualUsdt, type PublicOrder } from "@/server/order/public.telefunc";
import { usePageContext } from "vike-vue/usePageContext";

const pageContext = usePageContext() as ReturnType<typeof usePageContext> & { user?: { id: string } | null };
const rawOrderNo = pageContext.urlParsed.search.orderNo;
const orderNo = (typeof rawOrderNo === "string" ? rawOrderNo : "").trim();
const guestEmail = ref<string | undefined>();
const order = ref<PublicOrder | null>(null);
const qrCode = ref("");
const payableAmount = ref<number | null>(null);
// 稳定币信息:优先用下单/恢复时缓存的,其次用订单记录的链/资产(地址需重新生成二维码时获取)
const STABLECOIN_CHAIN_LABELS: Record<string, string> = { trc20: "Tron", bep20: "BSC", erc20: "Ethereum", polygon: "Polygon", arbitrum: "Arbitrum", optimism: "Optimism", base: "Base", sol: "Solana" };
const cachedSc = ref<{ chain?: string; asset?: string; wallet?: string; tokenAmount?: number }>({});
const stablecoinInfo = computed(() => {
  if (!order.value || order.value.paymentProvider !== "MANUAL_USDT") return null;
  const chain = cachedSc.value.chain || order.value.paymentChain || "";
  const asset = cachedSc.value.asset || order.value.paymentAsset || "";
  if (!chain || !asset) return null;
  const chainLabel = STABLECOIN_CHAIN_LABELS[chain] ?? chain.toUpperCase();
  const assetLabel = asset.toUpperCase();
  return {
    chain, asset, chainLabel, assetLabel,
    label: `${assetLabel} · ${chainLabel}`,
    walletAddress: cachedSc.value.wallet || order.value.walletAddress || "",
    tokenAmount: cachedSc.value.tokenAmount ?? order.value.paymentTokenAmount ?? (payableAmount.value !== null ? payableAmount.value / 100 : 0),
  };
});
const qrHintText = computed(() => {
  const chain = stablecoinInfo.value?.chain;
  if (chain === "trc20" || chain === "sol") {
    return "扫码获取地址后,在钱包中手动选择币种并输入精确金额。";
  }
  return "用钱包 App 扫码可自动填入币种、地址与金额;若无反应请手动复制。";
});
const error = ref<string | null>(null);
const resuming = ref(false);
// 支付倒计时:订单 30 分钟过期,从建单时间算剩余 MM:SS,每秒刷新
const ORDER_EXPIRY_MS = 30 * 60 * 1000;
const remainingSeconds = ref<number | null>(null);
let countdownTimer: ReturnType<typeof setInterval> | undefined;
const countdownText = computed(() => {
  if (remainingSeconds.value === null) return "";
  const m = Math.floor(remainingSeconds.value / 60);
  const s = remainingSeconds.value % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
});
function updateCountdown() {
  if (!order.value) { remainingSeconds.value = null; return; }
  remainingSeconds.value = Math.max(0, Math.floor((new Date(order.value.createdAt).getTime() + ORDER_EXPIRY_MS - Date.now()) / 1000));
}
function startCountdown() { stopCountdown(); updateCountdown(); countdownTimer = setInterval(updateCountdown, 1000); }
function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = undefined; } }
const orderHref = computed(() => `${guestEmail.value ? "/order" : "/account/order"}${orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : ""}`);
let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  if (!orderNo) { error.value = "缺少订单号，请返回订单页面重新选择订单。"; return; }
  guestEmail.value = Object.entries(getLocalOrderGroups()).find(([, orders]) => orders.some(item => item.orderNo === orderNo))?.[0];
  if (!guestEmail.value && !pageContext.user) { error.value = "未找到本机订单，请返回订单页面使用订单号和下单邮箱查询。"; return; }
  void loadOrder();
});
onBeforeUnmount(stopPolling);
onBeforeUnmount(stopCountdown);

function queryInput() { return { orderNo, ...(guestEmail.value ? { email: guestEmail.value } : {}) }; }
// 前端直接生成稳定币二维码:查单已带回钱包地址+精确金额,无需二次请求 resume
function buildQrFromOrder(record: PublicOrder): string | null {
  if (record.paymentProvider !== "MANUAL_USDT") return null;
  const chain = record.paymentChain || cachedSc.value.chain || "";
  const asset = record.paymentAsset || cachedSc.value.asset || "";
  const wallet = record.walletAddress || cachedSc.value.wallet || "";
  const tokenAmount = record.paymentTokenAmount ?? cachedSc.value.tokenAmount;
  if (!chain || !asset || !wallet || !tokenAmount) return null;
  // EVM: EIP-681; Tron/Solana: 纯地址
  const EVM_CHAIN_IDS: Record<string, number> = { bep20: 56, erc20: 1, polygon: 137, arbitrum: 42161, optimism: 10, base: 8453 };
  const CONTRACTS: Record<string, Record<string, string>> = {
    usdt: { trc20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t", bep20: "0x55d398326f99059fF775485246999027B3197955", erc20: "0xdAC17F958D2ee523a2206206994597C13D831ec7", polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", arbitrum: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", optimism: "0x01bff41798a0bcf287b996046ca68b395dbc1071", base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", sol: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" },
    usdc: { trc20: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8", bep20: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", erc20: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", sol: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  };
  const chainId = EVM_CHAIN_IDS[chain];
  if (chainId) {
    const contract = CONTRACTS[asset]?.[chain];
    if (!contract) return null;
    const decimals = chain === "bep20" && asset === "usdt" ? 18 : chain === "bep20" && asset === "usdc" ? 18 : 6;
    const base6 = tokenAmount.toFixed(6).replace(".", "");
    const wei = base6 + "0".repeat(Math.max(0, decimals - 6));
    return `ethereum:${contract}@${chainId}/transfer?address=${wallet}&uint256=${wei}`;
  }
  return wallet;
}
async function loadOrder() {
  try {
    const record = await runTelefunc(() => onQueryOrder(queryInput()), { notifyError: false });
    if (!record) { error.value = guestEmail.value ? "订单不存在，或下单邮箱不匹配。" : "未找到当前账户下的该订单。"; return; }
    order.value = record;
    startCountdown();
    if (record.paymentStatus === "UNPAID" && isQrPaymentOrder(record)) {
      // 稳定币:优先前端直接生成二维码(查单已带回钱包+金额),0 延迟;失败再调 resume
      if (record.paymentProvider === "MANUAL_USDT") {
        const directQr = buildQrFromOrder(record);
        if (directQr) {
          qrCode.value = directQr;
          cachedSc.value = { chain: record.paymentChain || undefined, asset: record.paymentAsset || undefined, wallet: record.walletAddress || undefined, tokenAmount: record.paymentTokenAmount ?? undefined };
          try { sessionStorage.setItem(`payment-qr:${record.orderNo}`, directQr); } catch { /* ignore */ }
          startPolling();
          // 稳定币:结账页载入即自动检测转账(每 10 秒,持续 5 分钟),「我已转账」只是备选/重启入口
          if (record.paymentProvider === "MANUAL_USDT") void startManualCheck();
          return;
        }
      }
      try { qrCode.value = sessionStorage.getItem(`payment-qr:${record.orderNo}`) ?? ""; } catch { qrCode.value = ""; }
      try { const stored = Number(sessionStorage.getItem(`payment-payable:${record.orderNo}`)); payableAmount.value = Number.isSafeInteger(stored) && stored > 0 ? stored : null; } catch { payableAmount.value = null; }
      try { cachedSc.value = readCachedStablecoin(record.orderNo); } catch { cachedSc.value = {}; }
      // 稳定币订单:无二维码、缺链/资产/钱包地址时重新生成(缓存不可靠时从后端获取完整信息)
      const hasChainAsset = (cachedSc.value.chain && cachedSc.value.asset) || (record.paymentChain && record.paymentAsset);
      const hasWallet = !!(cachedSc.value.wallet);
      const needResume = !qrCode.value || (record.paymentProvider === "MANUAL_USDT" && (!hasChainAsset || !hasWallet));
      if (needResume) await resumePayment();
      startPolling();
      // 稳定币:结账页载入即自动检测转账(每 10 秒,持续 5 分钟),「我已转账」只是备选/重启入口
      if (record.paymentProvider === "MANUAL_USDT") void startManualCheck();
    }
  } catch (cause) { error.value = userErrorMessage(cause); }
}
function startPolling() { stopPolling(); pollTimer = setInterval(() => { void refreshOrder(); }, 5000); }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; } }
async function refreshOrder() {
  if (!order.value || order.value.paymentStatus !== "UNPAID") return;
  try {
    const record = await runTelefunc(() => onQueryOrder(queryInput()), { notifyError: false });
    if (!record) return;
    order.value = record;
    if (record.paymentStatus !== "UNPAID") { stopPolling(); qrCode.value = ""; payableAmount.value = null; try { sessionStorage.removeItem(`payment-qr:${record.orderNo}`); sessionStorage.removeItem(`payment-payable:${record.orderNo}`); } catch { /* Session storage is optional. */ } }
  } catch { /* The next poll retries. */ }
}
async function resumePayment() {
  if (!order.value || resuming.value) return;
  resuming.value = true;
  try {
    const payment = await runTelefunc(() => onResumeOrderPayment(queryInput()), { notifyError: false });
    if (payment.payment?.mode === "qr" && payment.payment.qrCode) {
      qrCode.value = payment.payment.qrCode;
      payableAmount.value = payment.payment.payableAmount ?? null;
      cacheQrPayment(payment);
      cachedSc.value = readCachedStablecoin(payment.orderNo);
      return;
    }
    error.value = "暂时无法生成支付二维码，请稍后再试。";
  } catch (cause) { error.value = userErrorMessage(cause, "暂时无法生成支付二维码，请稍后再试。"); } finally { resuming.value = false; }
}

// 稳定币"我已转账"检查:每10秒查一次,持续5分钟,成功直接跳转订单页
const checkingPayment = ref(false);
const autoChecking = ref(false);
const autoCheckCount = ref(0);
const checkMessage = ref("");
const checkPaid = ref(false);
let autoCheckRunning = false;
let autoCheckTimer: ReturnType<typeof setInterval> | undefined;
function stopAutoCheck() { if (autoCheckTimer) { clearInterval(autoCheckTimer); autoCheckTimer = undefined; } autoChecking.value = false; }
onBeforeUnmount(stopAutoCheck);
async function doCheckOnce(): Promise<boolean> {
  if (!order.value) return false;
  try {
    const check = await runTelefunc(() => onCheckManualUsdt({ orderNo: order.value!.orderNo }), { notifyError: false });
    checkMessage.value = check.message;
    if (check.paid) {
      checkPaid.value = true;
      stopAutoCheck();
      stopPolling();
      // 检查成功直接跳转订单页
      setTimeout(() => { window.location.assign(orderHref.value); }, 1200);
      return true;
    }
    return false;
  } catch (cause) {
    checkMessage.value = userErrorMessage(cause, "检查失败，请稍后再试。");
    return false;
  }
}
async function startManualCheck() {
  if (!order.value || autoChecking.value || checkingPayment.value) return;
  checkingPayment.value = true;
  checkMessage.value = "正在检查链上转账...";
  try {
    if (await doCheckOnce()) return;
  } finally {
    checkingPayment.value = false;
  }
  autoChecking.value = true;
  autoCheckCount.value = 0;
  autoCheckTimer = setInterval(async () => {
    autoCheckCount.value += 1;
    if (autoCheckCount.value >= 60) {
      stopAutoCheck();
      checkMessage.value = "5分钟内未检测到转账，请确认已付款或联系客服。";
      return;
    }
    // 5 秒间隔下链上查询可能慢于间隔,跳过重叠的一拍,避免并发查同一单
    if (autoCheckRunning) return;
    autoCheckRunning = true;
    try { await doCheckOnce(); } finally { autoCheckRunning = false; }
  }, 5000);
}
function copyWalletAddress() {
  const addr = stablecoinInfo.value?.walletAddress;
  if (!addr) return;
  navigator.clipboard?.writeText(addr).then(() => { checkMessage.value = "地址已复制"; }, () => { checkMessage.value = "复制失败，请手动复制"; });
}
function copyTokenAmount() {
  const amt = stablecoinInfo.value?.tokenAmount;
  if (amt == null) return;
  navigator.clipboard?.writeText(formatTokenAmount(amt)).then(() => { checkMessage.value = "金额已复制"; }, () => { checkMessage.value = "复制失败，请手动复制"; });
}
function formatTokenAmount(v: number) {
  // 去掉末尾多余的0,最多保留6位小数
  return String(Number(v.toFixed(6)));
}
function paymentStatusLabel(status: PublicOrder["paymentStatus"]) { return { UNPAID: "待支付", PAID: "已支付", FAILED: "支付失败" }[status]; }
function isQrPaymentOrder(record: PublicOrder) { return record.paymentProvider === "PERPAY" || record.paymentProvider === "MANUAL_USDT" || (record.paymentProvider === "ALIPAY" && record.paymentChannel === "face_to_face"); }
function isManualUsdtOrder(record: PublicOrder) { return record.paymentProvider === "MANUAL_USDT"; }
function isPerpayQrPaymentOrder(record: PublicOrder) { return record.paymentProvider === "PERPAY"; }
</script>
