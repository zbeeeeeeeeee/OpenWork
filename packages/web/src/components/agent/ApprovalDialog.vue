<template>
  <n-modal
    :show="visible"
    preset="card"
    :title="t('approval.title')"
    :style="{ width: '480px' }"
    :bordered="false"
    @update:show="(v: boolean) => { if (!v) $emit('deny'); }"
  >
    <div class="approval-body">
      <!-- 工具名 + 模式标签 -->
      <div class="approval-header">
        <span class="approval-tool">{{ toolName }}</span>
        <n-tag :type="modeTagType" size="small" :bordered="false">{{ modeLabel }}</n-tag>
      </div>

      <!-- 操作摘要 -->
      <div class="approval-label">{{ label }}</div>

      <!-- 参数预览 -->
      <div v-if="hasPreview" class="approval-preview">
        <div v-if="preview?.path" class="preview-row">
          <span class="preview-key">{{ t('approval.path') }}</span>
          <span class="preview-val mono">{{ preview.path }}</span>
        </div>
        <div v-if="preview?.commandPreview" class="preview-row">
          <span class="preview-key">{{ t('approval.command') }}</span>
          <span class="preview-val mono">{{ preview.commandPreview }}</span>
        </div>
        <div v-if="preview?.contentPreview" class="preview-row">
          <span class="preview-key">{{ t('approval.content') }}</span>
          <div class="preview-block">
            <pre class="mono">{{ preview.contentPreview }}</pre>
            <span v-if="preview.contentLength" class="preview-hint">{{ t('approval.charsTotal', { n: preview.contentLength }) }}</span>
          </div>
        </div>
        <template v-if="preview?.oldPreview || preview?.newPreview">
          <div v-if="preview?.oldPreview" class="preview-row">
            <span class="preview-key">{{ t('approval.oldContent') }}</span>
            <div class="preview-block"><pre class="mono old">{{ preview.oldPreview }}</pre></div>
          </div>
          <div v-if="preview?.newPreview" class="preview-row">
            <span class="preview-key">{{ t('approval.newContent') }}</span>
            <div class="preview-block"><pre class="mono new">{{ preview.newPreview }}</pre></div>
          </div>
        </template>
      </div>

      <!-- 错误提示 -->
      <div v-if="errorMessage" class="approval-error">{{ errorMessage }}</div>
    </div>

    <template #footer>
      <div class="approval-footer">
        <n-button quaternary size="small" @click="$emit('deny')">
          {{ t('approval.deny') }}
        </n-button>
        <n-button
          v-if="errorMessage"
          size="small"
          @click="$emit('retry')"
        >
          {{ t('approval.retry') }}
        </n-button>
        <n-button
          type="primary"
          size="small"
          :disabled="!!errorMessage"
          @click="$emit('allow')"
        >
          {{ t('approval.allow') }}
        </n-button>
      </div>
    </template>
  </n-modal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';
import { NModal, NButton, NTag } from 'naive-ui';
import type { ApprovalPreview } from '../../services/agentService';

const props = defineProps<{
  visible: boolean;
  toolName: string;
  label: string;
  preview?: ApprovalPreview;
  mode: string;
  errorMessage?: string;
}>();

defineEmits<{
  allow: [];
  deny: [];
  retry: [];
}>();

const { t } = useI18n();

const modeLabel = computed(() => {
  switch (props.mode) {
    case 'suggest': return t('settings.permSuggest');
    case 'auto-edit': return t('settings.permAutoEdit');
    case 'full-auto': return t('settings.permFullAuto');
    default: return props.mode;
  }
});

const modeTagType = computed(() => {
  switch (props.mode) {
    case 'suggest': return 'warning' as const;
    case 'auto-edit': return 'info' as const;
    case 'full-auto': return 'error' as const;
    default: return 'default' as const;
  }
});

const hasPreview = computed(() => {
  const p = props.preview;
  return !!(p && (p.path || p.commandPreview || p.contentPreview || p.oldPreview || p.newPreview));
});
</script>

<style scoped>
.approval-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.approval-header {
  display: flex;
  align-items: center;
  gap: 8px;
}
.approval-tool {
  font-weight: 600;
  font-size: 14px;
}
.approval-label {
  font-size: 12px;
  color: var(--text-secondary, #888);
  background: rgba(255,255,255,0.04);
  padding: 6px 8px;
  border-radius: 4px;
  word-break: break-all;
}
.approval-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 220px;
  overflow-y: auto;
}
.preview-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.preview-key {
  flex-shrink: 0;
  width: 48px;
  font-size: 12px;
  color: var(--text-muted, #888);
  line-height: 20px;
}
.preview-val {
  flex: 1;
  font-size: 12px;
  word-break: break-all;
  line-height: 20px;
}
.preview-block {
  flex: 1;
  min-width: 0;
}
.preview-block pre {
  margin: 0;
  padding: 6px 8px;
  background: rgba(0,0,0,0.2);
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.5;
  max-height: 80px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
.preview-block pre.old { border-left: 2px solid #e88080; }
.preview-block pre.new { border-left: 2px solid #80e89a; }
.preview-hint {
  font-size: 11px;
  color: var(--text-muted, #888);
}
.approval-error {
  padding: 8px 10px;
  background: rgba(232,128,128,0.12);
  border: 1px solid rgba(232,128,128,0.4);
  border-radius: 4px;
  color: #e88080;
  font-size: 12px;
}
.approval-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.mono {
  font-family: 'Consolas', 'Courier New', monospace;
}
</style>
