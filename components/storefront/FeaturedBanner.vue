<template>
  <div class="nj-banner">
    <img v-if="product.coverImage" :src="product.coverImage" :alt="product.name" class="nj-banner-img" />
    <template v-else-if="variant === 'chatgpt'">
      <div class="ccard cc-back"><span class="cc-brand">ChatGPT</span><span class="cc-name">Pro</span><span class="cc-num">80</span></div>
      <div class="ccard cc-front"><span class="cc-brand">ChatGPT</span><span class="cc-name">Plus</span><span class="cc-price">¥118</span></div>
      <span class="cdot" style="left:8%;top:18%"></span><span class="cdot" style="right:10%;bottom:20%"></span>
    </template>
    <template v-else-if="variant === 'gemini'">
      <svg class="gorb" viewBox="0 0 220 90"><ellipse cx="110" cy="45" rx="102" ry="36" fill="none" stroke="#E7DEFF" stroke-width="1.6" opacity=".7"/></svg>
      <svg class="gstar" viewBox="0 0 24 24"><defs><linearGradient id="nj-gsg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBF8FF"/><stop offset="1" stop-color="#DCCFFF"/></linearGradient></defs><path d="M12 1C13.2 8.2 15.8 10.8 23 12 15.8 13.2 13.2 15.8 12 23 10.8 15.8 8.2 13.2 1 12 8.2 10.8 10.8 8.2 12 1Z" fill="url(#nj-gsg)"/></svg>
      <span class="gspk" style="left:12%;top:22%"></span><span class="gspk" style="left:8%;bottom:26%;width:8px;height:8px"></span><span class="gspk" style="left:44%;top:16%;width:10px;height:10px"></span>
      <div class="g18"><b>18</b><i>个月</i></div><div class="g18s">Pro 会员,尽情探索</div>
    </template>
    <template v-else-if="variant === 'x'">
      <div class="xcard xcard-b"></div>
      <div class="xcard xcard-f"><span class="xx">𝕏</span><span class="xt">Premium</span><span class="xm">3 / 6 MONTHS</span></div>
    </template>
    <template v-else-if="variant === 'muse'">
      <img class="musebig" :src="ICON_MUSE" alt="Muse" />
      <span class="pill10" style="left:22%;top:14%">+10 亿</span><span class="pill10" style="right:20%;top:30%">+10 亿</span><span class="pill10" style="left:28%;bottom:12%">+10 亿</span>
      <span class="mdot" style="left:14%;top:62%"></span><span class="mdot" style="right:14%;bottom:20%;width:14px;height:14px"></span><span class="mdot" style="right:38%;top:10%;width:8px;height:8px"></span>
    </template>
    <template v-else-if="variant === 'duolingo'">
      <img v-if="fallbackIcon" :src="fallbackIcon" alt="Duolingo" class="duobig" />
      <span class="gcirc" style="left:10%;top:20%"></span><span class="gcirc" style="right:12%;bottom:24%"></span>
      <div class="d1"><b>1</b><i>年</i></div><div class="d1s">Super 会员,快乐学习</div>
    </template>
    <template v-else-if="variant === 'adobe'">
      <svg class="adobe-a" viewBox="0 0 100 100"><path d="M50 10 L90 90 L70 90 L50 45 L30 90 L10 90 Z" fill="#fff" opacity="0.9"/></svg>
      <span class="adot" style="left:12%;top:20%"></span><span class="adot" style="right:14%;bottom:22%;width:14px;height:14px"></span><span class="adot" style="left:44%;top:14%;width:8px;height:8px"></span>
      <div class="a12"><b>1</b><i>年</i></div><div class="a12s">全家桶会员,创意无限</div>
    </template>
    <template v-else>
      <img v-if="fallbackIcon" :src="fallbackIcon" :alt="product.name" class="nj-generic-icon" />
      <span class="gcirc" style="left:10%;top:20%"></span><span class="gcirc" style="right:12%;bottom:24%"></span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ICON_MUSE, pickBrandIcon } from "@/lib/category-icons";

type Product = { name: string; slug: string; subtitle: string | null; coverImage: string | null; categoryName: string | null; price: string };

const props = defineProps<{ product: Product }>();

const variant = computed(() => {
  const hay = `${props.product.name} ${props.product.categoryName ?? ""}`;
  if (/chatgpt|\bgpt\b/i.test(hay)) return "chatgpt";
  if (/gemini/i.test(hay)) return "gemini";
  if (/\bx\b/i.test(hay) || /推特/i.test(hay)) return "x";
  if (/\bmuse\b/i.test(hay)) return "muse";
  if (/adobe/i.test(hay)) return "adobe";
  if (/duolingo|多邻国/i.test(hay)) return "duolingo";
  return "generic";
});

const fallbackIcon = computed(() => pickBrandIcon(props.product.categoryName) ?? pickBrandIcon(props.product.name));
</script>

<style scoped>
.nj-banner {
  position: relative;
  height: 190px;
  border-radius: 14px;
  overflow: hidden;
  margin: 18px 26px 0;
}
.nj-banner-img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* variant backgrounds */
.nj-banner:has(.ccard) { background: linear-gradient(120deg, #dff7f0 0%, #f0fbf7 60%, #e9f6f1 100%); }
.nj-banner:has(.gstar) { background: linear-gradient(135deg, #c4b0f8 0%, #9d7bee 60%, #7e57e8 100%); }
.nj-banner:has(.xcard) { background: linear-gradient(120deg, #f8fafc 0%, #edf1f7 100%); }
.nj-banner:has(.musebig) { background: linear-gradient(135deg, #fcebd8 0%, #f8d9b4 65%, #f3c795 100%); }
.nj-banner:has(.adobe-a) { background: linear-gradient(135deg, #fa0f00 0%, #d60b00 60%, #a80800 100%); }
.nj-banner:has(.duobig) { background: linear-gradient(120deg, #e6f9f4 0%, #f2fbf8 100%); }
.nj-banner:has(.nj-generic-icon) { background: linear-gradient(120deg, #e6f9f4 0%, #f2fbf8 100%); display: flex; align-items: center; justify-content: center; }
.nj-generic-icon { width: 96px; height: 96px; border-radius: 22px; box-shadow: 0 14px 30px rgba(20, 184, 166, 0.22); }
/* chatgpt cards */
.ccard { position: absolute; width: 212px; height: 130px; border-radius: 16px; padding: 15px 20px; box-shadow: 0 24px 44px rgba(15, 118, 110, 0.2); }
.cc-back { background: linear-gradient(135deg, #d9d2fe, #bba6fd); transform: rotate(9deg); right: 15%; top: 13%; }
.cc-front { background: linear-gradient(135deg, #9bf0d2, #57d9b4); transform: rotate(-8deg); left: 13%; top: 19%; }
.cc-brand { font-size: 11px; font-weight: 600; letter-spacing: 1.5px; color: #4b5563; display: block; }
.cc-name { font-size: 32px; font-weight: 800; color: #0b6e63; margin-top: 3px; letter-spacing: 0.5px; display: block; }
.cc-back .cc-name { color: #5b21b6; }
.cc-num, .cc-price { position: absolute; right: 18px; bottom: 13px; font-size: 16px; font-weight: 800; color: #0b6e63; }
.cc-back .cc-num { color: #5b21b6; }
.cdot { position: absolute; width: 12px; height: 12px; border-radius: 50%; background: #5fddb8; opacity: 0.45; }
/* gemini */
.gorb { position: absolute; left: 27%; top: 50%; width: 230px; transform: translate(-50%, -50%) rotate(-12deg); }
.gstar { position: absolute; left: 27%; top: 50%; width: 118px; height: 118px; transform: translate(-50%, -50%); filter: drop-shadow(0 0 26px rgba(255, 255, 255, 0.6)); }
.gspk { position: absolute; width: 12px; height: 12px; background: #fff; border-radius: 50%; opacity: 0.85; box-shadow: 0 0 12px #fff; }
.g18 { position: absolute; right: 26px; bottom: 36px; color: #fff; font-weight: 800; line-height: 1; }
.g18 b { font-size: 46px; } .g18 i { font-style: normal; font-size: 20px; margin-left: 3px; }
.g18s { position: absolute; right: 26px; bottom: 15px; color: rgba(255, 255, 255, 0.78); font-size: 12px; }
/* x */
.xcard { position: absolute; top: 50%; width: 252px; height: 142px; border-radius: 18px; }
.xcard-b { left: 56%; background: linear-gradient(135deg, #1a2233, #2c3852); transform: translate(-50%, -50%) rotate(7deg); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18); }
.xcard-f { left: 40%; background: linear-gradient(135deg, #0b0f19, #222b40); transform: translate(-50%, -50%) rotate(-8deg); box-shadow: 0 28px 54px rgba(0, 0, 0, 0.32); display: flex; align-items: center; gap: 12px; padding: 0 28px; }
.xx { color: #fff; font-size: 36px; font-weight: 800; } .xt { color: #fff; font-size: 20px; font-weight: 700; }
.xm { position: absolute; left: 28px; bottom: 15px; color: #8b93a7; font-size: 10px; letter-spacing: 3px; }
/* muse */
.musebig { position: absolute; left: 50%; top: 50%; width: 148px; height: 148px; transform: translate(-50%, -50%); border-radius: 50%; box-shadow: 0 18px 42px rgba(194, 120, 40, 0.28); }
.pill10 { position: absolute; background: #fff7ed; color: #c2410c; font-size: 11px; font-weight: 700; padding: 4px 12px; border-radius: 999px; box-shadow: 0 3px 10px rgba(194, 65, 12, 0.2); white-space: nowrap; }
.mdot { position: absolute; width: 11px; height: 11px; border-radius: 50%; background: #f59e0b; opacity: 0.5; }
.gcirc { position: absolute; width: 16px; height: 16px; border-radius: 50%; background: #5fddb8; opacity: 0.4; }
/* adobe */
.adobe-a { position: absolute; left: 27%; top: 50%; width: 110px; height: 110px; transform: translate(-50%, -50%); filter: drop-shadow(0 0 26px rgba(255, 255, 255, 0.4)); }
.adot { position: absolute; width: 12px; height: 12px; background: #fff; border-radius: 50%; opacity: 0.6; box-shadow: 0 0 12px #fff; }
.a12 { position: absolute; right: 26px; bottom: 36px; color: #fff; font-weight: 800; line-height: 1; }
.a12 b { font-size: 46px; } .a12 i { font-style: normal; font-size: 20px; margin-left: 3px; }
.a12s { position: absolute; right: 26px; bottom: 15px; color: rgba(255, 255, 255, 0.78); font-size: 12px; }
/* duolingo */
.duobig { position: absolute; left: 38%; top: 50%; width: 110px; height: 110px; transform: translate(-50%, -50%); border-radius: 26px; box-shadow: 0 14px 30px rgba(20, 184, 166, 0.25); }
.d1 { position: absolute; right: 26px; bottom: 36px; color: #0f766e; font-weight: 800; line-height: 1; }
.d1 b { font-size: 46px; } .d1 i { font-style: normal; font-size: 20px; margin-left: 3px; }
.d1s { position: absolute; right: 26px; bottom: 15px; color: rgba(15, 118, 110, 0.7); font-size: 12px; }
</style>
