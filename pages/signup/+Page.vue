<template>
  <main class="relative flex min-h-screen items-center justify-center bg-muted/30 p-6">
    <div class="absolute left-4 top-4"><StorefrontBrand /></div>
    <div class="absolute right-4 top-4"><StorefrontPreferences /></div>
    <Alert v-if="!rootInitialized" class="w-full max-w-md">
      <AlertTitle>{{ messages.auth.signup.unavailable }}</AlertTitle>
      <AlertDescription>{{ messages.auth.signup.notInitialized }}</AlertDescription>
    </Alert>

    <Alert v-else-if="!registrationEnabled" class="w-full max-w-md">
      <AlertTitle>{{ messages.auth.signup.unavailable }}</AlertTitle>
      <AlertDescription>{{ messages.auth.signup.disabled }}</AlertDescription>
    </Alert>

    <Card v-else class="w-full max-w-md">
      <CardHeader>
        <CardTitle>{{ messages.auth.signup.title }}</CardTitle>
        <CardDescription>{{ messages.auth.signup.description }}</CardDescription>
      </CardHeader>
      <form novalidate @submit.prevent="submit">
        <CardContent>
          <FieldGroup>
            <VeeField v-slot="{ componentField, errors }" name="name" :validate-on-input="true">
              <Field :data-invalid="errors.length > 0">
                <FieldLabel for="signup-name">{{ messages.auth.signup.name }}</FieldLabel>
                <Input id="signup-name" v-bind="componentField" autocomplete="name" :aria-invalid="errors.length > 0" />
                <FieldError v-if="errors.length" :errors="errors" />
              </Field>
            </VeeField>
            <VeeField v-slot="{ componentField, errors }" name="email" :validate-on-input="true">
              <Field :data-invalid="errors.length > 0">
                <FieldLabel for="signup-email">{{ messages.auth.signup.email }}</FieldLabel>
                <Input id="signup-email" v-bind="componentField" type="email" autocomplete="email" :aria-invalid="errors.length > 0" />
                <FieldError v-if="errors.length" :errors="errors" />
              </Field>
            </VeeField>
            <VeeField v-slot="{ componentField, errors }" name="password" :validate-on-input="true">
              <Field :data-invalid="errors.length > 0">
                <FieldLabel for="signup-password">{{ messages.auth.signup.password }}</FieldLabel>
                <Input id="signup-password" v-bind="componentField" type="password" autocomplete="new-password" :aria-invalid="errors.length > 0" />
                <FieldError v-if="errors.length" :errors="errors" />
              </Field>
            </VeeField>
            <VeeField v-slot="{ componentField, errors }" name="confirmPassword" :validate-on-input="true">
              <Field :data-invalid="errors.length > 0">
                <FieldLabel for="signup-confirm-password">{{ messages.auth.signup.confirmPassword }}</FieldLabel>
                <Input id="signup-confirm-password" v-bind="componentField" type="password" autocomplete="new-password" :aria-invalid="errors.length > 0" />
                <FieldError v-if="errors.length" :errors="errors" />
              </Field>
            </VeeField>
          </FieldGroup>
          <div v-if="turnstileSiteKey" ref="turnstileElement" class="mt-5 min-h-16" />
        </CardContent>
        <CardFooter class="mt-6 flex-col gap-3">
          <Button class="w-full" type="submit" :disabled="isSubmitting">{{ isSubmitting ? messages.auth.signup.signingUp : messages.auth.signup.signUp }}</Button>
          <Button as="a" href="/login" class="w-full" variant="ghost">{{ messages.auth.signup.haveAccount }}</Button>
        </CardFooter>
      </form>
    </Card>
  </main>
</template>

<script lang="ts" setup>
import { toTypedSchema } from "@vee-validate/zod";
import { Field as VeeField, useForm } from "vee-validate";
import { nextTick, onMounted, ref } from "vue";

import { usePageContext } from "vike-vue/usePageContext";
import { toast } from "vue-sonner";
import { z } from "zod";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import StorefrontPreferences from "@/components/storefront/StorefrontPreferences.vue";
import StorefrontBrand from "@/components/storefront/StorefrontBrand.vue";
import { authClient } from "@/lib/auth-client";
import { useStorefrontPreferences } from "@/lib/storefront-preferences";

const pageContext = usePageContext() as ReturnType<typeof usePageContext> & {
  rootInitialized?: boolean;
  registrationEnabled?: boolean;
};
const { messages } = useStorefrontPreferences();
const rootInitialized = Boolean(pageContext.rootInitialized);
const registrationEnabled = pageContext.registrationEnabled === true;
const schema = z.object({

  name: z.string().trim().min(1, messages.value.auth.signup.nameRequired).max(100, messages.value.auth.signup.nameTooLong),
  email: z.string().trim().email(messages.value.auth.signup.emailInvalid).max(320, messages.value.auth.signup.emailTooLong),
  password: z.string().min(8, messages.value.auth.signup.passwordTooShort).max(128, messages.value.auth.signup.passwordTooLong),
  confirmPassword: z.string(),
}).refine((values) => values.password === values.confirmPassword, { path: ["confirmPassword"], message: messages.value.auth.signup.passwordsMismatch });

const { handleSubmit, isSubmitting } = useForm({
  validationSchema: toTypedSchema(schema),
  initialValues: { name: "", email: "", password: "", confirmPassword: "" },
});

const turnstileElement = ref<HTMLElement | null>(null);
const turnstileSiteKey = ref<string | null>(null);
const turnstileToken = ref("");
const turnstileWidgetId = ref<string | null>(null);

declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void }) => string; reset: (widgetId?: string) => void; }; } }

async function loadTurnstile() {
  const config = await fetch("/api/security/turnstile").then((response) => response.json() as Promise<{ enabled: boolean; siteKey: string | null }>);
  if (!config.enabled || !config.siteKey) return;
  turnstileSiteKey.value = config.siteKey;
  await nextTick();
  await new Promise<void>((resolve, reject) => {
    if (window.turnstile) { resolve(); return; }
    const script = window.document.createElement("script"); script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; script.async = true; script.onload = () => resolve(); script.onerror = () => reject(new Error("TURNSTILE_LOAD_FAILED")); window.document.head.appendChild(script);
  });
  if (turnstileElement.value) turnstileWidgetId.value = window.turnstile?.render(turnstileElement.value, { sitekey: config.siteKey, callback: (token) => { turnstileToken.value = token; }, "expired-callback": () => { turnstileToken.value = ""; } }) ?? null;
}

function resetTurnstile() {
  turnstileToken.value = "";
  if (turnstileWidgetId.value) window.turnstile?.reset(turnstileWidgetId.value);
}

onMounted(() => { loadTurnstile(); });

const submit = handleSubmit(async ({ confirmPassword: _confirmPassword, ...input }) => {
  if (!rootInitialized || !registrationEnabled) return;
  try {
    if (turnstileSiteKey.value && !turnstileToken.value) {
      toast.error(messages.value.auth.signup.captchaRequired || "请先完成人机验证");
      return;
    }
    const result = await authClient.signUp.email({ ...input, ...(turnstileToken.value ? { fetchOptions: { headers: { "x-captcha-response": turnstileToken.value } } } : {}) });
    if (result.error) {
      resetTurnstile();
      toast.error(messages.value.auth.signup.failed);
      return;
    }
    toast.success(messages.value.auth.signup.submitted);
    // 注册成功后自动登录,直接跳转首页
    window.location.href = "/";
  } catch {
    resetTurnstile();
    toast.error(messages.value.auth.signup.requestFailed);
  }
});
</script>
