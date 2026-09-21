<template>
  <div ref="editorContainer" class="monaco-editor-wrapper"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue';
import * as monaco from 'monaco-editor';
import 'monaco-editor/min/vs/editor/editor.main.css';
import { setEditorInstance, clearEditorInstance } from '../../services/editorInstance';
import { useSettingsStore, type Theme } from '../../stores/settings';

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new tsWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker();
    if (label === 'json') return new jsonWorker();
    return new editorWorker();
  },
};

const settings = useSettingsStore();

const props = defineProps<{
  content: string;
  language: string;
  readOnly?: boolean;
}>();

const emit = defineEmits<{
  'content-change': [content: string];
  'editor-ready': [editor: monaco.editor.IStandaloneCodeEditor];
}>();

const editorContainer = ref<HTMLElement>();
let editor: monaco.editor.IStandaloneCodeEditor | null = null;
let resizeObserver: ResizeObserver | null = null;

function forceLayout() {
  if (!editor) return;
  try {
    editor.layout();
  } catch {
    /* ignore */
  }
}

const EDITOR_THEME_NAMES: Record<Theme, string> = {
  dark: 'openwork-dark',
  light: 'openwork-light',
  blue: 'openwork-blue',
};

let editorThemesDefined = false;

function defineEditorThemes(): void {
  if (editorThemesDefined) return;
  editorThemesDefined = true;

  monaco.editor.defineTheme(EDITOR_THEME_NAMES.dark, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#181c22',
      'editor.foreground': '#d6dbe2',
      'editor.lineHighlightBackground': '#1e232b',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#1e3a5f',
      'editorCursor.foreground': '#6ea8fe',
      'editorLineNumber.foreground': '#59636f',
      'editorLineNumber.activeForeground': '#aab4c0',
      'editorGutter.background': '#181c22',
      'editorWidget.background': '#1e232b',
      'editorWidget.border': '#2a3140',
      'editorSuggestWidget.background': '#1e232b',
      'editorSuggestWidget.border': '#2a3140',
      'editorHoverWidget.background': '#1e232b',
      'editorHoverWidget.border': '#2a3140',
      'scrollbarSlider.background': '#ffffff22',
      'scrollbarSlider.hoverBackground': '#ffffff33',
      'minimap.background': '#181c22',
    },
  });

  monaco.editor.defineTheme(EDITOR_THEME_NAMES.light, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#fbfbfc',
      'editor.foreground': '#1f2328',
      'editor.lineHighlightBackground': '#f0f1f3',
      'editor.selectionBackground': '#cfe0f5',
      'editor.inactiveSelectionBackground': '#dce7f3',
      'editorCursor.foreground': '#3b82f6',
      'editorLineNumber.foreground': '#9aa1ab',
      'editorLineNumber.activeForeground': '#3b82f6',
      'editorGutter.background': '#fbfbfc',
      'editorWidget.background': '#ffffff',
      'editorWidget.border': '#e4e6ea',
      'editorSuggestWidget.background': '#ffffff',
      'editorSuggestWidget.border': '#e4e6ea',
      'editorHoverWidget.background': '#ffffff',
      'editorHoverWidget.border': '#e4e6ea',
      'scrollbarSlider.background': '#00000022',
      'scrollbarSlider.hoverBackground': '#00000033',
      'minimap.background': '#fbfbfc',
    },
  });

  monaco.editor.defineTheme(EDITOR_THEME_NAMES.blue, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#12243e',
      'editor.foreground': '#dce4f0',
      'editor.lineHighlightBackground': '#192f4d',
      'editor.selectionBackground': '#264f78',
      'editor.inactiveSelectionBackground': '#1e3a5f',
      'editorCursor.foreground': '#6ea8fe',
      'editorLineNumber.foreground': '#5a7296',
      'editorLineNumber.activeForeground': '#a8bcd8',
      'editorGutter.background': '#12243e',
      'editorWidget.background': '#192f4d',
      'editorWidget.border': '#243d60',
      'editorSuggestWidget.background': '#192f4d',
      'editorSuggestWidget.border': '#243d60',
      'editorHoverWidget.background': '#192f4d',
      'editorHoverWidget.border': '#243d60',
      'scrollbarSlider.background': '#ffffff22',
      'scrollbarSlider.hoverBackground': '#ffffff33',
      'minimap.background': '#12243e',
    },
  });
}

function getEditorThemeName(theme: Theme): string {
  return EDITOR_THEME_NAMES[theme] || EDITOR_THEME_NAMES.dark;
}

onMounted(() => {
  if (!editorContainer.value) return;

  try {
    defineEditorThemes();

  const monacoTheme = getEditorThemeName(settings.theme);

  // 创建 Monaco 编辑器实例（先内置主题，再 setTheme，避免 token theme 崩溃）
  editor = monaco.editor.create(editorContainer.value, {
    value: props.content ?? '',
    language: props.language,
    readOnly: props.readOnly ?? false,
    theme: monacoTheme === 'openwork-light' ? 'vs' : 'vs-dark',
    automaticLayout: true,               // 自动响应容器大小变化
    minimap: { enabled: true },
    fontSize: 14,
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    wordWrap: 'off',
    tabSize: 2,
    renderWhitespace: 'selection',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
  });
  try {
    monaco.editor.setTheme(monacoTheme);
  } catch {
    /* ignore custom theme failures */
  }

    // 内容变更时通知父组件
    editor.onDidChangeModelContent(() => {
      if (editor) emit('content-change', editor.getValue());
    });

    // 注册到编辑器单例，供其他组件访问
    setEditorInstance(editor);
    emit('editor-ready', editor);

    // 容器尺寸在挂载后才稳定；多帧强制 layout
    void nextTick(() => {
      forceLayout();
      requestAnimationFrame(() => {
        forceLayout();
        setTimeout(forceLayout, 50);
        setTimeout(forceLayout, 200);
      });
    });

    if (typeof ResizeObserver !== 'undefined' && editorContainer.value) {
      resizeObserver = new ResizeObserver(() => forceLayout());
      resizeObserver.observe(editorContainer.value);
    }
  } catch (e) {
    console.error('[MonacoEditor] create failed', e);
  }
});

// 语言切换：动态更新 Monaco 模型的语言模式
watch(() => props.language, (lang) => {
  if (editor) {
    const model = editor.getModel();
    if (model) monaco.editor.setModelLanguage(model, lang);
    editor.layout();
  }
});

// 外部内容变更：同步到编辑器（仅在值不同时，避免循环更新）
watch(() => props.content, (val) => {
  if (editor && val !== editor.getValue()) {
    editor.setValue(val ?? '');
    editor.layout();
  }
});

// 主题切换：更新 Monaco 编辑器主题
watch(() => settings.theme, (t) => {
  if (editor) {
    monaco.editor.setTheme(getEditorThemeName(t));
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  resizeObserver = null;
  // 仅当全局单例仍是本实例时才 dispose，避免关闭无关 Tab 时销毁正在使用的编辑器
  clearEditorInstance(editor);
});
</script>

<style scoped>
.monaco-editor-wrapper {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
