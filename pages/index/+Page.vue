<template>
  <div class="nj-page">
    <StorefrontHeader />

    <!-- Hero -->
    <section id="notice" class="nj-hero">
      <div class="nj-hero-inner">
        <div class="nj-hero-left">
          <div class="nj-eyebrow">DIGITAL SERVICES</div>
          <h1 class="nj-h1">{{ site.name }} <span>AI 服务一站直达</span></h1>
          <p class="nj-sub">{{ site.subtitle || "数字商品自动发货·付款后凭证即时送达" }}</p>
          <p v-if="site.notice" class="nj-notice">{{ site.notice }}</p>
        </div>
        <div class="nj-hero-right">
          <div class="nj-search">
            <SearchIcon />
            <input v-model="query" :placeholder="messages.storefront.searchProducts" aria-label="搜索商品" />
          </div>
          <button type="button" class="nj-share" @click="shareSite">
            <Share2Icon /><span>{{ messages.storefront.shareSite }}</span>
          </button>
        </div>
      </div>
    </section>

    <!-- Featured -->
    <section v-if="featured.length" class="nj-sec">
      <div class="nj-eyebrow">FEATURED</div>
      <h2 class="nj-h2">{{ messages.storefront.featured }}</h2>
      <div class="nj-feat-grid">
        <article v-for="product in featured" :key="product.id" class="nj-feat-card">
          <a :href="`/product/${product.slug}`" class="nj-feat-link">
            <h3 class="nj-feat-title"><template v-for="(seg, i) in nameParts(product.name)" :key="i"><span :style="seg.c ? `color:${seg.c}` : ''">{{ seg.t }}</span></template></h3>
            <p v-if="product.subtitle" class="nj-feat-sub">{{ product.subtitle }}</p>
            <FeaturedBanner :product="product" />
            <div class="nj-feat-foot">
              <div class="nj-price"><b>¥{{ product.price }}</b><span>起</span></div>
              <span class="nj-cta">{{ messages.storefront.viewProduct }}</span>
            </div>
          </a>
        </article>
      </div>
    </section>

    <!-- Categories + products -->
    <section class="nj-sec">
      <div class="nj-eyebrow">CATEGORIES</div>
      <h2 class="nj-h2">{{ messages.storefront.categories }}</h2>
      <div class="nj-main">
        <aside class="nj-cats">
          <button type="button" class="nj-cat" :class="{ active: selectedCategory === null }" @click="selectedCategory = null">
            <span class="nj-cat-icon nj-cat-all"><SparklesIcon /></span>
            <span class="nj-cat-name">{{ messages.storefront.allProducts }}</span>
            <span class="nj-cat-count">{{ data.products.length }}</span>
          </button>
          <button
            v-for="cat in data.categories"
            :key="cat.id"
            type="button"
            class="nj-cat"
            :class="{ active: selectedCategory === cat.id }"
            @click="selectedCategory = cat.id"
          >
            <span class="nj-cat-icon">
              <img v-if="categoryIcon(cat)" :src="categoryIcon(cat)!" :alt="cat.name" />
              <LayoutGridIcon v-else />
            </span>
            <span class="nj-cat-name">{{ cat.name }}</span>
            <span class="nj-cat-count">{{ productCount(cat.id) }}</span>
          </button>
        </aside>

        <div class="nj-grid-wrap">
          <div v-if="visibleProducts.length" class="nj-grid">
            <article v-for="(product, idx) in visibleProducts" :key="product.id" class="nj-card">
              <span v-if="isOutOfStock(product)" class="nj-corner nj-corner-sold">{{ messages.storefront.soldOut }}</span>
              <span v-else-if="idx === 0 && selectedCategory === null && !query" class="nj-corner nj-corner-hot">{{ messages.storefront.recommended }}</span>
              <a :href="`/product/${product.slug}`" class="nj-card-link">
                <FeaturedBanner :product="product" class="nj-card-banner" />
                <h3 class="nj-pname">{{ product.name }}</h3>
                <div class="nj-tags">
                  <span v-if="isAutoDelivery(product)" class="nj-tag nj-tag-green">{{ messages.storefront.autoDelivery }}</span>
                  <span class="nj-tag nj-tag-blue">{{ messages.storefront.guestPurchasable }}</span>
                </div>
                <div class="nj-pfoot">
                  <span class="nj-pprice-label">{{ messages.storefront.finalPrice }}</span>
                  <b class="nj-pprice">¥{{ product.price }}</b>
                  <span class="nj-stock" :class="stockClass(product)">{{ stockLabel(product) }}</span>
                </div>
              </a>
            </article>
          </div>
          <div v-else class="nj-empty">
            <PackageOpenIcon />
            <h3>{{ messages.storefront.noProducts }}</h3>
            <p>{{ messages.storefront.noProductsDescription }}</p>
          </div>
        </div>
      </div>
    </section>

    <StorefrontFooter />

    <a :href="supportHref" class="nj-float-service" :target="supportExternal ? '_blank' : undefined" rel="noopener noreferrer" aria-label="在线客服">
      <HeadphonesIcon /><span>{{ messages.nav.support }}</span>
    </a>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { HeadphonesIcon, LayoutGridIcon, PackageOpenIcon, SearchIcon, Share2Icon, SparklesIcon } from "@lucide/vue";
import { toast } from "vue-sonner";
import { useData } from "vike-vue/useData";
import { usePageContext } from "vike-vue/usePageContext";
import FeaturedBanner from "@/components/storefront/FeaturedBanner.vue";
import StorefrontFooter from "@/components/storefront/StorefrontFooter.vue";
import StorefrontHeader from "@/components/storefront/StorefrontHeader.vue";
import { pickBrandIcon } from "@/lib/category-icons";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";
import type { Data } from "./+data.server";

type Product = Data["products"][number];
type Category = Data["categories"][number];
type Site = {
  name: string;
  subtitle: string | null;
  logo: string | null;
  notice: string | null;
  footerText: string | null;
  supportContact: string | null;
};

const data = useData<Data>();
const pageContext = usePageContext() as unknown as { site: Site };
const site = pageContext.site;
const { messages, t } = useStorefrontPreferences();
const selectedCategory = ref<number | null>(null);
const query = ref("");

const visibleProducts = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  return data.products.filter((product) =>
    (selectedCategory.value === null || product.categoryId === selectedCategory.value)
    && (!keyword || product.name.toLowerCase().includes(keyword) || product.subtitle?.toLowerCase().includes(keyword)),
  );
});

const featured = computed(() => data.products.slice(0, 4));

function productCount(categoryId: number) {
  return data.products.filter((p) => p.categoryId === categoryId).length;
}

function categoryIcon(cat: Category): string | null {
  return pickBrandIcon(cat.name) ?? pickBrandIcon(cat.slug);
}

function productVisual(product: Product): string {
  if (product.coverImage) return product.coverImage;
  return pickBrandIcon(product.categoryName) ?? pickBrandIcon(product.name) ?? pickBrandIcon("tool") ?? "";
}

function isAutoDelivery(product: Product) {
  return product.deliveryType === "CARD_AUTO" || product.deliveryType === "FIXED_CARD" || product.deliveryType === "SUPPLIER";
}

function isOutOfStock(product: Product) {
  return product.availableStock !== null && product.availableStock <= 0;
}

function stockLabel(product: Product) {
  if (product.availableStock === null) return messages.value.storefront.stockAvailable;
  return product.availableStock > 0
    ? t(messages.value.storefront.stockCount, { count: product.availableStock })
    : messages.value.storefront.outOfStock;
}

function stockClass(product: Product) {
  if (product.availableStock === null || product.availableStock > 10) return "nj-stock-ok";
  if (product.availableStock === 0) return "nj-stock-out";
  return "nj-stock-low";
}

/** Split a product name into colored segments for the featured title. */
function nameParts(name: string): Array<{ t: string; c?: string }> {
  const rules: Array<[RegExp, string]> = [
    [/Plus/i, "#2fc4b5"],
    [/\bPro\b/i, "#8d6bff"],
    [/(\d+\s*\/\s*\d+\s*个月|\d+\s*个月)/, "#8d6bff"],
    [/成品号/, "var(--nj-text)"],
    [/旗舰版|高级版/, "#e0a63a"],
  ];
  for (const [re, color] of rules) {
    const m = name.match(re);
    if (m && m.index !== undefined) {
      const parts: Array<{ t: string; c?: string }> = [];
      if (m.index > 0) parts.push({ t: name.slice(0, m.index) });
      parts.push({ t: m[0], c: color });
      if (m.index + m[0].length < name.length) parts.push({ t: name.slice(m.index + m[0].length) });
      return parts;
    }
  }
  return [{ t: name }];
}

const supportHref = computed(() => {
  const first = (site.supportContact ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "#";
  const address = first.includes("|") ? first.slice(first.indexOf("|") + 1).trim() : first;
  return address.includes(":") ? address : `mailto:${address}`;
});
const supportExternal = computed(() => supportHref.value.startsWith("http"));

async function shareSite() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast.success("链接已复制,分享给朋友吧");
  } catch {
    toast.error("复制失败,请手动复制地址栏链接");
  }
}
</script>

<style scoped>
.nj-page { background: var(--nj-bg); min-height: 100vh; }
/* hero */
.nj-hero { padding: 34px 0 4px; }
.nj-hero-inner {
  width: min(1380px, 92vw); margin: 0 auto;
  display: flex; justify-content: space-between; align-items: flex-end; gap: 30px; flex-wrap: wrap;
}
.nj-eyebrow { font-size: 9px; font-weight: 800; letter-spacing: 0.17em; text-transform: uppercase; color: var(--nj-accent-strong); margin-bottom: 10px; }
.nj-h1 { font-size: clamp(30px, 3.4vw, 46px); font-weight: 700; color: var(--nj-text); margin: 4px 0 5px; letter-spacing: -0.04em; line-height: 1.2; }
.nj-h1 span { color: var(--nj-muted); font-weight: 700; }
.nj-sub { color: var(--nj-muted); font-size: 12px; margin: 0; line-height: 1.55; max-width: 650px; }
.nj-notice {
  display: inline-block; margin-top: 12px; font-size: 12px; color: var(--nj-accent-strong);
  background: var(--nj-accent-soft); border: 1px solid var(--nj-accent-line);
  padding: 8px 16px; border-radius: 999px;
}
.nj-hero-right { display: flex; gap: 9px; align-items: center; flex: 0 0 auto; }
.nj-search {
  display: flex; align-items: center; gap: 9px; background: var(--nj-card);
  border: 1px solid var(--nj-border); border-radius: 13px; padding: 0 14px; height: 46px; width: min(380px, 35vw);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); transition: border-color 0.15s;
}
.nj-search:focus-within { border-color: var(--nj-accent-line); }
.nj-search svg { width: 17px; height: 17px; color: var(--nj-muted); flex-shrink: 0; }
.nj-search input { border: 0; outline: 0; font-size: 14px; width: 100%; color: var(--nj-text); background: transparent; height: 100%; }
.nj-search input::placeholder { color: var(--nj-muted); }
.nj-share {
  display: flex; align-items: center; justify-content: center; gap: 7px; height: 48px; padding: 0 16px;
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 12px;
  color: var(--nj-accent-strong); font-size: 11px; font-weight: 800; cursor: pointer;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); transition: all 0.15s; white-space: nowrap;
}
.nj-share svg { width: 17px; height: 17px; }
.nj-share:hover { border-color: var(--nj-accent-line); background: var(--nj-accent-soft); }
/* sections */
.nj-sec { width: min(1380px, 92vw); margin: 0 auto; padding: 30px 0 0; }
.nj-h2 { font-size: 20px; font-weight: 700; color: var(--nj-text); margin: 2px 0 13px; letter-spacing: -0.018em; line-height: 1.25; }
/* featured */
.nj-feat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.nj-feat-card {
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 26px; padding: 22px 22px 20px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); transition: transform 0.45s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.45s, border-color 0.3s;
  overflow: hidden; position: relative; display: flex; flex-direction: column; min-height: 300px;
}
.nj-feat-card:hover { transform: translateY(-5px); border-color: var(--nj-accent-line); box-shadow: 0 20px 55px rgba(0, 0, 0, 0.45); }
.nj-feat-link { text-decoration: none; display: flex; flex-direction: column; flex: 1; }
.nj-feat-title { font-size: 24px; font-weight: 750; color: var(--nj-text); margin: 0; letter-spacing: -0.03em; line-height: 1.2; }
.nj-feat-sub { font-size: 12px; color: var(--nj-muted); margin: 6px 0 0; line-height: 1.45; }
.nj-feat-foot { display: flex; justify-content: space-between; align-items: center; padding-top: 18px; margin-top: auto; }
.nj-price b { font-size: 25px; font-weight: 750; color: var(--nj-text); letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
.nj-price span { font-size: 12px; color: var(--nj-muted); margin-left: 4px; font-weight: 400; }
.nj-cta {
  background: linear-gradient(135deg, var(--nj-accent), #67dfd4); color: var(--nj-on-accent);
  font-size: 13px; font-weight: 750; padding: 0 12px 0 17px; min-height: 38px; border-radius: 999px;
  box-shadow: 0 10px 25px rgba(18, 168, 154, 0.18); display: inline-flex; align-items: center; white-space: nowrap;
}
/* main: cats + grid */
.nj-main { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 16px; align-items: start; padding-bottom: 60px; }
.nj-cats {
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 17px; padding: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3);
  position: sticky; top: 90px; display: flex; flex-direction: column; gap: 4px; overflow: hidden;
}
.nj-cat {
  display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%;
  padding: 9px; border: 1px solid transparent; border-radius: 11px; background: transparent;
  cursor: pointer; transition: 0.15s; text-align: left; color: var(--nj-muted);
}
.nj-cat:hover, .nj-cat.active { border-color: rgba(18, 168, 154, 0.22); background: var(--nj-accent-soft); color: var(--nj-text); }
.nj-cat-icon {
  width: 34px; height: 34px; border-radius: 10px; background: var(--nj-card-2); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center; overflow: hidden; color: var(--nj-accent-strong);
}
.nj-cat-icon img { width: 100%; height: 100%; object-fit: contain; padding: 6px; background: #eef2f5; }
.nj-cat-icon svg { width: 18px; height: 18px; }
.nj-cat-all { background: linear-gradient(135deg, var(--nj-accent), #67dfd4); }
.nj-cat-all svg { color: var(--nj-on-accent); }
.nj-cat-name { font-size: 11px; font-weight: 650; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nj-cat-count {
  font-size: 8px; font-weight: 600; color: var(--nj-muted); background: var(--nj-card-2);
  min-width: 25px; padding: 3px 6px; border-radius: 999px; text-align: center; font-variant-numeric: tabular-nums; line-height: 1.2;
}
.nj-cat.active .nj-cat-count { background: var(--nj-card); color: var(--nj-accent-strong); }
/* product grid */
.nj-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.nj-card {
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 18px; padding: 20px; position: relative;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s; overflow: hidden;
  display: flex; flex-direction: column; min-height: 270px; min-width: 0;
}
.nj-card::before {
  content: ""; position: absolute; right: -50px; top: -70px; width: 135px; height: 135px;
  border-radius: 50%; background: var(--nj-accent-soft); pointer-events: none;
}
.nj-card:hover { transform: translateY(-3px); border-color: var(--nj-accent-line); box-shadow: 0 20px 55px rgba(0, 0, 0, 0.45); }
.nj-corner {
  position: absolute; top: 0; right: 0; width: 64px; height: 64px; z-index: 2;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: flex-start; justify-content: flex-end;
  padding: 10px 10px 0 0;
}
.nj-corner::before {
  content: ""; position: absolute; top: -32px; right: -32px; width: 64px; height: 64px;
  border-radius: 50%;
}
.nj-corner-hot::before { background: rgba(47, 196, 181, 0.16); }
.nj-corner-hot { color: var(--nj-accent-strong); }
.nj-corner-sold::before { background: rgba(240, 105, 122, 0.16); }
.nj-corner-sold { color: var(--destructive); }
.nj-card-link { text-decoration: none; display: flex; flex-direction: column; flex: 1; position: relative; }
.nj-card-banner {
  height: 140px; border-radius: 14px; overflow: hidden; margin: 0 0 14px;
}
.nj-card-banner .nj-banner { height: 100%; margin: 0; border-radius: 14px; }
.nj-picon {
  width: 62px; height: 62px; border-radius: 16px; overflow: hidden; margin: 0 auto 14px; flex-shrink: 0;
  background: linear-gradient(145deg, var(--nj-card-3), var(--nj-card-2));
  display: grid; place-items: center; color: var(--nj-accent-strong);
}
.nj-picon img { width: 100%; height: 100%; object-fit: contain; background: #fff; }
.nj-pname {
  font-size: 16px; font-weight: 700; color: var(--nj-text); text-align: center; margin: 0 0 3px;
  line-height: 1.4; letter-spacing: -0.012em; min-height: 48px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word;
}
.nj-tags { display: flex; gap: 6px; justify-content: center; margin: 5px 0 12px; flex-wrap: wrap; min-height: 27px; align-items: center; }
.nj-tag { font-size: 11px; font-weight: 750; padding: 4px 8px; border-radius: 999px; line-height: 1.35; white-space: nowrap; }
.nj-tag-green { background: var(--nj-accent-soft); color: var(--nj-accent-strong); }
.nj-tag-blue { background: rgba(39, 105, 168, 0.22); color: #7fb4ea; }
.nj-pfoot {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 9px;
  margin-top: auto; padding-top: 15px; border-top: 1px solid var(--nj-border);
}
.nj-pprice-label { font-size: 9px; color: var(--nj-muted); white-space: nowrap; }
.nj-pprice { font-size: 20px; font-weight: 700; color: var(--nj-text); letter-spacing: -0.03em; line-height: 1.15; font-variant-numeric: tabular-nums; }
.nj-stock { font-size: 9px; white-space: nowrap; flex-shrink: 0; color: var(--nj-accent-strong); }
.nj-stock-low { color: var(--warning, #e0a63a); }
.nj-stock-out { color: var(--destructive); }
.nj-empty {
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 18px; padding: 70px 20px; text-align: center;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); min-height: 270px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; color: var(--nj-muted);
}
.nj-empty svg { width: 44px; height: 44px; color: var(--nj-muted); }
.nj-empty h3 { font-size: 16px; color: var(--nj-text); margin: 0; }
.nj-empty p { font-size: 12px; margin: 0; }
/* floating service */
.nj-float-service {
  position: fixed; right: 18px; bottom: 30px; z-index: 40;
  display: flex; flex-direction: row; align-items: center; justify-content: center; gap: 8px;
  background: var(--nj-card); border: 1px solid var(--nj-border); border-radius: 999px; padding: 12px 18px;
  color: var(--nj-text); font-size: 14px; font-weight: 600; text-decoration: none; white-space: nowrap;
  box-shadow: 0 20px 55px rgba(0, 0, 0, 0.45);
}
.nj-float-service svg { width: 20px; height: 20px; color: var(--nj-accent-strong); flex-shrink: 0; }
.nj-float-service:hover { border-color: var(--nj-accent-line); }
@media (max-width: 1120px) {
  .nj-main { grid-template-columns: 220px minmax(0, 1fr); }
}
@media (max-width: 1024px) {
  .nj-main { grid-template-columns: 1fr; }
  .nj-cats { position: static; flex-direction: row; overflow-x: auto; }
  .nj-cat { flex-shrink: 0; }
  .nj-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .nj-h1 { font-size: 32px; }
}
@media (max-width: 640px) {
  .nj-feat-grid { grid-template-columns: 1fr; }
  .nj-hero-inner { display: grid; gap: 15px; }
  .nj-hero-right { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px; width: 100%; }
  .nj-search { width: 100%; height: 43px; }
  .nj-share { height: 43px; }
  .nj-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .nj-card { min-height: 190px; padding: 11px; border-radius: 13px; }
  .nj-picon { width: 42px; height: 42px; border-radius: 11px; }
  .nj-pname { min-height: 36px; font-size: 12px; }
  .nj-pprice { font-size: 15px; }
  .nj-main { padding-bottom: 0; }
}
</style>
