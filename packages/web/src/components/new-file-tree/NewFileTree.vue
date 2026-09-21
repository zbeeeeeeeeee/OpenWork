<template>
  <div class="new-file-tree" @contextmenu.prevent="handleRootContextMenu">
    <n-spin :show="loading" size="small" class="tree-spin">
      <n-empty
        v-if="nodes.length === 0 && !loading"
        :description="t('fileTree.noFiles')"
        size="small"
      />
      <n-tree
        v-else
        ref="treeRef"
        expand-on-click
        :data="treeData"
        :expanded-keys="expandedKeysList"
        :node-props="nodeProps"
        :render-label="renderLabel"
        :render-prefix="renderPrefix"

        :on-update:expanded-keys="handleExpandedKeysChange"
        class="tree-view"
      />
    </n-spin>

    <NewFileTreeMenu
      :show="showMenu"
      :x="menuX"
      :y="menuY"
      :payload="menuPayload"
      :clipboard="clipboard"
      @close="showMenu = false"
      @select="handleMenuSelect"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, h } from 'vue'
import { useI18n } from 'vue-i18n'
import { NTree, NSpin, NEmpty, NInput, NIcon, NText } from 'naive-ui'
import type { TreeOption } from 'naive-ui'
import {
  FolderOutline,
  FolderOpenOutline,
  DocumentOutline,
} from '@vicons/ionicons5'
import type { WorkspaceMode } from '../../stores/editor'
import NewFileTreeMenu from './NewFileTreeMenu.vue'
import type { ClipboardData, ContextMenuPayload } from './types'

interface FileNode {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  modifiedAt?: number
}

const props = defineProps<{
  nodes: FileNode[]
  workspaceRoot: string
  workspaceMode?: WorkspaceMode
  loading?: boolean
  expandedDirs: Set<string>
  loadingDirs: Set<string>
  dirChildren: Record<string, FileNode[]>
  renamingPath?: string | null
  creatingInDir?: { path: string; type: 'file' | 'folder' } | null
  creatingNodeKey?: number
  clipboard?: ClipboardData | null
}>()

const emit = defineEmits<{
  'select-file': [path: string]
  'expand-dir': [path: string]
  'confirm-rename': [oldPath: string, newName: string]
  'confirm-create': [parentPath: string, name: string, type: 'file' | 'folder']
  'cancel-create': []
  'menu-action': [action: string, payload: ContextMenuPayload]
}>()

const { t } = useI18n()
const treeRef = ref<InstanceType<typeof NTree> | null>(null)

const expandedKeysList = computed(() => [...props.expandedDirs])

const creatingType = computed(() => props.creatingInDir?.type || 'file')

const createInputValue = ref('')
const renameInputValue = ref('')
let createInputBlurTimer: ReturnType<typeof setTimeout> | null = null
let renameInputBlurTimer: ReturnType<typeof setTimeout> | null = null

watch(() => props.creatingInDir, (val) => {
  if (val) {
    createInputValue.value = ''
    nextTick(() => {
      const expanded = [...props.expandedDirs]
      if (val.path && !expanded.includes(val.path)) {
        expanded.push(val.path)
        emit('expand-dir', val.path)
      }
    })
  }
})

watch(() => props.renamingPath, (val) => {
  if (val) {
    const name = val.replace(/^.*[/\\]/, '')
    renameInputValue.value = name
  }
})

function buildTreeOptions(nodes: FileNode[]): TreeOption[] {
  return nodes.map((node) => {
    const opt: TreeOption = {
      key: node.path,
      label: node.name,
    }

    if (node.isDirectory) {
      const children = props.dirChildren[node.path]
      if (children && children.length > 0) {
        opt.children = buildTreeOptions(children)
      } else {
        opt.children = []
      }

      if (props.creatingInDir && props.creatingInDir.path === node.path) {
        const existing = (opt.children as TreeOption[]) || []
        opt.children = [
          ...existing,
          {
            key: `__create_${props.creatingNodeKey || 0}__${node.path}`,
            label: '',
            isLeaf: true,
          },
        ]
      }
    } else {
      opt.isLeaf = true
    }

    return opt
  })
}

const treeData = computed<TreeOption[]>(() => {
  const data = buildTreeOptions(props.nodes)

  if (props.creatingInDir && props.creatingInDir.path === '') {
    data.push({
      key: `__create_root_${props.creatingNodeKey || 0}__`,
      label: '',
      isLeaf: true,
    })
  }

  return data
})

function renderPrefix({ option }: { option: TreeOption }) {
  const key = option.key as string
  if (key.startsWith('__create_')) {
    return h(NIcon, null, {
      default: () =>
        h(creatingType.value === 'folder' ? FolderOutline : DocumentOutline),
    })
  }

  const isDir = !option.isLeaf
  if (!isDir) {
    return h(NIcon, { size: 16 }, { default: () => h(DocumentOutline) })
  }

  const isExpanded = props.expandedDirs.has(key)
  return h(NIcon, { size: 16 }, {
    default: () => h(isExpanded ? FolderOpenOutline : FolderOutline),
  })
}


function renderLabel({ option }: { option: TreeOption }) {
  const key = option.key as string

  if (key.startsWith('__create_')) {
    return h(
      'div',
      { class: 'tree-inline-input-wrapper', onClick: (e: Event) => e.stopPropagation() },
      [
        h(NInput, {
          size: 'tiny',
          autofocus: true,
          value: createInputValue.value,
          placeholder:
            creatingType.value === 'folder'
              ? t('fileTree.newFolderPrompt')
              : t('fileTree.newFilePrompt'),
          'onUpdate:value': (v: string) => {
            createInputValue.value = v
          },
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') handleCreateConfirm()
            if (e.key === 'Escape') {
              createInputValue.value = ''
              emit('cancel-create')
            }
          },
          onBlur: () => {
            if (createInputBlurTimer) clearTimeout(createInputBlurTimer)
            createInputBlurTimer = setTimeout(() => {
              if (props.creatingInDir) {
                handleCreateConfirm()
              }
            }, 100)
          },
        }),
      ],
    )
  }

  if (props.renamingPath === key) {
    return h(
      'div',
      { class: 'tree-inline-input-wrapper', onClick: (e: Event) => e.stopPropagation() },
      [
        h(NInput, {
          size: 'tiny',
          autofocus: true,
          value: renameInputValue.value,
          'onUpdate:value': (v: string) => {
            renameInputValue.value = v
          },
          onKeydown: (e: KeyboardEvent) => {
            if (e.key === 'Enter') handleRenameConfirm()
            if (e.key === 'Escape') handleRenameCancel()
          },
          onBlur: () => {
            if (renameInputBlurTimer) clearTimeout(renameInputBlurTimer)
            renameInputBlurTimer = setTimeout(() => {
              if (props.renamingPath) {
                handleRenameConfirm()
              }
            }, 100)
          },
        }),
      ],
    )
  }

  return h(
    NText,
    { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
    { default: () => option.label as string },
  )
}

function nodeProps({ option }: { option: TreeOption }) {
  const key = option.key as string
  if (key.startsWith('__create_')) return { style: { cursor: 'default' } }

  return {
    onClick() {
      if (option.isLeaf) {
        emit('select-file', key)
      }
    },
    onContextmenu(e: MouseEvent) {
      e.preventDefault()
      e.stopPropagation()
      menuX.value = e.clientX
      menuY.value = e.clientY
      menuPayload.value = {
        type: option.isLeaf ? 'file' : 'folder',
        path: key,
        name: option.label as string,
      }
      showMenu.value = true
    },
  }
}

function handleExpandedKeysChange(
  keys: Array<string | number>,
  _option: Array<TreeOption | null>,
  meta: { node: TreeOption | null; action: 'expand' | 'collapse' | 'filter' },
) {
  if (!meta.node) return
  const key = meta.node.key as string
  if (key.startsWith('__create_')) return

  if (meta.action === 'expand' || meta.action === 'collapse') {
    emit('expand-dir', key)
  }
}

function handleCreateConfirm() {
  const name = createInputValue.value.trim()
  createInputValue.value = ''
  if (name && props.creatingInDir) {
    emit('confirm-create', props.creatingInDir.path, name, creatingType.value)
  } else {
    emit('cancel-create')
  }
}

function handleRenameConfirm() {
  const newName = renameInputValue.value.trim()
  const oldPath = props.renamingPath
  renameInputValue.value = ''
  if (oldPath && newName) {
    emit('confirm-rename', oldPath, newName)
  } else if (oldPath) {
    const originalName = oldPath.replace(/^.*[/\\]/, '')
    emit('confirm-rename', oldPath, originalName)
  }
}

function handleRenameCancel() {
  renameInputValue.value = ''
  if (props.renamingPath) {
    const originalName = props.renamingPath.replace(/^.*[/\\]/, '')
    emit('confirm-rename', props.renamingPath, originalName)
  }
}

// Context menu
const showMenu = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuPayload = ref<ContextMenuPayload | null>(null)

function handleRootContextMenu(e: MouseEvent) {
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuPayload.value = { type: 'root', path: '', name: '' }
  showMenu.value = true
}

function handleMenuSelect(key: string, payload: ContextMenuPayload) {
  showMenu.value = false
  emit('menu-action', key, payload)
}
</script>

<style scoped>
.new-file-tree {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.tree-spin {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-1) var(--space-1) var(--space-2);
}

.tree-spin :deep(.n-spin-content) {
  height: 100%;
}

.tree-view {
  height: 100%;
}

:deep(.n-tree) {
  background: transparent;
  --n-font-size: var(--font-base);
  --n-node-wrapper-padding: 1px 0;
  --n-node-border-radius: var(--radius-sm);
  --n-node-color-hover: var(--surface-hover);
  --n-node-color-pressed: var(--surface-selected);
  --n-node-color-active: var(--surface-selected);
  --n-node-text-color: var(--text-secondary);
  --n-node-text-color-disabled: var(--text-disabled);
  --n-node-arrow-color: var(--text-muted);
  --n-line-color: var(--border-subtle);
}

:deep(.n-tree-node-content) {
  flex: 1;
  min-width: 0;
}

:deep(.n-tree-node--selected .n-tree-node-content) {
  color: var(--text-primary);
}

.tree-inline-input-wrapper {
  flex: 1;
  min-width: 0;
  padding-right: var(--space-1);
}

.tree-inline-input-wrapper :deep(.n-input) {
  --n-height: 24px;
  --n-font-size: var(--font-base);
  --n-border-radius: var(--radius-sm);
}

.tree-delete-btn {
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s;
  margin-left: auto;
  flex-shrink: 0;
}

:deep(.n-tree-node-content):hover .tree-delete-btn {
  opacity: 1;
  visibility: visible;
}
</style>
