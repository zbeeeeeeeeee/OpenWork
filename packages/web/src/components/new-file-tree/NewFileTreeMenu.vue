<template>
  <n-dropdown
    trigger="manual"
    placement="bottom-start"
    :show="show"
    :theme-overrides="dropdownThemeOverrides"
    :options="computedOptions"
    @select="handleSelect"
    @clickoutside="emit('close')"
  >
    <div class="dropdown-anchor" ref="anchorRef" />
  </n-dropdown>
</template>

<script setup lang="ts">
import { computed, ref, watch, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NDropdown, NIcon } from 'naive-ui'
import type { DropdownOption, DropdownGroupOption, DropdownDividerOption, DropdownThemeOverrides } from 'naive-ui'
import {
  OpenOutline,
  DocumentOutline,
  FolderOpenOutline,
  CutOutline,
  CopyOutline,
  LinkOutline,
  ClipboardOutline,
  CreateOutline,
  TrashOutline,
  RefreshOutline,
} from '@vicons/ionicons5'
import type { ClipboardData, ContextMenuPayload } from './types'

const props = defineProps<{
  show: boolean
  x: number
  y: number
  payload: ContextMenuPayload | null
  clipboard: ClipboardData | null
}>()

const emit = defineEmits<{
  close: []
  select: [key: string, payload: ContextMenuPayload]
}>()

const anchorRef = ref<HTMLDivElement | null>(null)

const dropdownThemeOverrides: DropdownThemeOverrides = {
  color: 'var(--surface-3)',
  borderRadius: 'var(--radius-lg)',
  optionColorHover: 'var(--surface-hover)',
  optionColorActive: 'var(--surface-selected)',
  optionTextColor: 'var(--text-secondary)',
  optionTextColorHover: 'var(--text-primary)',
  optionTextColorActive: 'var(--accent)',
  optionTextColorChildActive: 'var(--accent)',
  dividerColor: 'var(--border-subtle)',
  groupHeaderTextColor: 'var(--text-muted)',
  prefixColor: 'var(--text-muted)',
  suffixColor: 'var(--text-muted)',
}

watch(() => [props.show, props.x, props.y] as const, ([s, x, y]) => {
  if (s && anchorRef.value) {
    anchorRef.value.style.left = `${x}px`
    anchorRef.value.style.top = `${y}px`
  }
})

type MenuItem = DropdownOption | DropdownGroupOption | DropdownDividerOption

const computedOptions = computed<MenuItem[]>(() => {
  if (!props.payload) return []

  const { type, path, name } = props.payload
  const isFile = type === 'file'
  const isFolder = type === 'folder'
  const isRoot = type === 'root'

  const items: MenuItem[] = []

  if (isFile) {
    items.push({
      label: t('contextMenu.open'),
      key: 'open',
      icon: () => h(NIcon, null, { default: () => h(OpenOutline) }),
    })
    items.push({ type: 'divider', key: 'd1' } as DropdownDividerOption)
  }

  if (isFolder) {
    items.push({
      label: t('contextMenu.newFile'),
      key: 'newFile',
      icon: () => h(NIcon, null, { default: () => h(DocumentOutline) }),
    })
    items.push({
      label: t('contextMenu.newFolder'),
      key: 'newFolder',
      icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
    })
    items.push({ type: 'divider', key: 'd2' } as DropdownDividerOption)
  }

  if (isRoot) {
    items.push({
      label: t('contextMenu.newFile'),
      key: 'newFile',
      icon: () => h(NIcon, null, { default: () => h(DocumentOutline) }),
    })
    items.push({
      label: t('contextMenu.newFolder'),
      key: 'newFolder',
      icon: () => h(NIcon, null, { default: () => h(FolderOpenOutline) }),
    })
    items.push({ type: 'divider', key: 'd3' } as DropdownDividerOption)
  }

  if (!isRoot) {
    items.push({
      label: t('contextMenu.cut'),
      key: 'cut',
      icon: () => h(NIcon, null, { default: () => h(CutOutline) }),
    })
    items.push({
      label: t('contextMenu.copy'),
      key: 'copy',
      icon: () => h(NIcon, null, { default: () => h(CopyOutline) }),
    })
    items.push({
      label: t('contextMenu.copyRelativePath'),
      key: 'copyRelativePath',
      icon: () => h(NIcon, null, { default: () => h(LinkOutline) }),
    })
    items.push({
      label: t('contextMenu.copyAbsolutePath'),
      key: 'copyAbsolutePath',
      icon: () => h(NIcon, null, { default: () => h(LinkOutline) }),
    })
    items.push({ type: 'divider', key: 'd4' } as DropdownDividerOption)
  }

  if ((isFolder || isRoot) && props.clipboard) {
    items.push({
      label: t('contextMenu.paste'),
      key: 'paste',
      icon: () => h(NIcon, null, { default: () => h(ClipboardOutline) }),
    })
    items.push({ type: 'divider', key: 'd5' } as DropdownDividerOption)
  }

  if (!isRoot) {
    items.push({
      label: t('contextMenu.rename'),
      key: 'rename',
      icon: () => h(NIcon, null, { default: () => h(CreateOutline) }),
    })
    items.push({
      label: t('contextMenu.delete'),
      key: 'delete',
      icon: () => h(NIcon, null, { default: () => h(TrashOutline) }),
    })
  }

  if (isRoot) {
    items.push({
      label: t('contextMenu.refresh'),
      key: 'refresh',
      icon: () => h(NIcon, null, { default: () => h(RefreshOutline) }),
    })
  }

  return items
})

function handleSelect(key: string) {
  if (props.payload) {
    emit('select', key, props.payload)
  }
}

const { t } = useI18n()
</script>

<style scoped>
.dropdown-anchor {
  position: fixed;
  width: 0;
  height: 0;
  pointer-events: none;
}
</style>
