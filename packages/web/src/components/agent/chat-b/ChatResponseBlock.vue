<template>
  <div class="chat-response" v-html="renderedHtml"></div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { sanitizeDisplayContent } from '@openwork/agent/sanitize';
import { renderMarkdown } from '../../../services/markdown';

const props = defineProps<{
  content: string;
}>();

const renderedHtml = computed(() => renderMarkdown(sanitizeDisplayContent(props.content || '')));
</script>

<style scoped>
.chat-response {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-primary);
  word-break: break-word;
}
.chat-response :deep(p) { margin: 4px 0; }
.chat-response :deep(pre) {
  background: #1c2128;
  color: #e6edf3;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 6px 0;
  overflow-x: auto;
  font-size: 12px;
  line-height: 1.4;
}
.chat-response :deep(pre) :deep(code),
.chat-response :deep(pre code) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
  color: inherit;
  background: transparent;
  padding: 0;
}
.chat-response :deep(code) {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 12px;
}
.chat-response :deep(:not(pre) > code) {
  background: var(--bg-tertiary, rgba(255, 255, 255, 0.08));
  padding: 1px 4px;
  border-radius: 3px;
  color: #e06c75;
}
</style>
