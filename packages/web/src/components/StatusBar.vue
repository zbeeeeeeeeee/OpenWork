<template>
  <div class="status-bar">
    <div class="status-bar-left">
      <span v-if="activeTab" class="status-item">
        {{ activeTab.language }}
      </span>
      <span v-if="lineCol" class="status-item status-ln-col">
        {{ $t('statusBar.ln') }} {{ lineCol.line }}, {{ $t('statusBar.col') }} {{ lineCol.column }}
      </span>
    </div>
    <div class="status-bar-right">
      <span v-if="workspaceMode" class="status-item status-mode">
        {{ workspaceMode }}
      </span>
      <span v-if="showNotification" class="status-item status-notification">
        {{ notificationText }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import { getEditorInstance } from '../services/editorInstance';
import type { WorkspaceMode, EditorTab } from '../stores/editor';

const props = defineProps<{
  activeTab: EditorTab | null;
  workspaceMode: WorkspaceMode;
  showNotification?: boolean;
  notificationText?: string;
}>();

const lineCol = ref<{ line: number; column: number } | null>(null);
let cursorDisposable: { dispose(): void } | null = null;

/** 从编辑器单例获取当前光标位置 */
function updateCursorPosition() {
  const editor = getEditorInstance();
  if (!editor) {
    lineCol.value = null;
    return;
  }
  const position = editor.getPosition();
  if (position) {
    lineCol.value = { line: position.lineNumber, column: position.column };
  }
}

/** 建立光标位置变化监听 */
function setupCursorListener() {
  cursorDisposable?.dispose();
  cursorDisposable = null;
  const editor = getEditorInstance();
  if (editor) {
    updateCursorPosition();
    cursorDisposable = editor.onDidChangeCursorPosition(() => {
      updateCursorPosition();
    });
  } else {
    lineCol.value = null;
  }
}

// 活动标签切换时重新绑定监听（新标签 = 新 Monaco 模型 = 新编辑器实例）
watch(() => props.activeTab?.id, async () => {
  await nextTick();
  setupCursorListener();
});

onMounted(() => {
  setupCursorListener();
});

onBeforeUnmount(() => {
  cursorDisposable?.dispose();
});
</script>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 22px;
  background: var(--surface-1);
  border-top: 1px solid var(--border-subtle);
  padding: 0 var(--space-3);
  flex-shrink: 0;
  user-select: none;
  font-size: var(--font-sm);
  color: var(--text-secondary);
}

.status-bar-left,
.status-bar-right {
  display: flex;
  align-items: center;
  height: 100%;
  gap: var(--space-1);
}

.status-item {
  padding: 0 var(--space-2);
  height: 100%;
  display: flex;
  align-items: center;
  white-space: nowrap;
  border-radius: var(--radius-sm);
}

.status-item:hover {
  background: var(--surface-hover);
}

.status-ln-col {
  cursor: default;
}

.status-mode {
  font-size: var(--font-xs);
  text-transform: uppercase;
  font-weight: var(--weight-medium);
}

.status-notification {
  font-size: var(--font-xs);
  opacity: 0.7;
}
</style>
