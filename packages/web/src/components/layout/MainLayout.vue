<template>
  <div
    class="main-layout"
    :class="{ 'drag-over': isDraggingFolder }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <Toolbar
      :env="fs.env"
      :workspace-mode="store.workspaceMode"
      :is-single-file="store.isSingleFile"
      @open-folder="handleOpenFolder"
      @open-file="handleOpenFile"
      @save="fs.saveCurrentFile"
      @new-file="handleNewFileAction"
      @new-folder="handleNewFolderAction"
      @edit-cut="handleEditAction('cut')"
      @edit-copy="handleEditAction('copy')"
      @edit-paste="handleEditAction('paste')"
      @edit-undo="handleEditAction('undo')"
      @edit-redo="handleEditAction('redo')"
      @edit-find="handleEditAction('find')"
      @edit-replace="handleEditAction('replace')"
      @toggle-sidebar="toggleSidebar"
      @show-explorer="handleShowExplorer"
      @show-search="handleShowSearch"
      @open-settings="handleOpenSettings"
      @show-about="showAboutDialog = true"
      :sidebar-collapsed="sidebarCollapsed"
    />
    <div ref="mainContentRef" class="main-content">
      <div v-if="!store.isSingleFile && !sidebarCollapsed" class="sidebar" :style="{ width: sidebarWidth + 'px' }">
        <SideBar
          :title="$t('sidebar.explorer')"
          :sections="sidebarSections"
        >
          <template v-slot:explorer>
            <NewFileTree
              :nodes="store.fileTreeNodes"
              :workspace-root="store.workspaceRoot"
              :workspace-mode="store.workspaceMode"
              :loading="fs.isLoading"
              :expanded-dirs="expandedDirs"
              :loading-dirs="loadingDirs"
              :dir-children="dirChildren"
              :renaming-path="renamingPath"
              :creating-in-dir="creatingInDir"
              :creating-node-key="creatingNodeKey"
              :clipboard="fs.clipboard"
              @select-file="fs.openAndReadFile"
              @expand-dir="handleExpandDir"
              @menu-action="handleNewMenuAction"
              @confirm-rename="handleConfirmRename"
              @confirm-create="handleConfirmCreate"
              @cancel-create="handleCancelCreate"
            />
          </template>
          <template v-slot:git>
            <GitPanel :root="store.workspaceRoot || undefined" @committed="handleGitCommitted" />
          </template>
        </SideBar>
      </div>
      <div v-if="!store.isSingleFile && !sidebarCollapsed" class="resize-handle" @mousedown="startSidebarResize"></div>
      <div class="editor-area">
        <n-tabs
          v-if="!store.isSingleFile"
          v-model:value="activeTabValue"
          type="card"
          closable
          tab-style="min-width: 80px; user-select: none;"
          class="editor-tabs"
          :pane-style="{ padding: 0, height: '0', overflow: 'hidden' }"
          @close="handleTabClose"
        >
          <n-tab-pane
            v-for="tab in store.tabs"
            :key="tab.id"
            :name="tab.id"
            display-directive="show"
          >
            <template #tab>
              <span>{{ tab.name }}</span>
              <span v-if="tab.isDirty" class="tab-dirty-indicator">*</span>
            </template>
          </n-tab-pane>
        </n-tabs>
        <div class="editor-container">
          <ImageViewer
            v-if="store.activeTab && store.activeTab.viewMode === 'image'"
            :src="store.activeTab.content"
            :filename="store.activeTab.name"
          />
          <MonacoEditor
            v-else-if="store.activeTab && store.activeTab.viewMode === 'code'"
            :content="store.activeTab.content"
            :language="store.activeTab.language"
            @content-change="(c: string) => store.updateContent(store.activeTab!.id, c)"
          />
          <DocxViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'docx'"
            :content="store.activeTab.content"
            :file-name="store.activeTab.name"
          />
          <ExcelViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'excel'"
            :content="store.activeTab.content"
            :file-name="store.activeTab.name"
          />
          <PptxViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'pptx'"
            :content="store.activeTab.content"
            :file-name="store.activeTab.name"
          />
          <PdfViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'pdf'"
            :content="store.activeTab.content"
            :file-name="store.activeTab.name"
          />
          <HtmlViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'html'"
            :content="store.activeTab.content"
            :language="store.activeTab.language"
            @content-change="(c: string) => store.updateContent(store.activeTab!.id, c)"
          />
          <MarkdownViewer
            v-else-if="store.activeTab && store.activeTab.viewMode === 'markdown'"
            :content="store.activeTab.content"
            :language="store.activeTab.language"
            @content-change="(c: string) => store.updateContent(store.activeTab!.id, c)"
          />
          <div v-else class="editor-placeholder">
            <div class="placeholder-content">
              <p class="placeholder-title">{{ $t('placeholder.title') }}</p>
              <p class="placeholder-hint">{{ $t('placeholder.hint') }}</p>
              <div v-if="store.fileTreeNodes.length === 0" class="placeholder-actions">
                <n-button size="medium" @click="handleOpenFolder">
                  <template #icon><n-icon :component="FolderOpenOutline" /></template>
                  {{ $t('placeholder.openFolder') }}
                </n-button>
                <n-button
                  size="medium"
                  @click="handleOpenFile"
                >
                  <template #icon><n-icon :component="DocumentOutline" /></template>
                  {{ $t('placeholder.openFile') }}
                </n-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="activeRightPanel" class="right-resize-handle" @mousedown="startRightPanelResize"></div>
      <div v-if="activeRightPanel" class="right-sidebar" :style="{ width: rightPanelWidth + 'px' }">
        <template v-if="activeRightPanel === 'agent'">
          <AgentChatB @open-settings="handleOpenSettings('ai')" />
        </template>
        <McpSettingsPanel v-else-if="activeRightPanel === 'mcp'" />
      </div>
      <RightToolbar
        :items="rightToolbarItems"
        :bottom-items="[]"
        :active-id="activeRightPanel"
        @select="onRightToolbarSelect"
      />
    </div>
    <StatusBar
      :active-tab="store.activeTab"
      :workspace-mode="store.workspaceMode"
    />
    <SaveDialog
      v-if="showSaveDialog"
      :client="fs.client"
      :default-name="saveDialogDefaultName"
      :workspace-root="store.workspaceRoot"
      @confirm="onSaveDialogConfirm"
      @cancel="onSaveDialogCancel"
    />
    <n-modal
      v-model:show="showSaveChoiceDialog"
      preset="card"
      :title="$t('saveChoice.title')"
      style="width: 400px"
      @after-leave="onSaveChoiceCancel"
    >
      <p style="text-align:center;margin-bottom:16px">{{ $t('saveChoice.description') }}</p>
      <template #footer>
        <n-button @click="onSaveChoiceCancel">{{ $t('saveChoice.cancel') }}</n-button>
        <n-button @click="onSaveChoiceLocal">{{ $t('saveChoice.local') }}</n-button>
        <n-button type="primary" @click="onSaveChoiceServer">{{ $t('saveChoice.server') }}</n-button>
      </template>
    </n-modal>
    <NewItemDialog
      v-if="showNewItemDialog"
      :client="fs.client"
      :type="newItemType"
      :default-name="newItemDefaultName"
      :workspace-root="store.workspaceRoot"
      @confirm="onNewItemConfirm"
      @cancel="onNewItemCancel"
    />
    <AboutDialog :visible="showAboutDialog" @close="showAboutDialog = false" />
    <SettingsModal :visible="showSettingsModal" :initial-tab="initialSettingsTab" @close="showSettingsModal = false" />
    <SearchPopup :visible="showSearchPopup" :client="fs.client" @close="showSearchPopup = false" @open-file="handleSearchOpenFile" />
    <n-modal
      v-model:show="showWorkspaceDialog"
      preset="card"
      :title="$t('workspaceDialog.title')"
      style="width: 520px"
      @after-leave="onWorkspaceDialogCancel"
    >
      <n-text depth="3" class="ws-dialog-path">
        {{ $t('workspaceDialog.pathLabel') }}: {{ workspaceDialogPath }}
      </n-text>
      <template #footer>
        <n-button @click="onWorkspaceDialogCancel">{{ $t('workspaceDialog.cancel') }}</n-button>
        <n-button @click="onWorkspaceDialogCurrent">
          {{ fs.env === 'electron' ? $t('workspaceDialog.currentWindow') : $t('workspaceDialog.currentTab') }}
        </n-button>
        <n-button type="primary" @click="onWorkspaceDialogNew">
          {{ fs.env === 'electron' ? $t('workspaceDialog.newWindow') : $t('workspaceDialog.newTab') }}
        </n-button>
      </template>
    </n-modal>
    <OpenFolderDialog
      v-if="showOpenFolderDialog"
      @confirm="onOpenFolderConfirm"
      @cancel="showOpenFolderDialog = false"
    />
    <OpenFileDialog
      v-if="showOpenFileDialog"
      @confirm="onOpenFileConfirm"
      @cancel="showOpenFileDialog = false"
    />
    <div v-if="isDraggingFolder" class="drop-overlay">
      <div class="drop-message">
        <span class="drop-title">{{ $t('dragOverlay.title') }}</span>
        <span class="drop-subtitle">{{ $t('dragOverlay.subtitle') }}</span>
      </div>
    </div>
    <div v-if="fs.showUndoNotification" class="undo-notification">
      <span class="undo-text">{{ $t('undoNotification.deleted') }} {{ fs.lastDeleted?.path }}</span>
      <button class="undo-btn" @click="fs.undoDelete()">{{ $t('undoNotification.undo') }}</button>
      <button class="undo-dismiss" @click="fs.showUndoNotification = false">✕</button>
    </div>
    <template v-if="fs.env === 'electron' && !isMaximized">
      <div class="resize-handle resize-n" @mousedown="startResize('n' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-s" @mousedown="startResize('s' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-e" @mousedown="startResize('e' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-w" @mousedown="startResize('w' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-ne" @mousedown="startResize('ne' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-nw" @mousedown="startResize('nw' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-se" @mousedown="startResize('se' as ResizeEdge, $event)"></div>
      <div class="resize-handle resize-sw" @mousedown="startResize('sw' as ResizeEdge, $event)"></div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted, onUnmounted, nextTick } from 'vue';
import { useI18n } from 'vue-i18n';
import { NTabs, NTabPane, NIcon, NButton, NModal, NText } from 'naive-ui';
import { useEditorStore } from '../../stores/editor';
import { useFileSystem } from '../../composables/useFileSystem';
import { getEditorInstance } from '../../services/editorInstance';
import { useWindowResize } from '../../composables/useWindowResize';
import type { ResizeEdge } from '../../composables/useWindowResize';
import { useFileTreeContextMenu } from '../../composables/useFileTreeContextMenu';
import Toolbar from '../toolbar/Toolbar.vue';
import { webFileLog } from '../../services/logger';
import SideBar from './SideBar.vue';
import type { SideBarSection } from './SideBar.vue';
import GitPanel from '../git/GitPanel.vue';
import { NewFileTree } from '../new-file-tree';
import type { ContextMenuPayload } from '../new-file-tree';
import MonacoEditor from '../editor/MonacoEditor.vue';
import ImageViewer from '../editor/ImageViewer.vue';
import DocxViewer from '../editor/DocxViewer.vue';
import ExcelViewer from '../editor/ExcelViewer.vue';
import PptxViewer from '../editor/PptxViewer.vue';
import PdfViewer from '../editor/PdfViewer.vue';
import HtmlViewer from '../editor/HtmlViewer.vue';
import MarkdownViewer from '../editor/MarkdownViewer.vue';
import { AgentChatB } from '../agent';
import McpSettingsPanel from '../mcp/McpSettingsPanel.vue';
import RightToolbar from './RightToolbar.vue';
import type { RightToolbarItem } from './RightToolbar.vue';
import SaveDialog from '../SaveDialog.vue';
import NewItemDialog from '../NewItemDialog.vue';
import StatusBar from '../StatusBar.vue';
import AboutDialog from './AboutDialog.vue';
import SettingsModal from '../settings/SettingsModal.vue';
import SearchPopup from '../SearchPopup.vue';
import OpenFolderDialog from '../dialogs/OpenFolderDialog.vue';
import OpenFileDialog from '../dialogs/OpenFileDialog.vue';
import { DocumentOutline, FolderOpenOutline } from '@vicons/ionicons5'
import { ChatbubblesOutline, HardwareChipOutline } from '@vicons/ionicons5'

const store = useEditorStore();
const fs = reactive(useFileSystem());
const { t } = useI18n();

// ===== 布局状态 =====
const mainContentRef = ref<HTMLElement | null>(null);
const activeRightPanel = ref<string | null>('agent');
const sidebarWidth = ref(260);
const sidebarCollapsed = ref(false);
const sidebarSavedWidth = ref(260);
const rightPanelWidth = ref(0);
const MIN_EDITOR_WIDTH = 240;
const isDraggingFolder = ref(false);
// Drag events fire as the cursor moves across child elements, so count depth.
let dragDepth = 0;
const showSettingsModal = ref(false);
const showSearchPopup = ref(false);
const initialSettingsTab = ref('general');

const { renamingPath, creatingInDir, creatingNodeKey, handleConfirmRename, handleConfirmCreate, handleCancelCreate } = useFileTreeContextMenu(fs, store, t, { clearDirState, handleExpandDir });

const activeTabValue = computed<string | undefined>({
  get: () => store.activeTabId ?? undefined,
  set: (val) => { if (val) store.setActiveTab(val); },
});
function handleTabClose(name: string) {
  store.closeTab(name);
}

function handleNewMenuAction(action: string, payload: ContextMenuPayload) {
  switch (action) {
    case 'open':
      fs.openAndReadFile(payload.path);
      break;
    case 'newFile':
      creatingInDir.value = { path: payload.path || '', type: 'file' };
      creatingNodeKey.value++;
      break;
    case 'newFolder':
      creatingInDir.value = { path: payload.path || '', type: 'folder' };
      creatingNodeKey.value++;
      break;
    case 'cut':
      fs.cutItem(payload.path, payload.type === 'folder', payload.name);
      break;
    case 'copy':
      fs.copyItem(payload.path, payload.type === 'folder', payload.name);
      break;
    case 'copyRelativePath':
      fs.copyPathToClipboard(payload.path);
      break;
    case 'copyAbsolutePath': {
      const root = store.workspaceRoot;
      const absPath = root && (root.startsWith('/') || /^[A-Z]:[\\/]/i.test(root))
        ? root.replace(/[\\/]?$/, '/') + payload.path
        : payload.path;
      fs.copyPathToClipboard(absPath);
      break;
    }
    case 'paste':
      fs.pasteItem(payload.path || '');
      break;
    case 'rename':
      renamingPath.value = payload.path;
      break;
    case 'delete':
      if (payload.type === 'folder') {
        fs.deleteDir(payload.path);
      } else {
        fs.deleteFile(payload.path);
      }
      break;
    case 'refresh':
      clearDirState();
      fs.loadDirectory('.').then(() => {
        if (store.fileTreeNodes.length > 0 && store.fileTreeNodes[0]?.isDirectory) {
          handleExpandDir(store.fileTreeNodes[0].path);
        }
      });
      break;
  }
}

const isMaximized = ref(false);
const { startResize, isResizing: isWindowResizing } = useWindowResize();

// ===== 侧边栏配置 =====
const sidebarSections = ref<SideBarSection[]>([
  { id: 'explorer', label: t('sidebar.explorer'), count: 0 },
  { id: 'git', label: t('sidebar.git') },
]);

const rightToolbarItems = computed<RightToolbarItem[]>(() => [
  { id: 'agent', label: t('rightToolbar.agent'), icon: ChatbubblesOutline },
  { id: 'mcp', label: t('rightToolbar.mcp'), icon: HardwareChipOutline },
]);

function onRightToolbarSelect(id: string) {
  if (activeRightPanel.value === id) {
    activeRightPanel.value = null;
  } else {
    activeRightPanel.value = id;
    if (!rightPanelWidth.value) initRightPanelWidth();
  }
}

function handleGitCommitted() {
  // Git 提交成功后可刷新文件树等
}

/** 右侧面板最大宽度：主区域宽 - 侧边栏(如果展开) - 调整手柄(4) - 最小编辑器宽 - 右侧工具栏(48) */
function calcRightPanelMax(): number {
  if (!mainContentRef.value) return 800;
  const total = mainContentRef.value.clientWidth;
  const sidebar = sidebarCollapsed.value ? 0 : sidebarWidth.value + 4;
  return total - sidebar - MIN_EDITOR_WIDTH - 48;
}

/** 初始化右侧面板宽度为剩余空间的一半 */
function initRightPanelWidth() {
  if (!mainContentRef.value) {
    rightPanelWidth.value = 350;
    return;
  }
  const total = mainContentRef.value.clientWidth;
  const sidebar = sidebarCollapsed.value ? 0 : sidebarWidth.value + 4;
  const available = total - sidebar - 48;
  rightPanelWidth.value = Math.round(available / 2);
}

onMounted(() => {
  nextTick(() => initRightPanelWidth());
  window.addEventListener('resize', onWindowResize);

  if (bcChannel) {
    bcChannel.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg?.type === 'CHECK' && msg.path) {
        if (currentWorkspacePaths.value.includes(msg.path)) {
          bcChannel.postMessage({ type: 'OPEN', path: msg.path });
        }
      }
    });
    updateWorkspacePaths();
  }
});

function onWindowResize() {
  if (!activeRightPanel.value || !rightPanelWidth.value) return;
  const max = calcRightPanelMax();
  if (rightPanelWidth.value > max) {
    rightPanelWidth.value = max;
  }
}

// ===== 文件树展开/加载状态 =====
const expandedDirs = ref(new Set<string>());
const loadingDirs = ref(new Set<string>());
const dirChildren = ref<Record<string, any[]>>({});
let isResizingSidebar = false;
let isResizingRightPanel = false;

// ===== 另存为对话框状态 =====
const showSaveDialog = ref(false);
const saveDialogDefaultName = ref('');
const showAboutDialog = ref(false);
let saveDialogResolver: ((value: string | null) => void) | null = null;

// ===== 新建文件/文件夹对话框状态 =====
const showNewItemDialog = ref(false);
const newItemType = ref<'file' | 'folder'>('file');
const newItemDefaultName = ref('untitled');
let newItemResolver: ((value: string | null) => void) | null = null;

// ===== 保存方式选择对话框状态（无工作区时） =====
const showSaveChoiceDialog = ref(false);
const saveChoiceFileName = ref('');
const saveChoiceContent = ref('');
let saveChoiceResolver: ((value: string | null) => void) | null = null;

// ===== 工作区打开确认弹窗 =====
const showWorkspaceDialog = ref(false);
const workspaceDialogPath = ref('');
const workspaceDialogIsFile = ref(false);
let workspaceDialogResolver: ((choice: 'new' | 'current' | 'cancel') => void) | null = null;

// ===== 打开文件/文件夹对话框状态 =====
const showOpenFolderDialog = ref(false);
const showOpenFileDialog = ref(false);
let openFolderResolver: ((value: string | null) => void) | null = null;
let openFileResolver: ((value: string | null) => void) | null = null;

// ===== 跨标签页工作区去重 (BroadcastChannel) =====
const bcChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('openwork-workspace-sync') : null;
const currentWorkspacePaths = ref<string[]>([]);
let bcResponseTimer: ReturnType<typeof setTimeout> | null = null;

function normalizePathForDedup(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();
}

function updateWorkspacePaths() {
  currentWorkspacePaths.value = store.workspaceRoots.map(r => normalizePathForDedup(r.path));
  if (bcChannel) {
    bcChannel.postMessage({ type: 'UPDATE', paths: [...currentWorkspacePaths.value] });
  }
}

async function checkWorkspaceDuplicate(path: string): Promise<boolean> {
  if (!bcChannel) return false;
  const normalized = normalizePathForDedup(path);
  if (currentWorkspacePaths.value.includes(normalized)) return true;
  return new Promise((resolve) => {
    let resolved = false;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'OPEN' && event.data.path === normalized) {
        resolved = true;
        resolve(true);
      }
    };
    bcChannel.addEventListener('message', handler);
    bcChannel.postMessage({ type: 'CHECK', path: normalized });
    bcResponseTimer = setTimeout(() => {
      bcChannel.removeEventListener('message', handler);
      if (!resolved) resolve(false);
    }, 300);
  });
}

// ===== Agent 编辑能力说明 =====
// 编辑已下沉为 agent 内建工具(FileWriteTool/FileEditTool),在 agent 循环内直接落盘。
// 此处不再保留 editSnapshots / lastEditedFiles / handleApplyEdits / undoLastEdits:
// 原先基于 <edit> 块的"应用编辑/撤销"链路已彻底移除。

/** 切换侧边栏折叠状态 */
function toggleSidebar() {
  if (sidebarCollapsed.value) {
    sidebarWidth.value = sidebarSavedWidth.value;
    sidebarCollapsed.value = false;
  } else {
    sidebarSavedWidth.value = sidebarWidth.value;
    sidebarWidth.value = 0;
    sidebarCollapsed.value = true;
  }
}

function handleShowExplorer() {
  if (!sidebarCollapsed.value) {
    toggleSidebar();
    return;
  }
  toggleSidebar();
}

function handleShowSearch() {
  showSearchPopup.value = true;
}

function handleOpenSettings(initialTab?: string) {
  initialSettingsTab.value = initialTab || 'general';
  showSettingsModal.value = true;
}

function handleSearchOpenFile(path: string) {
  showSearchPopup.value = false;
  fs.openAndReadFile(path);
}

/** 注册到 useFileSystem 的"另存为"处理器（返回 Promise 等待用户选择路径） */
function handleSaveFileAs(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!store.workspaceRoot) {
      // 无工作区：让用户选择本地下载还是服务器保存
      const tab = store.activeTab;
      saveChoiceFileName.value = tab?.name || 'untitled';
      saveChoiceContent.value = tab?.content || '';
      saveChoiceResolver = resolve;
      showSaveChoiceDialog.value = true;
    } else {
      // 有工作区：直接走 SaveDialog
      saveDialogResolver = resolve;
      saveDialogDefaultName.value = store.activeTab?.name || 'untitled';
      showSaveDialog.value = true;
    }
  });
}

function onSaveDialogConfirm(path: string) {
  showSaveDialog.value = false;
  saveDialogResolver?.(path);
  saveDialogResolver = null;
}

function onSaveDialogCancel() {
  showSaveDialog.value = false;
  saveDialogResolver?.(null);
  saveDialogResolver = null;
}

// ===== 新建文件/文件夹弹窗处理 =====

/** 触发新建文件对话框 */
function handleNewFile(): Promise<string | null> {
  return new Promise((resolve) => {
    newItemResolver = resolve;
    newItemType.value = 'file';
    newItemDefaultName.value = 'untitled';
    showNewItemDialog.value = true;
  });
}

/** 触发新建文件夹对话框 */
function handleNewFolder(): Promise<string | null> {
  return new Promise((resolve) => {
    newItemResolver = resolve;
    newItemType.value = 'folder';
    newItemDefaultName.value = 'new-folder';
    showNewItemDialog.value = true;
  });
}

/** Toolbar 按钮触发的新建文件 */
function handleNewFileAction() {
  handleNewFile();
}

/** Toolbar 按钮触发的新建文件夹 */
function handleNewFolderAction() {
  handleNewFolder();
}

/** 新建对话框确认：创建文件/文件夹并打开/刷新 */
async function onNewItemConfirm(path: string) {
  showNewItemDialog.value = false;
  if (newItemType.value === 'file') {
    try {
      await fs.client.writeFile(path, '');
      store.openFile(path, '');
      handleAfterSave(path);
    } catch (e: any) {
      fs.error = e.message;
    }
  } else {
    try {
      await fs.client.createDir(path);
      handleAfterSave(path);
    } catch (e: any) {
      fs.error = e.message;
    }
  }
  newItemResolver?.(path);
  newItemResolver = null;
}

/** 新建对话框取消 */
function onNewItemCancel() {
  showNewItemDialog.value = false;
  newItemResolver?.(null);
  newItemResolver = null;
}

// ===== 保存方式选择弹窗处理 =====

/** 用户选择"下载到本地" */
function onSaveChoiceLocal() {
  showSaveChoiceDialog.value = false;
  const name = saveChoiceFileName.value;
  const content = saveChoiceContent.value;

  // 触发浏览器下载（纯浏览器 API，不经过后端）
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // 清除脏标记，保持 isUntitled（下次保存仍弹选择框）
  const tab = store.activeTab;
  if (tab) store.saveTab(tab.id);

  // 返回 null → saveCurrentFile 提前 return，不写服务器
  saveChoiceResolver?.(null);
  saveChoiceResolver = null;
}

/** 用户选择"保存到服务器" */
function onSaveChoiceServer() {
  showSaveChoiceDialog.value = false;
  // 切换到 SaveDialog 流程（通过 fs.client.writeFile 写服务器）
  saveDialogResolver = saveChoiceResolver;
  saveDialogDefaultName.value = saveChoiceFileName.value;
  showSaveDialog.value = true;
  saveChoiceResolver = null;
}

/** 用户取消 */
function onSaveChoiceCancel() {
  showSaveChoiceDialog.value = false;
  saveChoiceResolver?.(null);
  saveChoiceResolver = null;
}

function handleOpenFolderDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    openFolderResolver = resolve;
    showOpenFolderDialog.value = true;
  });
}

function handleOpenFileDialog(): Promise<string | null> {
  return new Promise((resolve) => {
    openFileResolver = resolve;
    showOpenFileDialog.value = true;
  });
}

function onOpenFolderConfirm(rootPath: string) {
  showOpenFolderDialog.value = false;
  clearDirState();
  openFolderResolver?.(rootPath);
  openFolderResolver = null;
}

function onOpenFileConfirm(filePath: string) {
  showOpenFileDialog.value = false;
  openFileResolver?.(filePath);
  openFileResolver = null;
}

/** 处理工具栏编辑操作（撤销/重做/查找/替换/剪切/复制/粘贴） */
function handleEditAction(action: string) {
  const editor = getEditorInstance();
  if (!editor) return;
  editor.focus();
  switch (action) {
    case 'undo':
      editor.trigger('keyboard', 'undo', null);
      break;
    case 'redo':
      editor.trigger('keyboard', 'redo', null);
      break;
    case 'find':
      editor.getAction('actions.find')?.run();
      break;
    case 'replace':
      editor.getAction('editor.action.startFindReplaceAction')?.run();
      break;
    case 'cut': {
      const sel = editor.getSelection();
      if (sel && !sel.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          const text = model.getValueInRange(sel);
          navigator.clipboard.writeText(text).then(() => {
            editor.executeEdits('cut', [{ range: sel, text: '' }]);
          }).catch(() => {});
        }
      }
      break;
    }
    case 'copy': {
      const sel = editor.getSelection();
      if (sel && !sel.isEmpty()) {
        const model = editor.getModel();
        if (model) {
          const text = model.getValueInRange(sel);
          navigator.clipboard.writeText(text).catch(() => {});
        }
      }
      break;
    }
    case 'paste': {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          editor.executeEdits('paste', [{ range: editor.getSelection()!, text }]);
        }
      }).catch(() => {});
      break;
    }
  }
}

// 注册回调到 useFileSystem
fs.setSaveAsHandler(handleSaveFileAs);
fs.setOnAfterSave(handleAfterSave);
fs.setOpenFolderDialogHandler(handleOpenFolderDialog);
fs.setOpenFileDialogHandler(handleOpenFileDialog);
fs.setNewFileHandler(handleNewFile);

// 文件树节点数量变化时更新侧边栏计数
watch(() => store.fileTreeNodes.length, (count) => {
  sidebarSections.value = [
    { id: 'explorer', label: t('sidebar.explorer'), count },
    { id: 'git', label: t('sidebar.git') },
  ];
});

// 标签页变化时自动持久化到 .openwork/workspace.json
let persistTimer: ReturnType<typeof setTimeout> | null = null;
watch(
  () => [store.tabs.map(t => ({ path: t.path, isUntitled: t.isUntitled })), store.activeTabId],
  () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => fs.persistWorkspaceState(), 300);
  },
  { deep: true }
);

// 组件卸载时清理持久化定时器,并立即 flush 当前 tab 状态
onUnmounted(() => {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
    fs.persistWorkspaceState();
  }
});

// 工作区根变化时更新跨标签页去重状态
watch(() => store.workspaceRoots, () => {
  updateWorkspacePaths();
}, { deep: true });

/**
 * 文件保存后的回调：刷新所有已展开目录的内容
 *
 * 并行重载根目录和所有已展开的子目录，保持文件树 UI 与磁盘同步。
 */
async function handleAfterSave(_savePath: string) {
  const dirsToReload = ['.', ...expandedDirs.value];
  const results = await Promise.all(
    dirsToReload.map(async (dir) => {
      try {
        const entries = await fs.client.readDir(dir);
        return { dir, entries };
      } catch {
        return { dir, entries: null };
      }
    })
  );

  if (store.workspaceRoots.length > 0) {
    await fs.loadDirectory('.');
  } else {
    const rootResult = results.find(r => r.dir === '.');
    if (rootResult?.entries) {
      store.fileTreeNodes = rootResult.entries;
    }
  }

  const updates: Record<string, any[]> = { ...dirChildren.value };
  for (const { dir, entries } of results) {
    if (entries && dir !== '.') updates[dir] = entries;
  }
  dirChildren.value = updates;
  loadingDirs.value = new Set();
}

/** 清空所有文件树展开/缓存状态 */
function clearDirState() {
  expandedDirs.value = new Set();
  loadingDirs.value = new Set();
  dirChildren.value = {};
}

function hasExistingWorkspace(): boolean {
  return store.workspaceRoots.length > 0;
}

function showWorkspaceConfirmDialog(path: string, isFile: boolean): Promise<'new' | 'current' | 'cancel'> {
  workspaceDialogPath.value = path;
  workspaceDialogIsFile.value = isFile;
  showWorkspaceDialog.value = true;
  return new Promise(resolve => { workspaceDialogResolver = resolve; });
}
function onWorkspaceDialogNew() { showWorkspaceDialog.value = false; workspaceDialogResolver?.('new'); }
function onWorkspaceDialogCurrent() { showWorkspaceDialog.value = false; workspaceDialogResolver?.('current'); }
function onWorkspaceDialogCancel() {
  showWorkspaceDialog.value = false;
  workspaceDialogResolver?.('cancel');
}

async function openFolderInNewContext(existingPath?: string) {
  const path = existingPath || await fs.resolveFolderPath();
  if (!path) return;

  if (fs.env === 'electron') {
    if (window.electronAPI?.createWindow) {
      const result = await window.electronAPI.createWindow(path);
      if (result?.status === 'duplicate') {
        if (window.electronAPI.showNotification) {
          window.electronAPI.showNotification('Workspace Already Open', `"${path}" is already open in another window.`);
        }
      }
    }
  } else {
    if (await checkWorkspaceDuplicate(path)) {
      alert(`Workspace "${path}" is already open in another tab.`);
      return;
    }
    window.open(window.location.origin + '?workspace=' + encodeURIComponent(path), '_blank');
  }
}

async function openFileInNewContext(existingPath?: string) {
  const path = existingPath || await fs.resolveFilePath();
  if (!path) return;

  if (fs.env === 'electron') {
    if (window.electronAPI?.createWindow) {
      const result = await window.electronAPI.createWindow(path, true);
      if (result?.status === 'duplicate') {
        if (window.electronAPI.showNotification) {
          window.electronAPI.showNotification('Workspace Already Open', `"${path}" is already open in another window.`);
        }
      }
    }
  } else {
    if (await checkWorkspaceDuplicate(path)) {
      alert(`Workspace "${path}" is already open in another tab.`);
      return;
    }
    window.open(window.location.origin + '?file=' + encodeURIComponent(path), '_blank');
  }
}

/** 打开文件夹并重置文件树状态 */
async function handleOpenFolder() {
  clearDirState();
  if (hasExistingWorkspace()) {
    const path = await fs.resolveFolderPath();
    if (!path) return;
    const choice = await showWorkspaceConfirmDialog(path, false);
    if (choice === 'new') await openFolderInNewContext(path);
    else if (choice === 'current') await fs.openWorkspaceViaPath(path);
  } else {
    await fs.openFolderDialog();
  }
}

/** 连接到服务端并重置文件树状态 */
async function handleOpenFile() {
  clearDirState();
  if (hasExistingWorkspace()) {
    const path = await fs.resolveFilePath();
    if (!path) return;
    const choice = await showWorkspaceConfirmDialog(path, true);
    if (choice === 'new') await openFileInNewContext(path);
    else if (choice === 'current') await fs.openFileAsLightweightWorkspace(path);
  } else {
    await fs.openFileDialog();
  }
}

function isFileDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes('Files'));
}

function resetDragState() {
  dragDepth = 0;
  isDraggingFolder.value = false;
}

function handleDragEnter(e: DragEvent) {
  if (!isFileDrag(e.dataTransfer)) return;
  e.preventDefault();
  dragDepth += 1;
  isDraggingFolder.value = true;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function handleDragOver(e: DragEvent) {
  if (!isFileDrag(e.dataTransfer)) return;
  e.preventDefault();
  isDraggingFolder.value = true;
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
}

function handleDragLeave(e: DragEvent) {
  if (!isDraggingFolder.value) return;
  e.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) isDraggingFolder.value = false;
}

async function handleDrop(e: DragEvent) {
  if (!isFileDrag(e.dataTransfer)) return;
  e.preventDefault();
  const dataTransfer = e.dataTransfer;
  resetDragState();

  // 提取拖放的第一个路径
  const dropped = Array.from(dataTransfer.files)
    .map(f => (f as File & { path?: string }).path)
    .filter((p): p is string => Boolean(p));
  const firstPath = dropped[0];

  // 已有工作区时弹出确认弹窗，让用户选择在当前窗口还是新窗口打开
  if (firstPath && hasExistingWorkspace()) {
    const choice = await showWorkspaceConfirmDialog(firstPath, false);
    if (choice === 'new') {
      await openFolderInNewContext(firstPath);
      return;
    }
    if (choice === 'cancel') return;
    // choice === 'current' 继续走原有流程
  }

  const opened = await fs.openDroppedFolder(dataTransfer);
  if (!opened) {
    if (fs.error) {
      alert(fs.error);
    }
    return;
  }

  sidebarSections.value = [
    { id: 'explorer', label: t('sidebar.explorer'), count: store.fileTreeNodes.length },
    { id: 'git', label: t('sidebar.git') },
  ];
  if (sidebarCollapsed.value) toggleSidebar();
}

/**
 * 展开/折叠目录（懒加载）
 *
 * 首次展开时异步加载子节点，已加载的直接切换折叠状态。
 */
async function handleExpandDir(dirPath: string) {
  const s = new Set(expandedDirs.value);
  if (s.has(dirPath)) {
    s.delete(dirPath);
    expandedDirs.value = s;
    return;
  }
  s.add(dirPath);
  expandedDirs.value = s;

  loadingDirs.value = new Set([...loadingDirs.value, dirPath]);
  try {
    const entries = await fs.client.readDir(dirPath);
    dirChildren.value = { ...dirChildren.value, [dirPath]: entries };
  } catch { /* 忽略读取失败 */ }
  loadingDirs.value = new Set([...loadingDirs.value].filter(d => d !== dirPath));
}

onMounted(async () => {
  if (window.electronAPI) {
    isMaximized.value = await window.electronAPI.isMaximized();
    window.electronAPI.onMaximizeChange((max: boolean) => {
      isMaximized.value = max;
    });

    window.electronAPI.onMenuAction((action: string) => {
      switch (action) {
        case 'new-file':
          handleNewFileAction();
          break;
        case 'new-folder':
          handleNewFolderAction();
          break;
        case 'open-folder':
          handleOpenFolder();
          break;
        case 'open-file':
        case 'open-local-file':
          handleOpenFile();
          break;
        case 'save':
          fs.saveCurrentFile();
          break;
        case 'edit-cut':
        case 'edit-copy':
        case 'edit-paste':
        case 'edit-undo':
        case 'edit-redo':
        case 'edit-find':
        case 'edit-replace':
          handleEditAction(action.replace('edit-', ''));
          break;
      }
    });
  }

  // URL parameter workspace loading (new tab / new window)
  const urlParams = new URLSearchParams(window.location.search);
  const workspaceParam = urlParams.get('workspace');
  if (workspaceParam) {
    const decodedPath = decodeURIComponent(workspaceParam);
    clearDirState();
    try {
      await fs.openWorkspaceViaPath(decodedPath);
      updateWorkspacePaths();
    } catch (e: any) {
      console.error('[OpenWork] Failed to open workspace via URL param:', e);
      fs.error = `Failed to open workspace: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  const fileParam = urlParams.get('file');
  if (fileParam) {
    const decodedPath = decodeURIComponent(fileParam);
    clearDirState();
    try {
      await fs.openFileAsLightweightWorkspace(decodedPath);
      updateWorkspacePaths();
    } catch (e: any) {
      console.error('[OpenWork] Failed to open file via URL param:', e);
      fs.error = `Failed to open file: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
});

/** 侧边栏（文件树）宽度拖拽 */
function startSidebarResize(e: MouseEvent) {
  e.preventDefault();
  isResizingSidebar = true;
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent) => {
    if (!isResizingSidebar) return;
    sidebarWidth.value = Math.max(200, Math.min(500, startWidth + (ev.clientX - startX)));
  };

  const onUp = () => {
    isResizingSidebar = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', onUp);
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onUp);
}

/** 右侧面板宽度拖拽（向左拖拽拉宽面板） */
function startRightPanelResize(e: MouseEvent) {
  e.preventDefault();
  isResizingRightPanel = true;
  const startX = e.clientX;
  const startWidth = rightPanelWidth.value;

  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';

  const onMove = (ev: MouseEvent) => {
    if (!isResizingRightPanel) return;
    const maxWidth = calcRightPanelMax();
    rightPanelWidth.value = Math.max(300, Math.min(maxWidth, startWidth - (ev.clientX - startX)));
  };

  const onUp = () => {
    isResizingRightPanel = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('mouseup', onUp, true);
    window.removeEventListener('blur', onUp);
  };

  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('mouseup', onUp, true);
  window.addEventListener('blur', onUp);
}
</script>

<style scoped>
.main-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--app-bg);
}
.main-layout.drag-over {
  position: relative;
}
.main-content {
  display: flex;
  flex: 1;
  overflow: hidden;
}
.sidebar {
  background: var(--surface-1);
  border-right: 1px solid var(--border-subtle);
  overflow-y: auto;
  flex-shrink: 0;
}
.resize-handle {
  width: 4px;
  cursor: col-resize;
  flex-shrink: 0;
}
.resize-handle:hover {
  background: var(--accent);
  opacity: 0.4;
}
.editor-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface-2);
}
.editor-tabs {
  flex: 0 0 auto;
  height: auto;
  max-height: 48px;
  overflow: hidden;
  user-select: none;
  background: var(--surface-1);
  border-bottom: 1px solid var(--border-subtle);
}
.editor-tabs :deep(.n-tabs-pane-wrapper),
.editor-tabs :deep(.n-tabs-content) {
  display: none;
  height: 0;
  overflow: hidden;
}
.editor-tabs :deep(.n-tabs-nav) {
  background: var(--surface-1);
  border-bottom: none;
  padding: 0 var(--space-2);
}
.editor-tabs :deep(.n-tabs-tab) {
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  margin: var(--space-1) var(--space-1) 0 0;
  padding: 0 var(--space-3);
  height: 28px;
  transition: background var(--transition-fast), color var(--transition-fast);
}
.editor-tabs :deep(.n-tabs-tab--active) {
  background: var(--surface-2);
  color: var(--text-primary);
  font-weight: var(--weight-medium);
}
.editor-tabs :deep(.n-tabs-tab:hover) {
  background: var(--surface-hover);
  color: var(--text-primary);
}
.editor-tabs :deep(.n-tabs-tab__close) {
  color: var(--text-muted);
  opacity: 0;
  transition: opacity var(--transition-fast), color var(--transition-fast), background var(--transition-fast);
}
.editor-tabs :deep(.n-tabs-tab:hover .n-tabs-tab__close),
.editor-tabs :deep(.n-tabs-tab--active .n-tabs-tab__close) {
  opacity: 1;
}
.editor-tabs :deep(.n-tabs-tab__close:hover) {
  color: var(--text-primary);
  background: var(--surface-selected);
  border-radius: var(--radius-sm);
}
.tab-dirty-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  margin-left: var(--space-1);
  display: inline-block;
  font-size: 0;
  line-height: 0;
  vertical-align: middle;
}
.editor-container {
  flex: 1 1 auto;
  min-height: 200px;
  height: 0;
  overflow: hidden;
  position: relative;
}
.editor-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}
.placeholder-content {
  text-align: center;
  user-select: none;
}
.placeholder-title {
  font-size: 28px;
  font-weight: 300;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.placeholder-hint {
  color: var(--text-secondary);
  font-size: 14px;
  margin-bottom: 24px;
}
.placeholder-actions {
  display: flex;
  gap: 8px;
  justify-content: center;
}
.drop-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.32);
  backdrop-filter: blur(2px);
}
.drop-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-2);
  min-width: 280px;
  padding: var(--space-5) 30px;
  border: 1px dashed var(--accent);
  border-radius: var(--radius-lg);
  background: var(--surface-3);
  box-shadow: var(--shadow-md);
}
.drop-title {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 600;
}
.drop-subtitle {
  color: var(--text-secondary);
  font-size: 13px;
}
.right-resize-handle {
  width: 4px;
  cursor: col-resize;
  background: var(--border-subtle);
  flex-shrink: 0;
}
.right-resize-handle:hover {
  background: var(--accent);
  opacity: 0.4;
}
.right-sidebar {
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  background: var(--surface-1);
  position: relative;
}
.agent-ui-toggle {
  position: absolute;
  top: 2px;
  right: 6px;
  z-index: 10;
}
.undo-notification {
  position: fixed;
  bottom: var(--space-4);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  z-index: 1001;
  font-size: var(--font-base);
}
.undo-text {
  color: var(--text-primary);
}
.undo-btn {
  padding: var(--space-1) var(--space-3);
  font-size: var(--font-sm);
  cursor: pointer;
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
}
.undo-btn:hover {
  opacity: 0.9;
}
.undo-dismiss {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: var(--font-md);
  padding: 0 2px;
}
.undo-dismiss:hover {
  color: var(--text-primary);
}
.resize-handle.resize-n,
.resize-handle.resize-s,
.resize-handle.resize-e,
.resize-handle.resize-w,
.resize-handle.resize-ne,
.resize-handle.resize-nw,
.resize-handle.resize-se,
.resize-handle.resize-sw {
  position: fixed;
  z-index: 9999;
}
.resize-n {
  top: 0; left: 0; right: 0; height: 4px;
  cursor: ns-resize;
}
.resize-s {
  bottom: 0; left: 0; right: 0; height: 4px;
  cursor: ns-resize;
}
.resize-e {
  top: 0; right: 0; bottom: 0; width: 4px;
  cursor: ew-resize;
}
.resize-w {
  top: 0; left: 0; bottom: 0; width: 4px;
  cursor: ew-resize;
}
.resize-ne {
  top: 0; right: 0; width: 8px; height: 8px;
  cursor: nesw-resize;
}
.resize-nw {
  top: 0; left: 0; width: 8px; height: 8px;
  cursor: nwse-resize;
}
.resize-se {
  bottom: 0; right: 0; width: 8px; height: 8px;
  cursor: nwse-resize;
}
.resize-sw {
  bottom: 0; left: 0; width: 8px; height: 8px;
  cursor: nesw-resize;
}
.ws-dialog-path {
  display: block;
  padding: 10px 0;
  word-break: break-all;
  font-family: monospace;
  font-size: 13px;
}
</style>
