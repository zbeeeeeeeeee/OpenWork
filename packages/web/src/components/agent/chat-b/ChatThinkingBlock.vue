<template>
  <n-collapse-item :name="block.id" class="chat-thinking">
    <template #header>
      <n-tag type="warning" size="small" :bordered="false">💭 {{ $t('agent.reasoning') }}</n-tag>
    </template>
    <div class="thinking-content" v-html="renderedHtml"></div>
  </n-collapse-item>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCollapseItem, NTag } from 'naive-ui';
import { sanitizeThinking } from '@openwork/agent/sanitize';
import { renderMarkdown } from '../../../services/markdown';
import type { DisplayBlock } from '@openwork/agent';

const props = defineProps<{
  block: DisplayBlock & { type: 'thinking' };
}>();

const renderedHtml = computed(() => renderMarkdown(sanitizeThinking(props.block.content || '')));
</script>

<style scoped>
.chat-thinking {
  --n-title-text-color: #b8952e;
}
.thinking-content {
  font-size: 12px;
  line-height: 1.5;
  color: #c9a84c;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0 4px;
}
.thinking-content :deep(pre) {
  background: #1a1810;
  color: #e8d48b;
  border: 1px solid rgba(184, 149, 46, 0.35);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  white-space: pre;
}
.thinking-content :deep(pre code) {
  color: inherit;
  background: transparent;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.thinking-content :deep(:not(pre) > code) {
  background: rgba(184, 149, 46, 0.15);
  color: #f0d78c;
  padding: 0 3px;
  border-radius: 3px;
}
.thinking-content :deep(p) {
  margin: 4px 0;
  color: inherit;
}
</style>
