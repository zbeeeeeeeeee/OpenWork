<template>
  <div class="side-bar">
    <div class="sb-header">
      <span class="sb-title">{{ title }}</span>
    </div>

    <div v-if="sections.length === 0" class="sb-empty">
      {{ $t('sidebar.noContent') }}
    </div>

    <template v-for="(section, idx) in sections" :key="idx">
      <div class="sb-section">
        <div class="sb-section-header" @click="toggle(section.id)">
          <span class="sb-section-arrow">{{ collapsed.has(section.id) ? '▸' : '▾' }}</span>
          <span class="sb-section-label">{{ section.label }}</span>
          <span v-if="section.count !== undefined" class="sb-section-count">({{ section.count }})</span>
        </div>
        <div v-if="!collapsed.has(section.id)" class="sb-section-body">
          <slot :name="section.id" :section="section">
            <div class="sb-section-empty">{{ $t('sidebar.empty') }}</div>
          </slot>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

/** 侧边栏面板区域 */
export interface SideBarSection {
  id: string;
  label: string;
  count?: number;
}

defineProps<{
  title: string;
  sections: SideBarSection[];
}>();

/** 折叠状态集合 —— 包含在其中的面板 ID 表示已折叠 */
const collapsed = ref(new Set<string>());

function toggle(id: string) {
  const s = new Set(collapsed.value);
  if (s.has(id)) {
    s.delete(id);
  } else {
    s.add(id);
  }
  collapsed.value = s;
}
</script>

<style scoped>
.side-bar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-1);
  overflow: hidden;
}

.sb-header {
  padding: var(--space-3) var(--space-3) var(--space-2);
}

.sb-title {
  font-size: var(--font-xs);
  font-weight: var(--weight-semibold);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.sb-empty {
  padding: var(--space-4) var(--space-3);
  font-size: var(--font-sm);
  color: var(--text-muted);
  text-align: center;
}

.sb-section {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
}

.sb-section:first-of-type {
  flex: 1 1 auto;
}

.sb-section-header {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  user-select: none;
  font-size: var(--font-xs);
  color: var(--text-muted);
  background: transparent;
  transition: color var(--transition-fast);
}

.sb-section-header:hover {
  color: var(--text-secondary);
}

.sb-section-arrow {
  font-size: 8px;
  width: 12px;
  flex-shrink: 0;
  color: var(--text-muted);
}

.sb-section-label {
  font-weight: var(--weight-medium);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.sb-section-count {
  color: var(--text-muted);
  font-weight: var(--weight-normal);
}

.sb-section-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.sb-section-empty {
  padding: var(--space-3);
  font-size: var(--font-sm);
  color: var(--text-muted);
  font-style: italic;
}
</style>
