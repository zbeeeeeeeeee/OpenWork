<template>
  <!-- 用户消息 -->
  <div v-if="message.role === 'user'" class="msg-user">
    <div class="msg-user-bubble">
      <ChatResponseBlock :content="message.content" />
    </div>
  </div>

  <!-- 系统/错误消息 -->
  <n-alert v-else-if="message.role === 'system'" type="error" :show-icon="false" class="msg-system">
    <ChatResponseBlock :content="message.content" />
  </n-alert>

  <!-- 助手消息：按 blocks 时间轴渲染，思考/工具/正文交错 -->
  <div v-else-if="message.role === 'assistant'" class="msg-assistant">
    <template v-for="item in timelineItems" :key="item.key">
      <n-collapse
        v-if="item.kind === 'thinking'"
        :default-expanded-names="item.expanded ? [item.block.id] : []"
      >
        <ChatThinkingBlock :block="item.block" />
      </n-collapse>
      <ChatToolBlock
        v-else-if="item.kind === 'tool'"
        :block="item.block"
      />
      <div v-else class="msg-response-wrapper">
        <ChatResponseBlock :content="item.block.content" />
      </div>
    </template>
    <!-- 兜底: blocks 缺失/为空时仍展示 content -->
    <div
      v-if="showContentFallback"
      class="msg-response-wrapper msg-fallback"
    >
      <ChatResponseBlock :content="message.content || fallbackText" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { NCollapse, NAlert } from 'naive-ui';
import type { DisplayMessage, DisplayBlock } from '@openwork/agent';
import { sanitizeDisplayContent } from '@openwork/agent/sanitize';
import ChatThinkingBlock from './ChatThinkingBlock.vue';
import ChatToolBlock from './ChatToolBlock.vue';
import ChatResponseBlock from './ChatResponseBlock.vue';

const props = defineProps<{
  message: DisplayMessage;
}>();

type ThinkingBlock = DisplayBlock & { type: 'thinking'; content: string };
type ToolBlock = DisplayBlock & { type: 'tool_call' };
type ResponseBlock = DisplayBlock & { type: 'response'; content: string };

type TimelineItem =
  | { kind: 'thinking'; key: string; block: ThinkingBlock; expanded: boolean }
  | { kind: 'tool'; key: string; block: ToolBlock }
  | { kind: 'response'; key: string; block: ResponseBlock };

/**
 * 按 blocks 原始顺序渲染：
 * - 跳过空/过短思考碎片（如 "The"）
 * - 相邻思考合并；思考默认全部折叠，正文才是主信息
 * - 无正文时才默认展开，避免英文 thinking 抢主视觉
 */
const MIN_THINKING_CHARS = 12;

const timelineItems = computed<TimelineItem[]>(() => {
  const blocks = props.message.blocks || [];
  /** 流式过程中不渲染 thinking：避免英文碎片/空壳刷屏；落库刷新后再显示（默认折叠） */
  const hideThinking = !!props.message.live;

  const items: TimelineItem[] = [];
  let pendingId = '';
  let pendingContent = '';

  const flushThinking = () => {
    const text = pendingContent.trim();
    if (!hideThinking && pendingId && text.length >= MIN_THINKING_CHARS) {
      const block = {
        id: pendingId,
        type: 'thinking' as const,
        content: text,
        completed: true,
      } as ThinkingBlock;
      items.push({
        kind: 'thinking',
        key: pendingId,
        block,
        expanded: false,
      });
    }
    pendingId = '';
    pendingContent = '';
  };

  for (const raw of blocks) {
    if (raw.type === 'thinking') {
      if (hideThinking) continue;
      const content = ((raw as ThinkingBlock).content || '').trim();
      if (!content) continue;
      if (pendingId) {
        pendingContent = `${pendingContent.trim()}\n\n${content}`.trim();
      } else {
        pendingId = raw.id;
        pendingContent = content;
      }
      continue;
    }

    flushThinking();

    if (raw.type === 'tool_call') {
      items.push({ kind: 'tool', key: raw.id, block: raw as ToolBlock });
    } else if (raw.type === 'response') {
      const b = raw as ResponseBlock;
      const content = sanitizeDisplayContent(b.content || '');
      if (content.trim()) {
        items.push({
          kind: 'response',
          key: b.id,
          block: { ...b, content } as ResponseBlock,
        });
      }
    }
  }
  flushThinking();

  return items;
});

const showContentFallback = computed(() => {
  if (timelineItems.value.some(i => i.kind === 'response')) return false;
  if (timelineItems.value.some(i => i.kind === 'thinking' || i.kind === 'tool')) return false;
  const c = (props.message.content || '').trim();
  return c.length > 0;
});

const fallbackText = '*[无额外正文，详见思考过程]*';
</script>

<style scoped>
.msg-user {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}
.msg-user-bubble {
  max-width: 80%;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 12px 12px 4px 12px;
  padding: 10px 14px;
}
.msg-system {
  margin-bottom: 12px;
}
.msg-assistant {
  margin-bottom: 16px;
}
.msg-response-wrapper {
  padding: 8px 12px;
}
.msg-fallback {
  color: var(--text-secondary);
  font-size: 12px;
}
</style>
