<template>
  <header class="nj-header">
    <div class="nj-header-inner">
      <a href="/" class="nj-logo" aria-label="返回首页">
        <span class="nj-logo-icon">
          <img :src="logoUrl" alt="logo" />
        </span>
        <b>{{ siteName }}</b>
      </a>

      <nav class="nj-nav" :aria-label="messages.nav.main">
        <a href="/" class="nj-pill nj-pill-active"><ShoppingBagIcon /><span>{{ messages.nav.shop }}</span></a>
        <a :href="user ? '/account/order' : '/order'" class="nj-pill"><ClipboardListIcon /><span>{{ messages.nav.orderLookup }}</span></a>
        <a :href="supportHref" class="nj-pill" :target="supportExternal ? '_blank' : undefined" rel="noopener noreferrer"><HeadphonesIcon /><span>{{ messages.nav.support }}</span></a>
        <a :href="user ? '/account' : '/login'" class="nj-pill"><CircleUserRoundIcon /><span>{{ messages.nav.personalCenter }}</span></a>
      </nav>

      <div class="nj-actions">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <button type="button" class="nj-icon-btn" aria-label="切换语言" title="语言">
              <LanguagesIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" :side-offset="8" class="w-36">
            <DropdownMenuLabel>{{ messages.preferences.language }}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem @select="setLocale('zh-CN')">{{ zhCN.languageName }}</DropdownMenuItem>
            <DropdownMenuItem @select="setLocale('zh-TW')">{{ zhTW.languageName }}</DropdownMenuItem>
            <DropdownMenuItem @select="setLocale('en-US')">{{ enUS.languageName }}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" class="nj-icon-btn" :aria-label="theme === 'light' ? messages.preferences.dark : messages.preferences.light" :title="theme === 'light' ? messages.preferences.dark : messages.preferences.light" @click="setTheme(theme === 'light' ? 'dark' : 'light')">
          <SunIcon v-if="theme === 'light'" />
          <MoonIcon v-else />
        </button>
        <a v-if="!user" href="/login" class="nj-icon-btn" aria-label="登录">
          <CircleUserRoundIcon />
        </a>
        <a v-else href="/account" class="nj-avatar" :aria-label="currentUserName" :title="currentUserName">
          {{ userInitials }}
        </a>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
import { computed } from "vue";
import {
  BookOpenIcon,
  CircleUserRoundIcon,
  ClipboardListIcon,
  FingerprintIcon,
  HeadphonesIcon,
  InfoIcon,
  LanguagesIcon,
  MegaphoneIcon,
  MoonIcon,
  ShoppingBagIcon,
  SunIcon,
} from "@lucide/vue";
import logoUrl from "@/assets/xyshop-logo.svg?url";
import { usePageContext } from "vike-vue/usePageContext";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import enUS from "@/lib/i18n/en-US";
import zhCN from "@/lib/i18n/zh-CN";
import zhTW from "@/lib/i18n/zh-TW";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";

type Site = { name?: string | null; supportContact?: string | null };
type PublicUser = { id: string; name?: string | null; email?: string | null };
type PageContext = ReturnType<typeof usePageContext> & { site?: Site | null; user?: PublicUser | null };

const pageContext = usePageContext() as PageContext;
const user = computed(() => pageContext.user ?? null);
const siteName = computed(() => pageContext.site?.name?.trim() || "星云Shop");
const currentUserName = computed(() => user.value?.name?.trim() || user.value?.email || "");
const userInitials = computed(() => currentUserName.value.slice(0, 1).toUpperCase() || "我");
const { messages, setLocale, setTheme, theme } = useStorefrontPreferences();

const supportHref = computed(() => {
  const first = (pageContext.site?.supportContact ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (!first) return "#";
  const address = first.includes("|") ? first.slice(first.indexOf("|") + 1).trim() : first;
  return address.includes(":") ? address : `mailto:${address}`;
});
const supportExternal = computed(() => supportHref.value.startsWith("http"));
</script>

<style scoped>
.nj-header {
  position: sticky;
  top: 0;
  z-index: 50;
  background: var(--nj-nav-bg);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--nj-border);
}
.nj-header-inner {
  max-width: 1380px;
  margin: 0 auto;
  padding: 12px max(24px, 4vw);
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr) auto;
  align-items: center;
  gap: 18px;
}
.nj-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  flex-shrink: 0;
  width: max-content;
}
.nj-logo-icon {
  width: 38px;
  height: 38px;
  border-radius: 12px;
  overflow: hidden;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 9px 22px rgba(18, 168, 154, 0.2);
  flex-shrink: 0;
}
.nj-logo-icon img { width: 100%; height: 100%; object-fit: contain; }
.nj-logo b { font-size: 16px; font-weight: 700; color: var(--nj-text); letter-spacing: 0.04em; white-space: nowrap; }
.nj-nav {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}
.nj-nav::-webkit-scrollbar { display: none; }
.nj-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  border-radius: 9px;
  font-size: 12px;
  font-weight: 500;
  color: var(--nj-muted);
  text-decoration: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
  border: 0;
  background: transparent;
}
.nj-pill svg { width: 16px; height: 16px; flex-shrink: 0; }
.nj-pill:hover, .nj-pill-active { background: var(--nj-accent-soft); color: var(--nj-accent-strong); }
.nj-pill-active { font-weight: 600; }
.nj-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-shrink: 0; }
.nj-icon-btn {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  border: 1px solid var(--nj-border);
  background: var(--nj-card);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--nj-muted);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  text-decoration: none;
  padding: 0;
}
.nj-icon-btn svg { width: 18px; height: 18px; }
.nj-icon-btn:hover { border-color: var(--nj-accent-line); color: var(--nj-accent-strong); }
.nj-avatar {
  width: 40px;
  height: 40px;
  border-radius: 11px;
  background: linear-gradient(135deg, var(--nj-accent), #67dfd4);
  color: var(--nj-on-accent);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  font-weight: 700;
  text-decoration: none;
}
@media (max-width: 1120px) {
  .nj-header-inner { grid-template-columns: 190px minmax(0, 1fr) auto; padding-inline: 3vw; }
  .nj-pill { padding-inline: 7px; font-size: 10px; }
}
@media (max-width: 1024px) {
  .nj-nav .nj-pill span { display: none; }
  .nj-pill { padding: 9px 11px; }
}
@media (max-width: 640px) {
  .nj-nav { display: none; }
  .nj-header-inner { grid-template-columns: minmax(0, 1fr) auto; padding: 0 13px; height: 62px; }
}
</style>
