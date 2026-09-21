<template>
  <div class="pdf-viewer">
    <div v-if="!content" class="pdf-empty">
      <p>{{ $t('viewer.unableToPreview') }}</p>
    </div>
    <embed
      v-else-if="blobUrl"
      :src="blobUrl"
      type="application/pdf"
      class="pdf-embed"
      width="100%"
      height="100%"
    />
    <div v-if="error" class="pdf-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const props = defineProps<{
  content: string;
  fileName: string;
}>();

const blobUrl = ref('');
const error = ref('');

let currentBlobUrl: string | null = null;

function base64ToBlob(b64: string): Blob {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: 'application/pdf' });
}

function revokeCurrentBlob() {
  if (!currentBlobUrl) return;
  URL.revokeObjectURL(currentBlobUrl);
  currentBlobUrl = null;
}

function loadPdf() {
  revokeCurrentBlob();

  if (!props.content) {
    blobUrl.value = '';
    return;
  }

  error.value = '';
  try {
    const blob = base64ToBlob(props.content);
    currentBlobUrl = URL.createObjectURL(blob);
    blobUrl.value = currentBlobUrl;
    console.log('[PdfViewer] PDF loaded, blob size:', blob.size, 'bytes');
  } catch (e: any) {
    blobUrl.value = '';
    error.value = e?.message || t('viewer.failedToLoadPdf');
    console.error('[PdfViewer] Failed to load PDF:', e);
  }
}

onMounted(() => loadPdf());
watch(() => props.content, () => loadPdf());
onBeforeUnmount(() => revokeCurrentBlob());
</script>

<style scoped>
.pdf-viewer {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-2);
  overflow: hidden;
}

.pdf-embed {
  border: none;
}

.pdf-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--surface-2);
  color: var(--text-muted);
}

.pdf-error {
  padding: var(--space-4);
  color: var(--danger);
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-sm);
  flex-shrink: 0;
}
</style>
