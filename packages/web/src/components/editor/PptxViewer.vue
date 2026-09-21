<template>
  <div class="pptx-viewer" ref="viewerRef">
    <div v-if="isLegacyPpt" class="pptx-unsupported">
      <p class="pptx-unsupported-title">{{ $t('viewer.unsupportedFormat') }}</p>
      <p class="pptx-unsupported-hint">
        {{ fileName }}{{ $t('viewer.legacyPpt') }}
        {{ $t('viewer.onlyPptx') }}
      </p>
    </div>
    <div v-else-if="!content" class="pptx-empty">
      <p>{{ $t('viewer.unableToPreview') }}</p>
    </div>
    <template v-else>
      <div class="pptx-toolbar">
        <div class="toolbar-group">
          <button
            class="toolbar-btn"
            :title="$t('viewer.toggleThumbnails')"
            @click="showSidebar = !showSidebar"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="4" height="11" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
              <rect x="7.5" y="2.5" width="7" height="11" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
            </svg>
          </button>
        </div>
        <div class="toolbar-group">
          <button class="toolbar-btn" :title="$t('viewer.prevSlide')" :disabled="currentSlide <= 1" @click="goToSlide(currentSlide - 1)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 4l-4 4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <span class="page-indicator">
            <input
              type="number"
              class="page-input"
              :value="currentSlide"
              :min="1"
              :max="totalSlides || 1"
              @change="onSlideInput"
            />
            <span class="page-total">/ {{ totalSlides || '...' }}</span>
          </span>
          <button class="toolbar-btn" :title="$t('viewer.nextSlide')" :disabled="currentSlide >= totalSlides" @click="goToSlide(currentSlide + 1)">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
        <div class="toolbar-group">
          <button class="toolbar-btn" :title="$t('viewer.zoomOut')" :disabled="zoom <= minZoom" @click="zoomOut">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
          <button class="toolbar-btn zoom-display" :title="$t('viewer.reset')" @click="resetZoom">{{ zoom }}%</button>
          <button class="toolbar-btn" :title="$t('viewer.zoomIn')" :disabled="zoom >= maxZoom" @click="zoomIn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div class="toolbar-group">
          <button class="toolbar-btn" :title="$t('viewer.fitToWidth')" @click="zoom = 100">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 4v8M14 4v8M2 6h12M2 10h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="pptx-body">
        <div v-show="showSidebar" class="pptx-sidebar" ref="sidebarRef">
          <div
            v-for="idx in totalSlides"
            :key="idx"
            class="thumbnail-item"
            :class="{ active: currentSlide === idx }"
            @click="goToSlide(idx)"
          >
              <span class="thumbnail-label">{{ $t('viewer.slide') }}{{ idx }}</span>
            <div
              class="thumbnail-preview"
              :ref="(el) => { if (el) thumbRefs[idx - 1] = el as HTMLElement }"
            />
          </div>
        </div>
        <div ref="scrollContainer" class="pptx-scroll-container" @scroll="onScroll">
          <vue-office-pptx
            :src="buffer"
            :options="pptOptions"
            class="pptx-content"
            @rendered="onRendered"
            @error="onPptxError"
          />
        </div>
      </div>
    </template>
    <div v-if="error" class="pptx-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import VueOfficePptx from '@vue-office/pptx';

const { t } = useI18n();

const props = defineProps<{
  content: string;
  fileName: string;
}>();

const viewerRef = ref<HTMLElement | null>(null);
const scrollContainer = ref<HTMLElement | null>(null);
const sidebarRef = ref<HTMLElement | null>(null);
const buffer = ref<ArrayBuffer | null>(null);
const error = ref('');
const zoom = ref(100);
const minZoom = 25;
const maxZoom = 300;
const zoomStep = 10;
const isLegacyPpt = computed(() => props.fileName.toLowerCase().endsWith('.ppt'));
const showSidebar = ref(true);

const currentSlide = ref(1);
const totalSlides = ref(0);
const thumbRefs = ref<HTMLElement[]>([]);
const presentationData = ref<any>(null);
let observer: IntersectionObserver | null = null;

const containerWidth = computed(() => {
  if (!scrollContainer.value) return 960;
  return scrollContainer.value.clientWidth;
});

const pptOptions = computed(() => ({
  width: containerWidth.value > 0 ? Math.round(containerWidth.value * (zoom.value / 100)) : undefined,
}));

function zoomIn() { zoom.value = Math.min(zoom.value + zoomStep, maxZoom); }
function zoomOut() { zoom.value = Math.max(zoom.value - zoomStep, minZoom); }
function resetZoom() { zoom.value = 100; }

function onRendered(presentation: any) {
  presentationData.value = presentation;
  if (presentation?.slides) {
    totalSlides.value = presentation.slides.length;
  } else {
    detectSlidesFromDom();
  }
  nextTick(() => {
    setupSlideObserver();
    buildSlideThumbnails();
  });
}

function onPptxError(e: any) {
  error.value = e?.message || t('viewer.failedToRenderPptx');
}

function detectSlidesFromDom() {
  const slides = findSlideElements();
  if (slides.length > 0) {
    totalSlides.value = slides.length;
  }
}

function findSlideElements(): HTMLElement[] {
  if (!scrollContainer.value) return [];
  return Array.from(scrollContainer.value.querySelectorAll('.pptx-preview-slide-wrapper')) as HTMLElement[];
}

function setupSlideObserver() {
  if (observer) observer.disconnect();
  const slides = findSlideElements();
  if (slides.length === 0) return;

  const visibleMap = new Map<Element, number>();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        visibleMap.set(entry.target, entry.intersectionRatio);
      }
      let best: Element | null = null;
      let bestRatio = 0;
      for (const [el, ratio] of visibleMap) {
        if (ratio > bestRatio) { bestRatio = ratio; best = el; }
      }
      if (best) {
        const idx = slides.indexOf(best as HTMLElement);
        if (idx >= 0) currentSlide.value = idx + 1;
      }
    },
    { root: scrollContainer.value, threshold: [0, 0.25, 0.5, 0.75, 1] },
  );
  for (const slide of slides) observer.observe(slide);
}

function buildSlideThumbnails() {
  const slides = findSlideElements();
  if (slides.length === 0) return;

  for (let i = 0; i < slides.length; i++) {
    const el = thumbRefs.value[i];
    if (!el) continue;
    el.innerHTML = '';

    const clone = slides[i].cloneNode(true) as HTMLElement;
    const thumbWidth = 126;
    const naturalWidth = slides[i].offsetWidth || 960;
    const naturalHeight = slides[i].offsetHeight || 540;
    const scale = Math.min(thumbWidth / naturalWidth, 1);

    const inner = document.createElement('div');
    inner.style.transform = `scale(${scale})`;
    inner.style.transformOrigin = '0 0';
    inner.style.width = `${100 / scale}%`;
    clone.style.margin = '0';
    inner.appendChild(clone);

    el.style.height = `${Math.round(naturalHeight * scale)}px`;
    el.appendChild(inner);
  }
}

function goToSlide(slide: number) {
  const slides = findSlideElements();
  const idx = Math.max(0, Math.min(slide - 1, slides.length - 1));
  if (slides[idx]) {
    slides[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function onSlideInput(e: Event) {
  const input = e.target as HTMLInputElement;
  const val = parseInt(input.value, 10);
  if (!isNaN(val)) goToSlide(val);
}

function onScroll() {
  if (!sidebarRef.value) return;
  const activeThumb = sidebarRef.value.querySelector('.thumbnail-item.active');
  if (activeThumb) {
    activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function update() {
  if (!props.content || isLegacyPpt.value) {
    buffer.value = null;
    return;
  }
  error.value = '';
  try {
    const binary = atob(props.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    buffer.value = bytes.buffer;
  } catch (e: any) {
    error.value = e.message || t('viewer.failedToDecode');
  }
}

onMounted(() => update());
watch(() => props.content, () => {
  zoom.value = 100;
  currentSlide.value = 1;
  totalSlides.value = 0;
  presentationData.value = null;
  if (observer) observer.disconnect();
  update();
});
onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});
</script>

<style scoped>
.pptx-viewer {
  height: 100%;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
}

.pptx-toolbar {
  display: flex;
  align-items: center;
  height: 36px;
  padding: 0 var(--space-2);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  user-select: none;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}

.toolbar-group:first-child {
  margin-right: auto;
}

.toolbar-group:last-child {
  margin-left: auto;
}

.toolbar-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 var(--space-1);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toolbar-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.toolbar-btn:active:not(:disabled) {
  background: var(--surface-selected);
}

.toolbar-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.toolbar-btn.zoom-display {
  min-width: 48px;
  font-variant-numeric: tabular-nums;
}

.page-indicator {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-secondary);
  font-size: var(--font-sm);
  font-variant-numeric: tabular-nums;
  margin: 0 var(--space-1);
}

.page-input {
  width: 36px;
  height: 24px;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  text-align: center;
  font-size: var(--font-sm);
  font-variant-numeric: tabular-nums;
  outline: none;
  -moz-appearance: textfield;
}

.page-input::-webkit-outer-spin-button,
.page-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.page-total {
  color: var(--text-muted);
  white-space: nowrap;
}

.pptx-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.pptx-sidebar {
  width: 150px;
  flex-shrink: 0;
  overflow-y: auto;
  background: var(--surface-1);
  border-right: 1px solid var(--border-subtle);
  padding: var(--space-2) 0;
}

.thumbnail-item {
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: background var(--transition-fast);
  border-left: 2px solid transparent;
}

.thumbnail-item:hover {
  background: var(--surface-hover);
}

.thumbnail-item.active {
  background: var(--surface-selected);
  border-left-color: var(--accent);
}

.thumbnail-label {
  display: block;
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-bottom: var(--space-1);
}

.thumbnail-preview {
  width: 126px;
  overflow: hidden;
  background: #ffffff;
  border-radius: var(--radius-sm);
}

.thumbnail-preview :deep(.pptx-preview-slide-wrapper) {
  margin: 0 !important;
}

.pptx-scroll-container {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--surface-2);
}

.pptx-content {
  width: 100%;
  background: var(--surface-2);
}

/* Override the library's fixed-height viewport so all slides stack vertically */
.pptx-content :deep(.pptx-preview-wrapper) {
  height: auto !important;
  overflow-y: visible !important;
}

.pptx-unsupported,
.pptx-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--surface-2);
  color: var(--text-muted);
}

.pptx-unsupported-title {
  font-size: var(--font-md);
  font-weight: var(--weight-semibold);
  margin-bottom: var(--space-2);
  color: var(--text-secondary);
}

.pptx-unsupported-hint {
  font-size: var(--font-sm);
  max-width: 400px;
  text-align: center;
  line-height: 1.5;
}

.pptx-error {
  padding: var(--space-4);
  color: var(--danger);
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-sm);
  flex-shrink: 0;
}
</style>
