<template>
  <div class="right-toolbar">
    <div class="rt-top">
      <n-button
        v-for="item in items"
        :key="item.id"
        quaternary
        class="rt-item"
        :class="{ active: activeId === item.id }"
        :title="item.label"
        @click="$emit('select', item.id)"
      >
        <template #icon>
          <n-icon size="22" :component="item.icon" />
        </template>
      </n-button>
    </div>
    <div v-if="bottomItems.length > 0" class="rt-bottom">
      <n-button
        v-for="item in bottomItems"
        :key="item.id"
        quaternary
        class="rt-item"
        :class="{ active: activeId === item.id }"
        :title="item.label"
        @click="$emit('select', item.id)"
      >
        <template #icon>
          <n-icon size="22" :component="item.icon" />
        </template>
      </n-button>
    </div>
    <slot name="bottom" />
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'
import { NButton, NIcon } from 'naive-ui'

export interface RightToolbarItem {
  id: string
  label: string
  icon: Component
}

defineProps<{
  items: RightToolbarItem[]
  bottomItems: RightToolbarItem[]
  activeId: string | null
}>()

defineEmits<{
  select: [id: string]
}>()
</script>

<style scoped>
.right-toolbar {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 48px;
  background: var(--surface-1);
  border-left: 1px solid var(--border-subtle);
  flex-shrink: 0;
  user-select: none;
  padding: var(--space-1) 0;
}

.rt-top,
.rt-bottom {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.rt-item {
  width: 40px;
  height: 40px;
  margin: 0 auto;
  padding: 0;
  color: var(--text-muted);
  border-radius: var(--radius-md);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.rt-item:hover {
  color: var(--text-primary);
  background: var(--surface-hover);
}

.rt-item.active {
  color: var(--text-primary);
  background: var(--surface-selected);
  box-shadow: inset 2px 0 0 var(--accent);
}
</style>
