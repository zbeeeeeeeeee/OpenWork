<template>
  <div class="excel-viewer">
    <div v-if="isLegacyXls" class="excel-unsupported">
      <p class="excel-unsupported-title">{{ $t('viewer.unsupportedFormat') }}</p>
      <p class="excel-unsupported-hint">
        {{ fileName }}{{ $t('viewer.legacyXls') }}
        {{ $t('viewer.onlyXlsx') }}
      </p>
    </div>
    <div v-else-if="!content" class="excel-empty">
      <p>{{ $t('viewer.unableToPreview') }}</p>
    </div>
    <vue-office-excel v-else :src="buffer" style="height: 100%" />
    <div v-if="error" class="excel-error">{{ error }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue';
import { useI18n } from 'vue-i18n';
import VueOfficeExcel from '@vue-office/excel';
import '@vue-office/excel/lib/index.css';

const { t } = useI18n();

const props = defineProps<{
  content: string;
  fileName: string;
}>();

const buffer = ref<ArrayBuffer | null>(null);
const error = ref('');
const isLegacyXls = computed(() => props.fileName.toLowerCase().endsWith('.xls'));

function update() {
  if (!props.content || isLegacyXls.value) {
    buffer.value = null;
    return;
  }
  error.value = '';
  try {
    const binary = atob(props.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    buffer.value = bytes.buffer;
  } catch (e: any) {
    error.value = e.message || t('viewer.failedToDecode');
  }
}

onMounted(() => update());
watch(() => props.content, () => update());
</script>

<style scoped>
.excel-viewer {
  height: 100%;
  overflow: hidden;
  background: var(--surface-2);
}

.excel-unsupported,
.excel-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  background: var(--surface-2);
  color: var(--text-muted);
}

.excel-unsupported-title {
  font-size: var(--font-md);
  font-weight: var(--weight-semibold);
  margin-bottom: var(--space-2);
  color: var(--text-secondary);
}

.excel-unsupported-hint {
  font-size: var(--font-sm);
  max-width: 400px;
  text-align: center;
  line-height: 1.5;
}

.excel-error {
  padding: var(--space-4);
  color: var(--danger);
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  font-size: var(--font-sm);
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
}
</style>
