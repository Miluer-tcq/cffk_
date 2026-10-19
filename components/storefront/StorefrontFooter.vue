<template>
  <footer id="about" class="nj-footer">
    <div class="nj-footer-grid">
      <div class="nj-fbrand">
        <div class="nj-flogo">
          <span class="nj-logo-icon">
            <img :src="logoUrl" alt="logo" />
          </span>
          <b>{{ siteName }}</b>
        </div>
        <p>{{ tagline }}</p>
      </div>
      <div class="nj-fcol">
        <h4>快速链接</h4>
        <a href="/">购物</a>
        <a :href="user ? '/account/order' : '/order'">查订单</a>
        <a :href="user ? '/account' : '/login'">个人中心</a>
      </div>
      <div class="nj-fcol">
        <h4>帮助中心</h4>
        <a href="/#notice">网站公告</a>
        <a :href="supportHref" :target="supportExternal ? '_blank' : undefined" rel="noopener noreferrer">联系客服</a>
      </div>
      <div class="nj-fcol">
        <h4>联系我们</h4>
        <p class="nj-fcontact">在线客服实时响应<br />工作时间 9:00-23:00</p>
        <a :href="supportHref" :target="supportExternal ? '_blank' : undefined" rel="noopener noreferrer" class="nj-service-btn">
          <HeadphonesIcon /><span>在线客服</span>
        </a>
      </div>
    </div>
    <div class="nj-fbot">© {{ year }} {{ siteName }}</div>
  </footer>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { HeadphonesIcon } from "@lucide/vue";
import { usePageContext } from "vike-vue/usePageContext";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";
import logoUrl from "@/assets/xyshop-logo.svg?url";

type Site = { name?: string | null; subtitle?: string | null; supportContact?: string | null };
type PublicUser = { id: string };
type PageContext = ReturnType<typeof usePageContext> & { site?: Site | null; user?: PublicUser | null };

const pageContext = usePageContext() as PageContext;
const user = computed(() => pageContext.user ?? null);
const siteName = computed(() => pageContext.site?.name?.trim() || "星云Shop");
const { messages } = useStorefrontPreferences();
const tagline = computed(() => pageContext.site?.subtitle?.trim() || messages.value.storefront.fallbackSubtitle);
const year = new Date().getFullYear();

const supportHref = computed(() => {
  const first = (pageContext.site?.supportContact ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "#";
  const address = first.includes("|") ? first.slice(first.indexOf("|") + 1).trim() : first;
  return address.includes(":") ? address : `mailto:${address}`;
});
const supportExternal = computed(() => supportHref.value.startsWith("http"));
</script>

<style scoped>
.nj-footer { background: var(--nj-card); border-top: 1px solid var(--nj-border); margin-top: 56px; min-height: 106px; color: var(--nj-muted); }
.nj-footer-grid {
  width: min(1380px, 92vw); margin: 0 auto; padding: 24px 0;
  display: flex; align-items: center; justify-content: space-between; gap: 25px; min-height: 106px;
}
.nj-flogo { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.nj-logo-icon {
  width: 32px; height: 32px; border-radius: 10px; overflow: hidden;
  background: #fff; display: flex; align-items: center; justify-content: center;
}
.nj-logo-icon img { width: 100%; height: 100%; object-fit: contain; }
.nj-flogo b { font-size: 12px; font-weight: 700; color: var(--nj-text); }
.nj-fbrand p { font-size: 9px; color: var(--nj-muted); line-height: 1.7; margin: 0; }
.nj-fcol h4 { font-size: 14px; font-weight: 700; color: var(--nj-text); margin: 0 0 14px; }
.nj-fcol a { display: block; font-size: 11px; color: var(--nj-muted); text-decoration: none; margin-bottom: 10px; white-space: nowrap; }
.nj-fcol a:hover { color: var(--nj-accent-strong); }
.nj-fcontact { font-size: 13px; color: var(--nj-muted); line-height: 1.8; margin: 0 0 14px; }
.nj-service-btn {
  display: inline-flex !important; align-items: center; gap: 8px;
  background: linear-gradient(135deg, var(--nj-accent), #67dfd4); color: var(--nj-on-accent) !important;
  padding: 10px 20px; border-radius: 999px; font-size: 13px; font-weight: 700;
  box-shadow: 0 10px 25px rgba(18, 168, 154, 0.18); margin-bottom: 0 !important;
}
.nj-service-btn svg { width: 15px; height: 15px; }
.nj-service-btn:hover { color: var(--nj-on-accent) !important; }
.nj-fbot {
  width: min(1380px, 92vw); margin: 0 auto; padding: 18px 0;
  border-top: 1px solid var(--nj-border); font-size: 12px; color: var(--nj-muted); text-align: center;
}
@media (max-width: 768px) {
  .nj-footer { display: none; }
}
</style>
