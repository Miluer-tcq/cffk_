<template>
  <div class="relative mx-auto w-fit">
    <canvas ref="canvas" class="rounded-md bg-white p-2" aria-label="付款二维码" role="img" />
    <div v-if="icon" class="absolute left-1/2 top-1/2 flex h-10 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white" :style="{ backgroundColor: iconBg }">
      <span class="text-lg font-bold text-white">{{ icon }}</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import QRCode from "qrcode";
import { onMounted, ref, watch } from "vue";

const props = defineProps<{ value: string; icon?: string; iconBg?: string }>();
const canvas = ref<HTMLCanvasElement | null>(null);

async function renderCode() {
  if (!canvas.value || !props.value) return;
  // 有中央图标时用高容错率,避免遮挡导致扫不出
  await QRCode.toCanvas(canvas.value, props.value, { errorCorrectionLevel: props.icon ? "H" : "M", margin: 1, width: 224, color: { dark: "#111827", light: "#ffffff" } });
}

onMounted(() => { void renderCode(); });
watch(() => [props.value, props.icon], () => { void renderCode(); });
</script>
