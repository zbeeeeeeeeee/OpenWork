<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    class="folder-picker-modal"
    style="width: 720px; height: 540px; max-width: calc(100vw - 48px); min-width: 560px; max-height: 80vh; min-height: 0;"
    @after-leave="$emit('cancel')"
  >
    <template #header>
      <div class="picker-header">
        <div class="picker-title">{{ $t('openDialog.selectFile') }}</div>
        <div class="picker-subtitle">{{ $t('openDialog.selectFileSubtitle') }}</div>
      </div>
    </template>

    <div class="file-picker">
      <div v-if="selectedPath" class="selected-file">
        <span>{{ $t('openDialog.selectedFile') }}</span>
        <strong>{{ selectedName }}</strong>
      </div>

      <div class="browser-surface">
        <div class="column">
          <div class="column-header">
            <span class="column-title">{{ selectedDirName }}</span>
            <span class="column-subtitle">{{ $t('openDialog.currentDirectoryLabel') }}</span>
          </div>
          <div ref="listRef" class="column-list">
            <n-spin v-if="loadingRoots" size="small" class="column-state" />
            <template v-else>
              <button
                v-for="node in flatTree"
                :key="node.path"
                class="file-row"
                :class="{
                  selected: selectedPath === node.path && !node.isDirectory,
                  'dir-selected': selectedDir === node.path && node.isDirectory,
                }"
                :style="{ paddingLeft: node.depth * 16 + 12 + 'px' }"
                @click="handleClick(node)"
              >
                <span v-if="node.isDirectory" class="entry-arrow" :class="{ expanded: node.expanded }">
                  {{ node.expanded ? '▾' : '▸' }}
                </span>
                <span v-else class="entry-arrow"></span>
                <n-icon size="16" :component="node.isDirectory ? (node.expanded ? FolderOpenOutline : FolderOutline) : DocumentOutline" />
                <span class="entry-name">{{ node.name }}</span>
              </button>
              <div v-if="!loadingRoots && flatTree.length === 0" class="column-state">
                {{ $t('openDialog.empty') }}
              </div>
            </template>
          </div>
        </div>
      </div>

      <div class="picker-footer">
        <div class="footer-actions">
          <button class="footer-btn" :disabled="!selectedDir" @click="startNewFolder">
            <n-icon size="14" :component="CreateOutline" />
            <span>{{ $t('openDialog.newFolder') }}</span>
          </button>
          <button class="footer-btn" :disabled="!selectedDir" @click="goToParent">
            <n-icon size="14" :component="ArrowUpOutline" />
            <span>{{ $t('openDialog.goParent') }}</span>
          </button>
        </div>
        <div class="footer-decisions">
          <button class="btn-cancel" @click="$emit('cancel')">{{ $t('openDialog.cancel') }}</button>
          <button class="btn-open" :disabled="!selectedPath" @click="confirm">{{ $t('openDialog.open') }}</button>
        </div>
      </div>
    </div>

    <n-modal
      v-model:show="showNewFolderDialog"
      preset="card"
      :title="$t('openDialog.newFolderTitle')"
      style="width: 400px"
    >
      <n-text depth="3">{{ $t('openDialog.selected') }}: {{ creatingParent }}</n-text>
      <n-input
        ref="nfInput"
        v-model:value="newFolderName"
        :placeholder="$t('openDialog.folderName')"
        :status="newFolderError ? 'error' : undefined"
        @keyup.enter="confirmNewFolder"
        @keyup.escape="cancelNewFolder"
        @input="newFolderError = ''"
      />
      <div v-if="newFolderError" class="nf-error">{{ newFolderError }}</div>
      <template #footer>
        <n-button @click="cancelNewFolder">{{ $t('openDialog.cancel') }}</n-button>
        <n-button type="primary" :disabled="!newFolderName.trim()" @click="confirmNewFolder">
          {{ $t('openDialog.create') }}
        </n-button>
      </template>
    </n-modal>
  </n-modal>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { NModal, NButton, NInput, NIcon, NSpin, NText } from 'naive-ui'
import { CreateOutline, ArrowUpOutline, FolderOutline, FolderOpenOutline, DocumentOutline } from '@vicons/ionicons5'
import { createFileServiceClient } from '../../services/fileService'

const { t } = useI18n()

const emit = defineEmits<{
  confirm: [filePath: string]
  cancel: []
}>()

const client = createFileServiceClient();

interface TreeNode {
  name: string; path: string; isDirectory: boolean
  depth: number; expanded: boolean; loaded: boolean; loading: boolean
  parent: string | null
}

const showModal = ref(true)
const nodes = ref<TreeNode[]>([])
const selectedPath = ref('')
const selectedDir = ref('')
const loadingRoots = ref(false)
const listRef = ref<HTMLElement>()

const showNewFolderDialog = ref(false)
const newFolderName = ref('')
const newFolderError = ref('')
const creatingParent = ref('')
const nfInput = ref<{ focus: () => void }>()

const selectedName = computed(() => selectedPath.value.split('/').pop() || selectedPath.value.split('\\').pop() || '')

const selectedDirName = computed(() => {
  if (!selectedDir.value) return t('openDialog.thisComputer')
  const parts = selectedDir.value.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || selectedDir.value
})

const flatTree = computed(() => {
  const result: TreeNode[] = []
  function walk(list: TreeNode[]) {
    for (const n of list) {
      result.push(n)
      if (n.expanded && n.loaded) {
        const children = nodes.value.filter(c => c.parent === n.path)
        walk(children)
      }
    }
  }
  walk(nodes.value.filter(n => n.parent === null))
  return result
})

function getParentPath(targetPath: string): string | null {
  const node = nodes.value.find(n => n.path === targetPath)
  return node?.parent || null
}

async function handleClick(node: TreeNode) {
  if (node.isDirectory) {
    selectedDir.value = node.path
    if (node.expanded) { node.expanded = false; return }
    node.expanded = true
    if (!node.loaded) {
      node.loading = true
      try {
        const data = await client.browseFilesystem(node.path)
        const entries = data.entries
        entries.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        for (const entry of entries) {
          nodes.value.push({
            name: entry.name, path: entry.path, isDirectory: entry.isDirectory,
            depth: node.depth + 1, expanded: false, loaded: false,
            loading: false, parent: node.path,
          })
        }
        node.loaded = true
      } catch { /* ignore */ }
      node.loading = false
    }
  } else {
    selectedPath.value = node.path
  }
}

function goToParent() {
  const parent = getParentPath(selectedDir.value)
  if (parent) selectedDir.value = parent
}

const INVALID_CHARS = /[<>:"/\\|?*]/

function startNewFolder() {
  const targetNode = nodes.value.find(n => n.path === selectedDir.value && n.isDirectory)
  if (!targetNode) return
  creatingParent.value = targetNode.path
  newFolderName.value = ''
  newFolderError.value = ''
  showNewFolderDialog.value = true
  nextTick(() => nfInput.value?.focus())
}

async function confirmNewFolder() {
  const name = newFolderName.value.trim()
  if (!name) { newFolderError.value = t('openDialog.emptyFolderName'); return }
  if (INVALID_CHARS.test(name)) { newFolderError.value = t('openDialog.invalidFolderName'); return }

  try {
    if (!client.createDirectory) throw new Error(t('openDialog.newFolderError'));
    await client.createDirectory(creatingParent.value, name)
    const parentNode = nodes.value.find(n => n.path === creatingParent.value)
    if (parentNode) { removeChildren(parentNode.path); parentNode.loaded = false; parentNode.expanded = false; await handleClick(parentNode) }
    showNewFolderDialog.value = false
    await nextTick()
    scrollToSelected()
  } catch (e: any) {
    newFolderError.value = e.message || t('openDialog.newFolderError')
  }
}

function cancelNewFolder() {
  showNewFolderDialog.value = false
  newFolderName.value = ''
  newFolderError.value = ''
}

function scrollToSelected() {
  const el = listRef.value?.querySelector('.file-row.dir-selected') as HTMLElement | null
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function removeChildren(parentPath: string) {
  const toRemove = new Set<string>()
  function collect(p: string) {
    const children = nodes.value.filter(n => n.parent === p)
    for (const c of children) { toRemove.add(c.path); collect(c.path) }
  }
  collect(parentPath)
  nodes.value = nodes.value.filter(n => !toRemove.has(n.path))
}

async function loadRoots() {
  loadingRoots.value = true
  try {
    const data = await client.getWorkspaceRoots()
    const roots: TreeNode[] = []
    for (const root of data) {
      roots.push({ name: root.path === '/' ? '/' : root.path, path: root.path, isDirectory: true, depth: 0, expanded: false, loaded: false, loading: false, parent: null })
    }
    nodes.value = roots
    if (roots.length === 1) handleClick(roots[0])
  } catch { /* ignore */ }
  loadingRoots.value = false
}

function confirm() {
  if (selectedPath.value) emit('confirm', selectedPath.value)
}

onMounted(() => { loadRoots() })
</script>

<style scoped>
.file-picker {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.picker-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.picker-title {
  font-size: 17px;
  font-weight: var(--weight-semibold);
  color: var(--text-primary);
  line-height: 1.3;
}

.picker-subtitle {
  font-size: var(--font-sm);
  color: var(--text-muted);
  line-height: 1.4;
}

.selected-file {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  font-size: var(--font-sm);
  color: var(--text-secondary);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  background: var(--surface-1);
}

.selected-file strong {
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}

.browser-surface {
  flex: 1;
  min-height: 0;
  display: flex;
  background: var(--surface-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.column {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.column-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-subtle);
  flex-shrink: 0;
  min-width: 0;
}

.column-title {
  font-size: var(--font-sm);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-subtitle {
  font-size: var(--font-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-2) var(--space-1);
}

.file-row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 36px;
  padding-top: 0;
  padding-bottom: 0;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-base);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.file-row:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.file-row.selected {
  background: var(--surface-selected);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
  box-shadow: inset 2px 0 0 var(--text-primary);
}

.file-row.dir-selected {
  background: var(--surface-selected);
  color: var(--text-primary);
}

.entry-arrow {
  width: 14px;
  font-size: 11px;
  color: var(--text-muted);
  flex-shrink: 0;
  text-align: center;
}

.entry-name {
  flex: 1;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.column-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 120px;
  font-size: var(--font-sm);
  color: var(--text-muted);
}

.picker-footer {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.footer-decisions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.footer-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast);
}

.footer-btn:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.footer-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.btn-cancel,
.btn-open {
  height: 32px;
  padding: 0 var(--space-3);
  border: none;
  font-size: var(--font-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-fast), color var(--transition-fast), opacity var(--transition-fast);
}

.btn-cancel {
  background: transparent;
  color: var(--text-secondary);
}

.btn-cancel:hover {
  background: var(--surface-hover);
  color: var(--text-primary);
}

.btn-open {
  background: var(--text-primary);
  color: var(--app-bg);
  font-weight: var(--weight-medium);
}

.btn-open:hover:not(:disabled) {
  opacity: 0.86;
}

.btn-open:disabled {
  opacity: 0.4;
  cursor: default;
}

.nf-error {
  color: var(--danger);
  font-size: var(--font-sm);
  margin-top: var(--space-2);
}
</style>
