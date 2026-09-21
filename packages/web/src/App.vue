<!--
  根组件 —— 渲染主布局并定义全局 CSS 变量
  遵循 Codex Desktop 现代主题风格
-->
<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider>
      <n-dialog-provider>
        <n-notification-provider>
          <n-modal-provider>
            <MainLayout />
          </n-modal-provider>
        </n-notification-provider>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  NNotificationProvider,
  NModalProvider,
} from 'naive-ui'
import { useNaiveTheme } from './composables/useNaiveTheme'
import MainLayout from './components/layout/MainLayout.vue'

const { naiveTheme, themeOverrides } = useNaiveTheme()
</script>

<style>
/* ===== Design Token: theme-independent ===== */
:root {
  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;
  --radius-xl: 12px;
  --radius-full: 9999px;

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;

  --font-xs: 11px;
  --font-sm: 12px;
  --font-base: 13px;
  --font-md: 14px;
  --font-lg: 16px;

  --weight-normal: 400;
  --weight-medium: 500;
  --weight-semibold: 600;

  --transition-fast: 120ms ease;
  --transition-base: 180ms ease;
}

/* ===== Design Token: dark ===== */
:root[data-theme="dark"] {
  --app-bg: #101319;
  --surface-1: #14171d;
  --surface-2: #181c22;
  --surface-3: #1e232b;
  --surface-hover: rgba(255, 255, 255, 0.06);
  --surface-selected: rgba(255, 255, 255, 0.08);

  --border-subtle: rgba(255, 255, 255, 0.06);
  --border-default: rgba(255, 255, 255, 0.10);

  --text-primary: rgba(255, 255, 255, 0.92);
  --text-secondary: rgba(255, 255, 255, 0.64);
  --text-muted: rgba(255, 255, 255, 0.40);
  --text-disabled: rgba(255, 255, 255, 0.24);

  --accent: #6ea8fe;
  --accent-hover: #8db8ff;
  --accent-pressed: #5b8fd9;
  --danger: #f06a6a;
  --success: #4caf7c;
  --warning: #d4a24e;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.40);

  /* legacy aliases */
  --bg-primary: var(--app-bg);
  --bg-secondary: var(--surface-1);
  --bg-tertiary: var(--surface-2);
  --bg-hover: var(--surface-hover);
  --border-color: var(--border-default);
  --accent-color: var(--accent);
  --statusbar-bg: var(--surface-1);
  --statusbar-text: var(--text-secondary);
  --scrollbar-thumb: var(--surface-3);
  --scrollbar-thumb-hover: var(--border-default);

  /* legacy agent tokens: migrated in later phases */
  --agent-msg-assistant-bg: #1a3a5c;
  --agent-msg-system-bg: #5c1a1a;
  --agent-code-bg: #0d1117;
  --agent-code-accent: #e06c75;
  --agent-thinking-title: #d4a017;
  --agent-thinking-text: #b8952e;
  --agent-thinking-surface: rgba(255,200,50,0.05);
  --agent-thinking-border: rgba(255,200,50,0.2);
  --agent-blockquote-bg: rgba(255,255,255,0.03);
  --agent-divider: rgba(255,255,255,0.1);
  --agent-edit-text: #4ec9b0;
  --agent-edit-surface: rgba(0,200,100,0.1);
  --agent-edit-border: rgba(0,200,100,0.3);
  --agent-edit-badge: rgba(0,200,100,0.15);
  --agent-undo-text: #d4a017;
  --agent-undo-surface: rgba(255,200,50,0.15);
  --agent-undo-border: rgba(255,200,50,0.3);
  --agent-item-hover: rgba(255,255,255,0.08);
  --agent-on-accent-text: #fff;
}

/* ===== Design Token: light ===== */
:root[data-theme="light"] {
  --app-bg: #f6f7f9;
  --surface-1: #ffffff;
  --surface-2: #fbfbfc;
  --surface-3: #ffffff;
  --surface-hover: rgba(0, 0, 0, 0.04);
  --surface-selected: rgba(0, 0, 0, 0.06);

  --border-subtle: rgba(0, 0, 0, 0.06);
  --border-default: rgba(0, 0, 0, 0.10);

  --text-primary: rgba(0, 0, 0, 0.88);
  --text-secondary: rgba(0, 0, 0, 0.58);
  --text-muted: rgba(0, 0, 0, 0.34);
  --text-disabled: rgba(0, 0, 0, 0.18);

  --accent: #3b82f6;
  --accent-hover: #60a5fa;
  --accent-pressed: #2563eb;
  --danger: #dc2626;
  --success: #16a34a;
  --warning: #d97706;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.12);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.18);

  /* legacy aliases */
  --bg-primary: var(--app-bg);
  --bg-secondary: var(--surface-1);
  --bg-tertiary: var(--surface-2);
  --bg-hover: var(--surface-hover);
  --border-color: var(--border-default);
  --accent-color: var(--accent);
  --statusbar-bg: var(--surface-1);
  --statusbar-text: var(--text-secondary);
  --scrollbar-thumb: var(--surface-3);
  --scrollbar-thumb-hover: var(--border-default);

  /* legacy agent tokens: migrated in later phases */
  --agent-msg-assistant-bg: #e8f0fe;
  --agent-msg-system-bg: #fde8e8;
  --agent-code-bg: #f6f8fa;
  --agent-code-accent: #cf222e;
  --agent-thinking-title: #9a7b0b;
  --agent-thinking-text: #7d6608;
  --agent-thinking-surface: rgba(180,140,10,0.05);
  --agent-thinking-border: rgba(180,140,10,0.2);
  --agent-blockquote-bg: rgba(0,0,0,0.04);
  --agent-divider: rgba(0,0,0,0.1);
  --agent-edit-text: #16a34a;
  --agent-edit-surface: rgba(22,163,74,0.1);
  --agent-edit-border: rgba(22,163,74,0.25);
  --agent-edit-badge: rgba(22,163,74,0.12);
  --agent-undo-text: #92400e;
  --agent-undo-surface: rgba(146,64,14,0.1);
  --agent-undo-border: rgba(146,64,14,0.25);
  --agent-item-hover: rgba(0,0,0,0.06);
  --agent-on-accent-text: #fff;
}

/* ===== Design Token: blue ===== */
:root[data-theme="blue"] {
  --app-bg: #0a1628;
  --surface-1: #0e1d33;
  --surface-2: #12243e;
  --surface-3: #192f4d;
  --surface-hover: rgba(255, 255, 255, 0.08);
  --surface-selected: rgba(255, 255, 255, 0.12);

  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-default: rgba(255, 255, 255, 0.14);

  --text-primary: rgba(255, 255, 255, 0.94);
  --text-secondary: rgba(255, 255, 255, 0.68);
  --text-muted: rgba(255, 255, 255, 0.42);
  --text-disabled: rgba(255, 255, 255, 0.24);

  --accent: #6ea8fe;
  --accent-hover: #8db8ff;
  --accent-pressed: #5b8fd9;
  --danger: #f06a6a;
  --success: #4caf7c;
  --warning: #d4a24e;

  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 16px rgba(0, 0, 0, 0.32);
  --shadow-lg: 0 8px 32px rgba(0, 0, 0, 0.40);

  /* legacy aliases */
  --bg-primary: var(--app-bg);
  --bg-secondary: var(--surface-1);
  --bg-tertiary: var(--surface-2);
  --bg-hover: var(--surface-hover);
  --border-color: var(--border-default);
  --accent-color: var(--accent);
  --statusbar-bg: var(--surface-1);
  --statusbar-text: var(--text-secondary);
  --scrollbar-thumb: var(--surface-3);
  --scrollbar-thumb-hover: var(--border-default);

  /* legacy agent tokens: migrated in later phases */
  --agent-msg-assistant-bg: #1a3a5c;
  --agent-msg-system-bg: #5c1a1a;
  --agent-code-bg: #0d1117;
  --agent-code-accent: #e06c75;
  --agent-thinking-title: #d4a017;
  --agent-thinking-text: #b8952e;
  --agent-thinking-surface: rgba(255,200,50,0.05);
  --agent-thinking-border: rgba(255,200,50,0.2);
  --agent-blockquote-bg: rgba(255,255,255,0.03);
  --agent-divider: rgba(255,255,255,0.1);
  --agent-edit-text: #4ec9b0;
  --agent-edit-surface: rgba(0,200,100,0.1);
  --agent-edit-border: rgba(0,200,100,0.3);
  --agent-edit-badge: rgba(0,200,100,0.15);
  --agent-undo-text: #d4a017;
  --agent-undo-surface: rgba(255,200,50,0.15);
  --agent-undo-border: rgba(255,200,50,0.3);
  --agent-item-hover: rgba(255,255,255,0.08);
  --agent-on-accent-text: #fff;
}

body {
  background: var(--app-bg);
  color: var(--text-primary);
  font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

:where(a, button, input, textarea, select):focus-visible {
  outline: 1px solid var(--accent);
  outline-offset: 1px;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-thumb {
  background: var(--scrollbar-thumb);
  border-radius: var(--radius-full);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--scrollbar-thumb-hover);
}

::-webkit-scrollbar-track {
  background: transparent;
}
</style>
