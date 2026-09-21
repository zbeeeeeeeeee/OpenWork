<template>
  <div class="markdown-viewer">
    <div class="viewer-toolbar">
      <button :class="{ active: mode === 'code' }" @click="mode = 'code'">Code</button>
      <button :class="{ active: mode === 'preview' }" @click="mode = 'preview'">Preview</button>
      <button :class="{ active: mode === 'split' }" @click="mode = 'split'">Split</button>
    </div>
    <div class="viewer-content" :class="'mode-' + mode">
      <div v-show="mode === 'code' || mode === 'split'" class="editor-pane" ref="editorPaneRef"></div>
      <div v-if="mode === 'split'" class="split-divider"></div>
      <div
        v-show="mode === 'preview' || mode === 'split'"
        class="preview-pane markdown-body"
        v-html="renderedHtml"
      ></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as monaco from 'monaco-editor';
import { setEditorInstance, clearEditorInstance } from '../../services/editorInstance';
import { useSettingsStore } from '../../stores/settings';
import { renderMarkdown } from '../../services/markdown';

const props = defineProps<{
  content: string;
  language: string;
}>();

const emit = defineEmits<{
  'content-change': [content: string];
}>();

const settings = useSettingsStore();

type MarkdownMode = 'code' | 'preview' | 'split';
const mode = ref<MarkdownMode>('split');

const editorPaneRef = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;

const renderedHtml = computed(() => renderMarkdown(props.content));

onMounted(() => {
  if (!editorPaneRef.value) return;

  editor = monaco.editor.create(editorPaneRef.value, {
    value: props.content,
    language: 'markdown',
    theme: settings.theme === 'light' ? 'vs' : 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'on',
    tabSize: 2,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    smoothScrolling: true,
  });

  editor.onDidChangeModelContent(() => {
    const val = editor!.getValue();
    emit('content-change', val);
  });

  setEditorInstance(editor);
});

watch(() => props.content, (val) => {
  if (editor && val !== editor.getValue()) {
    editor.setValue(val);
  }
});

watch(() => props.language, (lang) => {
  if (editor) {
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, lang);
  }
});

watch(() => settings.theme, (t) => {
  if (editor) {
    monaco.editor.setTheme(t === 'light' ? 'vs' : 'vs-dark');
  }
});

watch(mode, (newMode) => {
  if (newMode === 'split' || newMode === 'code') {
    nextTick(() => {
      if (editor) editor.layout();
    });
  }
});

onBeforeUnmount(() => {
  clearEditorInstance();
  if (editor) {
    editor.dispose();
    editor = null;
  }
});
</script>

<style scoped>
.markdown-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-2);
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
}

.viewer-toolbar button {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.viewer-toolbar button:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.viewer-toolbar button.active {
  color: var(--text-primary);
  background: var(--surface-selected);
}

.viewer-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.viewer-content.mode-code .editor-pane,
.viewer-content.mode-preview .preview-pane {
  flex: 1;
}

.viewer-content.mode-split .editor-pane,
.viewer-content.mode-split .preview-pane {
  flex: 1;
}

.editor-pane {
  min-width: 0;
}

.split-divider {
  width: 4px;
  background: var(--border-subtle);
  cursor: col-resize;
  flex-shrink: 0;
}

.split-divider:hover {
  background: var(--accent);
}

.preview-pane {
  background: var(--surface-2);
  overflow-y: auto;
  padding: var(--space-4);
}

.markdown-body {
  color: var(--text-primary);
  line-height: 1.7;
  font-size: var(--font-md);
}
</style>
