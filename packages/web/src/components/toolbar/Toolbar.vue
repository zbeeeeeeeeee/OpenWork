<template>
  <div class="toolbar" @dblclick="handleToolbarDblClick">
    <div class="toolbar-left">
      <n-button
        v-if="!isSingleFile"
        quaternary
        size="small"
        :title="sidebarCollapsed ? $t('toolbar.showSidebar') : $t('toolbar.hideSidebar')"
        @click="$emit('toggle-sidebar')"
      >
        <template #icon><n-icon :component="MenuOutline" /></template>
      </n-button>
      <n-dropdown trigger="hover" :options="fileOptions" @select="handleFileSelect">
        <n-button quaternary size="small" class="dropdown-trigger-btn">
          {{ $t('toolbar.file') }}
          <n-icon size="10" :component="ChevronDown" />
        </n-button>
      </n-dropdown>
      <n-dropdown trigger="hover" :options="viewOptions" @select="handleViewSelect">
        <n-button quaternary size="small" class="dropdown-trigger-btn">
          {{ $t('toolbar.view') }}
          <n-icon size="10" :component="ChevronDown" />
        </n-button>
      </n-dropdown>
      <n-dropdown trigger="hover" :options="editOptions" @select="handleEditSelect">
        <n-button quaternary size="small" class="dropdown-trigger-btn">
          {{ $t('toolbar.edit') }}
          <n-icon size="10" :component="ChevronDown" />
        </n-button>
      </n-dropdown>
      <n-dropdown trigger="hover" :options="helpOptions" @select="handleHelpSelect">
        <n-button quaternary size="small" class="dropdown-trigger-btn">
          {{ $t('toolbar.help') }}
          <n-icon size="10" :component="ChevronDown" />
        </n-button>
      </n-dropdown>
    </div>
    <div class="toolbar-center">
      <span v-if="isSingleFile && activeTabName" class="toolbar-title">{{ activeTabName }}</span>
      <span v-else class="toolbar-title">{{ $t('toolbar.appName') }}</span>
    </div>
    <div class="toolbar-right">
      <n-button
        quaternary
        size="small"
        :title="$t('toolbar.settings')"
        @click="$emit('open-settings')"
      >
        <template #icon><n-icon size="18" :component="SettingsOutline" /></template>
      </n-button>
      <div v-if="env === 'electron'" class="window-controls">
        <button class="win-btn win-minimize" title="Minimize" @click="handleMinimize">
          <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4" width="10" height="1" fill="currentColor"/></svg>
        </button>
        <button class="win-btn win-maximize" :title="isMaximized ? 'Restore' : 'Maximize'" @click="handleToggleMaximize">
          <svg v-if="isMaximized" width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="2" width="7" height="6" fill="none" stroke="currentColor" stroke-width="1"/>
            <rect x="3" y="0" width="7" height="6" fill="var(--bg-tertiary)" stroke="currentColor" stroke-width="1"/>
          </svg>
          <svg v-else width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1"/>
          </svg>
        </button>
        <button class="win-btn win-close" title="Close" @click="handleClose">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" stroke-width="1.2"/>
            <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" stroke-width="1.2"/>
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NButton, NIcon, NDropdown } from 'naive-ui'
import {
  MenuOutline,
  ChevronDown,
  SettingsOutline,
  DocumentOutline,
  FolderOutline,
  FolderOpenOutline,
  DocumentAttachOutline,
  SaveOutline,
  FileTrayFullOutline,
  SearchOutline,
  CutOutline,
  CopyOutline,
  ClipboardOutline,
  ArrowUndoOutline,
  ArrowRedoOutline,
  SwapHorizontalOutline,
  InformationCircleOutline,
} from '@vicons/ionicons5'
import { useEditorStore, type WorkspaceMode } from '../../stores/editor'

const store = useEditorStore()

const props = defineProps<{
  env: string
  workspaceMode: WorkspaceMode
  sidebarCollapsed?: boolean
  isSingleFile?: boolean
}>()

const emit = defineEmits<{
  'open-folder': []
  'open-file': []
  'save': []
  'new-file': []
  'new-folder': []
  'toggle-sidebar': []
  'show-explorer': []
  'show-search': []
  'open-settings': []
  'edit-cut': []
  'edit-copy': []
  'edit-paste': []
  'edit-undo': []
  'edit-redo': []
  'edit-find': []
  'edit-replace': []
  'show-about': []
}>()

const { t } = useI18n()

/** Naive UI 下拉菜单选项的图标渲染辅助函数 */
function dropdownIcon(icon: any) {
  return () => h(NIcon, null, { default: () => h(icon) })
}

const activeTabName = computed(() => store.activeTab?.name || '')

const fileOptions = computed(() => {
  if (props.isSingleFile) {
    return [
      { label: t('toolbar.openFolder'), key: 'open-folder', icon: dropdownIcon(FolderOpenOutline) },
      { label: t('toolbar.openFile'), key: 'open-file', icon: dropdownIcon(DocumentAttachOutline) },
      { type: 'divider' as const },
      { label: t('toolbar.save'), key: 'save', icon: dropdownIcon(SaveOutline) },
    ]
  }
  return [
    { label: t('toolbar.newFile'), key: 'new-file', icon: dropdownIcon(DocumentOutline) },
    { label: t('toolbar.newFolder'), key: 'new-folder', icon: dropdownIcon(FolderOutline) },
    { type: 'divider' as const },
    { label: t('toolbar.openFolder'), key: 'open-folder', icon: dropdownIcon(FolderOpenOutline) },
    { label: t('toolbar.openFile'), key: 'open-file', icon: dropdownIcon(DocumentAttachOutline) },
    { type: 'divider' as const },
    { label: t('toolbar.save'), key: 'save', icon: dropdownIcon(SaveOutline) },
  ]
})

const viewOptions = computed(() => [
  { label: t('toolbar.explorer'), key: 'show-explorer', icon: dropdownIcon(FileTrayFullOutline) },
  { label: t('toolbar.search'), key: 'show-search', icon: dropdownIcon(SearchOutline) },
])

const editOptions = computed(() => [
  { label: t('toolbar.cut'), key: 'edit-cut', icon: dropdownIcon(CutOutline) },
  { label: t('toolbar.copy'), key: 'edit-copy', icon: dropdownIcon(CopyOutline) },
  { label: t('toolbar.paste'), key: 'edit-paste', icon: dropdownIcon(ClipboardOutline) },
  { type: 'divider' as const },
  { label: t('toolbar.undo'), key: 'edit-undo', icon: dropdownIcon(ArrowUndoOutline) },
  { label: t('toolbar.redo'), key: 'edit-redo', icon: dropdownIcon(ArrowRedoOutline) },
  { type: 'divider' as const },
  { label: t('toolbar.find'), key: 'edit-find', icon: dropdownIcon(SearchOutline) },
  { label: t('toolbar.replace'), key: 'edit-replace', icon: dropdownIcon(SwapHorizontalOutline) },
])

const helpOptions = computed(() => [
  { label: t('about.title'), key: 'show-about', icon: dropdownIcon(InformationCircleOutline) },
])

function handleFileSelect(key: string) {
  emit(key as any)
}
function handleViewSelect(key: string) {
  emit(key as any)
}
function handleEditSelect(key: string) {
  emit(key as any)
}
function handleHelpSelect(key: string) {
  emit(key as any)
}

const isMaximized = ref(false)

onMounted(async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.isMaximized()
    window.electronAPI.onMaximizeChange((max: boolean) => {
      isMaximized.value = max
    })
  }
})

function handleMinimize() {
  window.electronAPI?.minimizeWindow()
}

async function handleToggleMaximize() {
  const api = window.electronAPI
  if (!api) return
  if (await api.isMaximized()) {
    api.unmaximizeWindow()
  } else {
    api.maximizeWindow()
  }
}

function handleClose() {
  window.electronAPI?.closeWindow()
}

function handleToolbarDblClick() {
  if (window.electronAPI) {
    handleToggleMaximize()
  }
}
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
  padding: 0 var(--space-2);
  flex-shrink: 0;
  user-select: none;
  -webkit-app-region: drag;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 100%;
  -webkit-app-region: no-drag;
}

.toolbar-right {
  display: flex;
  align-items: center;
  height: 100%;
  -webkit-app-region: no-drag;
}

.toolbar-center {
  display: flex;
  align-items: center;
  height: 100%;
}

.toolbar-title {
  color: var(--text-muted);
  font-size: var(--font-sm);
  font-weight: var(--weight-medium);
  letter-spacing: 0.2px;
}

.toolbar :deep(.n-button) {
  height: 24px;
  padding: 0 var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: background var(--transition-fast), color var(--transition-fast);
}

.toolbar :deep(.n-button:hover) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.toolbar :deep(.n-button:active) {
  background: var(--surface-selected);
  color: var(--text-primary);
}

.dropdown-trigger-btn {
  font-size: var(--font-sm);
}

.window-controls {
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: var(--space-1);
}

.win-btn {
  width: 40px;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0;
  -webkit-app-region: no-drag;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.win-btn:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.win-close:hover {
  background: #e81123;
  color: #fff;
}
</style>
