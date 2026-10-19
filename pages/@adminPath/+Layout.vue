<template>
  <slot v-if="isLoginPage" />
  <SidebarProvider v-else class="min-h-svh bg-muted/40">
    <AdminSidebar />
    <SidebarInset>
      <header class="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-4 md:rounded-t-xl">
        <SidebarTrigger class="-ml-1 cursor-pointer" />
        <Separator orientation="vertical" class="h-4" />
        <nav class="flex items-center gap-2 text-sm" aria-label="当前位置">
          <template v-for="(title, index) in routeMeta.titles" :key="`${index}-${title}`">
            <span v-if="index > 0" class="text-muted-foreground">/</span>
            <span :class="index === routeMeta.titles.length - 1 ? 'font-medium text-foreground' : 'text-muted-foreground'">{{ title }}</span>
          </template>
        </nav>
        <div class="ml-auto flex items-center gap-1">
          <Button type="button" variant="ghost" size="icon" :aria-label="isDark ? '切换浅色' : '切换深色'" @click="toggleTheme">
            <SunIcon v-if="isDark" class="size-4" />
            <MoonIcon v-else class="size-4" />
          </Button>
        </div>
      </header>
      <main class="@container/main flex flex-1 flex-col p-4 lg:p-6">
        <slot />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>

<script lang="ts" setup>
import AdminSidebar from "@/components/AdminSidebar.vue";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { getAdminBreadcrumb } from "@/lib/admin-navigation";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { MoonIcon, SunIcon } from "@lucide/vue";
import { computed, onMounted, provide, ref } from "vue";
import { usePageContext } from "vike-vue/usePageContext";
import { SITE_TIMEZONE_KEY } from "@/lib/site-timezone";
import { onGetSiteSettings } from "@/server/site/admin.telefunc";
import { runTelefunc } from "@/lib/telefunc-client";

const pageContext = usePageContext();
const basePath = computed(() => `/${pageContext.routeParams.adminPath}`);
const isLoginPage = computed(() => pageContext.urlPathname.replace(/\/$/, "") === basePath.value);
const routeMeta = computed(() => getAdminBreadcrumb(pageContext.urlPathname, basePath.value));
const timezone = ref("Asia/Shanghai");
provide(SITE_TIMEZONE_KEY, timezone);
const isDark = ref(true);
function applyAdminTheme() {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("dark", isDark.value);
}
function toggleTheme() {
  isDark.value = !isDark.value;
  if (typeof window !== "undefined") window.localStorage.setItem("admin-theme", isDark.value ? "dark" : "light");
  applyAdminTheme();
}
onMounted(() => {
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem("admin-theme");
    if (saved === "light" || saved === "dark") isDark.value = saved === "dark";
    else if (typeof window.matchMedia === "function") isDark.value = !window.matchMedia("(prefers-color-scheme: light)").matches;
  }
  applyAdminTheme();
  if (isLoginPage.value) return;
  void runTelefunc(() => onGetSiteSettings(), { notifyError: false }).then((settings) => { timezone.value = settings.timezone; }).catch(() => undefined);
});

</script>
