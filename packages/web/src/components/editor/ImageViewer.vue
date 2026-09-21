<template>
  <div class="image-viewer" @wheel="handleWheel" @mousedown="handleMouseDown" @mousemove="handleMouseMove" @mouseup="handleMouseUp" @mouseleave="handleMouseUp">
    <div class="image-toolbar">
      <button @click="zoomIn" :title="$t('viewer.zoomIn')">+</button>
      <span class="zoom-level">{{ Math.round(scale * 100) }}%</span>
      <button @click="zoomOut" :title="$t('viewer.zoomOut')">-</button>
      <button @click="resetZoom" :title="$t('viewer.reset')">1:1</button>
      <button @click="fitToScreen" :title="$t('viewer.fitToScreen')">Fit</button>
      <span class="image-info">{{ imageInfo }}</span>
    </div>
    <div class="image-canvas" ref="canvasRef">
      <img
        :src="src"
        :style="imageStyle"
        draggable="false"
        @load="onImageLoad"
        @error="onImageError"
      />
    </div>
    <div v-if="error" class="image-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  src: string;
  filename?: string;
}>();

const scale = ref(1);
const panX = ref(0);
const panY = ref(0);
const isPanning = ref(false);
const panStart = reactive({ x: 0, y: 0 });
const imageSize = reactive({ width: 0, height: 0 });
const naturalSize = reactive({ width: 0, height: 0 });
const canvasRef = ref<HTMLElement>();
const error = ref('');

const imageStyle = computed(() => ({
  transform: `translate(${panX.value}px, ${panY.value}px) scale(${scale.value})`,
  cursor: isPanning.value ? 'grabbing' : 'grab',
}));

const imageInfo = computed(() => {
  if (!naturalSize.width) return '';
  return `${naturalSize.width} x ${naturalSize.height} px`;
});

function onImageLoad(e: Event) {
  const img = e.target as HTMLImageElement;
  naturalSize.width = img.naturalWidth;
  naturalSize.height = img.naturalHeight;
  imageSize.width = img.width;
  imageSize.height = img.height;
  fitToScreen();
}

function onImageError() {
  error.value = t('viewer.failedToLoadImage');
}

function zoomIn() {
  scale.value = Math.min(scale.value * 1.25, 20);
}

function zoomOut() {
  scale.value = Math.max(scale.value / 1.25, 0.05);
}

function resetZoom() {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function fitToScreen() {
  scale.value = 1;
  panX.value = 0;
  panY.value = 0;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? 0.9 : 1.1;
  scale.value = Math.max(0.05, Math.min(20, scale.value * delta));
}

function handleMouseDown(e: MouseEvent) {
  isPanning.value = true;
  panStart.x = e.clientX - panX.value;
  panStart.y = e.clientY - panY.value;
}

function handleMouseMove(e: MouseEvent) {
  if (!isPanning.value) return;
  panX.value = e.clientX - panStart.x;
  panY.value = e.clientY - panStart.y;
}

function handleMouseUp() {
  isPanning.value = false;
}
</script>

<style scoped>
.image-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-2);
}

.image-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.image-toolbar button {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
}

.image-toolbar button:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.zoom-level {
  font-size: var(--font-sm);
  color: var(--text-muted);
  min-width: 48px;
  text-align: center;
}

.image-info {
  font-size: var(--font-sm);
  color: var(--text-muted);
  margin-left: auto;
}

.image-canvas {
  flex: 1;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.image-canvas img {
  max-width: none;
  max-height: none;
  image-rendering: auto;
  user-select: none;
}

.image-error {
  padding: var(--space-4);
  text-align: center;
  color: var(--danger);
  font-size: var(--font-md);
}
</style>
