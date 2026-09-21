import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import {
  createFileServiceClient,
  createServerClient,
  detectEnvironment,
  type FileServiceClient,
  type WorkspaceInfo,
} from '../services/fileService';
import { getEditorInstance } from '../services/editorInstance';
import { useEditorStore, getViewModeFromPath } from '../stores/editor';
import { useSessionStore } from '../stores/sessions';
import { useFileClipboard } from './useFileClipboard';

/**
 * 文件系统交互 composable
 *
 * 核心职责：
 * 1. 根据运行时环境创建对应的 FileServiceClient
 * 2. 提供文件操作方法（打开、保存、删除、新建目录等）
 * 3. 注册全局键盘快捷键（Ctrl+S/N/W/Z/Y/F/H/X/C/V）
 * 4. 管理删除撤销（10 秒内可恢复）
 * 5. 提供 saveAs 回调注册机制供 MainLayout 集成
 */
export function useFileSystem() {
  const { t } = useI18n();
  const defaultClient = createFileServiceClient();
  const store = useEditorStore();
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const activeClient = ref<FileServiceClient>(defaultClient);
  const serverClient = ref<FileServiceClient | null>(null);
  const env = detectEnvironment();

  let saveAsHandler: (() => Promise<string | null>) | null = null;
  let onAfterSave: ((savePath: string) => void) | null = null;
  let openFolderDialogHandler: (() => Promise<string | null>) | null = null;
  let openFileDialogHandler: (() => Promise<string | null>) | null = null;
  let newFileHandler: (() => Promise<string | null>) | null = null;

  const lastDeleted = ref<{ path: string; content: string } | null>(null);
  const showUndoNotification = ref(false);
  let undoTimer: ReturnType<typeof setTimeout> | null = null;

  function setSaveAsHandler(handler: () => Promise<string | null>) {
    saveAsHandler = handler;
  }

  function setOnAfterSave(callback: (savePath: string) => void) {
    onAfterSave = callback;
  }

  function setOpenFolderDialogHandler(handler: () => Promise<string | null>) {
    openFolderDialogHandler = handler;
  }

  function setOpenFileDialogHandler(handler: () => Promise<string | null>) {
    openFileDialogHandler = handler;
  }

  function setNewFileHandler(handler: () => Promise<string | null>) {
    newFileHandler = handler;
  }

  if (env === 'browser' || env === 'server') {
    serverClient.value = createServerClient();
    activeClient.value = serverClient.value;
    store.workspaceMode = 'server';
  }

  function getServerClient(): FileServiceClient {
    if (!serverClient.value) {
      let baseUrl = '';
      if (typeof window !== 'undefined' && (window as any).__OPENWORK_SERVER_PORT__) {
        baseUrl = `http://localhost:${(window as any).__OPENWORK_SERVER_PORT__}`;
      }
      serverClient.value = createServerClient(baseUrl);
    }
    return serverClient.value;
  }

  function getClient(): FileServiceClient {
    return activeClient.value;
  }

  /** 加载目录内容到 store.fileTreeNodes */
  async function loadDirectory(dirPath: string = '.') {
    isLoading.value = true;
    error.value = null;
    try {
      const entries = await getClient().readDir(dirPath);
      store.fileTreeNodes = entries;
      return entries;
    } catch (e: any) {
      error.value = e.message;
      return [];
    } finally {
      isLoading.value = false;
    }
  }

  /** ArrayBuffer → base64 字符串（分块，避免大文件卡死主线程） */
  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const CHUNK = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(i, Math.min(i + CHUNK, bytes.length)) as unknown as number[],
      );
    }
    return btoa(binary);
  }

  function getMimeType(ext: string): string {
    const mimeMap: Record<string, string> = {
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
      bmp: 'image/bmp', ico: 'image/x-icon', tiff: 'image/tiff',
    };
    return mimeMap[ext] || 'application/octet-stream';
  }

  function arrayBufferToDataUrl(buffer: ArrayBuffer, mime: string): string {
    return `data:${mime};base64,${arrayBufferToBase64(buffer)}`;
  }

  /** 文本打开上限：超过则拒绝，避免 Monaco 卡死整个渲染进程 */
  const MAX_TEXT_OPEN_BYTES = 2 * 1024 * 1024;
  /** 二进制/办公文档打开上限 */
  const MAX_BINARY_OPEN_BYTES = 20 * 1024 * 1024;

  /** 读取文件并在编辑器中打开为标签页 */
  async function openAndReadFile(filePath: string) {
    isLoading.value = true;
    error.value = null;
    try {
      const ext = filePath.split('.').pop()?.toLowerCase() || '';
      const viewMode = getViewModeFromPath(filePath);
      const client = getClient();

      // 先探测大小，过大直接拒绝，防止卡死 UI
      try {
        const st = await client.stat?.(filePath);
        const size = st?.size;
        if (typeof size === 'number') {
          const limit = viewMode === 'code' || viewMode === 'markdown' || viewMode === 'html'
            ? MAX_TEXT_OPEN_BYTES
            : MAX_BINARY_OPEN_BYTES;
          if (size > limit) {
            error.value = t('fileTree.fileTooLarge', { size: Math.round(size / 1024), limit: Math.round(limit / 1024) });
            return;
          }
        }
      } catch {
        /* stat 失败则继续尝试打开 */
      }

      if (viewMode === 'image') {
        const buffer = await client.readFileBuffer(filePath);
        const mime = getMimeType(ext);
        store.openFile(filePath, arrayBufferToDataUrl(buffer, mime));
      } else if (viewMode === 'docx') {
        const buffer = await client.readFileBuffer(filePath);
        store.openFile(filePath, arrayBufferToBase64(buffer));
      } else if (viewMode === 'excel') {
        const buffer = await client.readFileBuffer(filePath);
        store.openFile(filePath, arrayBufferToBase64(buffer));
      } else if (viewMode === 'pptx') {
        const buffer = await client.readFileBuffer(filePath);
        store.openFile(filePath, arrayBufferToBase64(buffer));
      } else if (viewMode === 'pdf') {
        const buffer = await client.readFileBuffer(filePath);
        store.openFile(filePath, arrayBufferToBase64(buffer));
      } else if (ext === 'doc') {
        store.openFile(filePath, '');
      } else {
        const content = await client.readFile(filePath);
        if (content.length > MAX_TEXT_OPEN_BYTES) {
          error.value = t('fileTree.fileTooLarge', { size: Math.round(content.length / 1024), limit: Math.round(MAX_TEXT_OPEN_BYTES / 1024) });
          return;
        }
        store.openFile(filePath, content);
      }
    } catch (e: any) {
      error.value = e.message;
      console.error('[openAndReadFile]', filePath, e);
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 以单个文件为虚拟工作区，直接打开该文件。
   *
   * 与完整工作区（Open Folder）的区别：
   * - 不调用服务端 /api/workspace/open（不创建 .openwork 目录）
   * - 不加载文件树（工作区是虚拟的，无真实文件夹承载）
   * - 不持久化标签页状态
   * - workspaceId 为 null
   *
   * 适用于 Open File 对话框和拖拽文件两种场景。
   */
  async function openFileAsLightweightWorkspace(filePath: string) {
    const client = getClient();
    const normalizedPath = filePath.replace(/\\/g, '/');
    const lastSlash = normalizedPath.lastIndexOf('/');
    const parentDir = lastSlash >= 0 ? normalizedPath.substring(0, lastSlash) || '/' : '/';
    const fileName = normalizedPath.split('/').pop() || '';

    const wsClient = env === 'electron' ? getServerClient() : client;

    if (store.isSingleFile && store.activeWorkspaceId) {
      try { await wsClient.closeWorkspace(store.activeWorkspaceId); } catch { /* ignore */ }
    }

    store.tabs.length = 0;
    store.activeTabId = null;
    store.fileTreeNodes = [];

    if (env === 'electron' && client.openFolderPath) {
      await client.openFolderPath(parentDir);
    } else {
      client.setWorkspaceRoot?.(parentDir);
    }

    const mode: 'local' | 'server' = env === 'electron' ? 'local' : 'server';

    try {
      const info = await wsClient.openWorkspace(parentDir, undefined, true);
      store.workspaceRoots = [{ path: info.rootPath, name: info.rootName, mode, workspaceId: info.workspaceId }];
      store.activeWorkspaceId = info.workspaceId;
      const sessionStore = useSessionStore();
      await sessionStore.bindWorkspace(info.workspaceId, info.agentSessions, info.rootPath);
    } catch {
      error.value = t('fs.singleFileWorkspaceFailed');
      return;
    }

    store.workspaceMode = mode;
    store.enterSingleFileMode();

    await openAndReadFile(normalizedPath);
    window.electronAPI?.registerWorkspace?.(parentDir);
  }

  /** 保存当前活动标签页到文件系统 */
  async function saveCurrentFile() {
    const tab = store.activeTab;
    if (!tab) return;
    if (tab.viewMode !== 'code' && tab.viewMode !== 'html' && tab.viewMode !== 'markdown') {
      error.value = t('fs.saveDocument');
      return;
    }
    error.value = null;
    try {
      const client = getClient();
      let savePath = tab.path;

      // 未命名文件：触发"另存为"流程
      if (tab.isUntitled) {
        if (saveAsHandler) {
          const newPath = await saveAsHandler();
          if (!newPath) return;
          savePath = newPath;
        } else if (client.saveFileAs) {
          const result = await client.saveFileAs(tab.path, tab.content);
          if (!result) return;
          savePath = result;
        } else {
          const name = prompt(t('fs.enterFilename'), tab.name)?.trim();
          if (!name) return;
          savePath = name.replace(/\\/g, '/');
        }
        store.setTabPath(tab.id, savePath);
      }

      await client.writeFile(savePath, tab.content);
      store.saveTab(tab.id);
      onAfterSave?.(savePath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /**
   * 删除文件
   *
   * 删除前备份内容，10 秒内可通过 undoDelete() 恢复。
   * 同时关闭所有打开该文件的标签页。
   */
  async function deleteFile(filePath: string) {
    error.value = null;
    try {
      const client = getClient();
      let content = '';
      try {
        content = await client.readFile(filePath);
      } catch { /* 文件可能不存在 */ }

      await client.deleteFile(filePath);

      // 关闭打开该文件的所有标签页
      const openTabs = store.tabs.filter(t => t.path === filePath);
      for (const tab of openTabs) {
        store.closeTab(tab.id);
      }

      // 显示撤销通知
      lastDeleted.value = { path: filePath, content };
      showUndoNotification.value = true;

      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = setTimeout(() => {
        showUndoNotification.value = false;
        lastDeleted.value = null;
      }, 10000);

      onAfterSave?.(filePath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 删除目录（递归删除） */
  async function deleteDir(dirPath: string) {
    error.value = null;
    try {
      const client = getClient();
      await client.deleteDir(dirPath);

      // 关闭该目录下所有已打开文件的标签页
      const openTabs = store.tabs.filter(t => t.path.startsWith(dirPath + '/') || t.path === dirPath);
      for (const tab of openTabs) {
        store.closeTab(tab.id);
      }

      onAfterSave?.(dirPath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 撤销删除操作 */
  async function undoDelete() {
    if (!lastDeleted.value) return;
    error.value = null;
    try {
      const client = getClient();
      await client.writeFile(lastDeleted.value.path, lastDeleted.value.content);
      const deleted = lastDeleted.value;
      lastDeleted.value = null;
      showUndoNotification.value = false;
      if (undoTimer) clearTimeout(undoTimer);
      onAfterSave?.(deleted.path);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 创建新文件夹 */
  async function createFolder() {
    error.value = null;
    const name = prompt(t('fs.folderName'))?.trim();
    if (!name) return;
    try {
      const client = getClient();
      await client.createDir(name);
      onAfterSave?.(name);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 创建空文件到指定目录 */
  async function createFileInDir(dirPath: string, fileName: string) {
    error.value = null;
    try {
      const fullPath = dirPath ? dirPath.replace(/\/$/, '') + '/' + fileName : fileName;
      const client = getClient();
      await client.writeFile(fullPath, '');
      onAfterSave?.(fullPath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 在指定父目录下创建子文件夹 */
  async function createDirInPath(parentPath: string, folderName: string) {
    error.value = null;
    try {
      const fullPath = parentPath ? parentPath.replace(/\/$/, '') + '/' + folderName : folderName;
      const client = getClient();
      await client.createDir(fullPath);
      onAfterSave?.(fullPath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 重命名文件或文件夹 */
  async function renameFile(oldPath: string, newName: string) {
    error.value = null;
    try {
      const parentPath = oldPath.replace(/[^/\\]+$/, '');
      const newPath = parentPath + newName;
      const client = getClient();
      await client.rename(oldPath, newPath);

      const openTabs = store.tabs.filter(t => t.path === oldPath);
      for (const tab of openTabs) {
        store.setTabPath(tab.id, newPath);
      }
      onAfterSave?.(oldPath);
    } catch (e: any) {
      error.value = e.message;
    }
  }

  const { clipboard, cutItem, copyItem, copyPathToClipboard, copyDirRecursive } = useFileClipboard();

  async function pasteItem(targetDir: string) {
    const item = clipboard.value;
    if (!item) return;
    error.value = null;
    try {
      const targetParent = targetDir ? targetDir.replace(/\/$/, '') : '';
      const targetPath = targetParent ? targetParent + '/' + item.name : item.name;
      const client = getClient();

      if (item.action === 'cut') {
        await client.rename(item.path, targetPath);

        const openTabs = store.tabs.filter(t => t.path === item.path);
        for (const tab of openTabs) {
          store.setTabPath(tab.id, targetPath);
        }
        clipboard.value = null;
      } else {
        if (item.isDirectory) {
          await copyDirRecursive(client, client, item.path, targetPath);
        } else {
          const content = await client.readFile(item.path);
          await client.writeFile(targetPath, content);
        }
      }
      onAfterSave?.(targetDir || '.');
    } catch (e: any) {
      error.value = e.message;
    }
  }

  /** 仅获取文件夹路径（通过对话框选择），不打开工作区 */
  async function resolveFolderPath(): Promise<string | null> {
    if (openFolderDialogHandler) {
      return await openFolderDialogHandler();
    }
    if (env === 'electron') {
      const client = getClient();
      return await client.openFolder();
    }
    return null;
  }

  /** 仅获取文件路径（通过对话框选择），不打开工作区 */
  async function resolveFilePath(): Promise<string | null> {
    if (openFileDialogHandler) {
      return await openFileDialogHandler();
    }
    if (env === 'electron') {
      const client = getClient();
      const result = await client.openFile();
      return result?.path ?? null;
    }
    return null;
  }

  /** 通过已确定的路径打开工作区（不弹出对话框） */
  async function openWorkspaceViaPath(folderPath: string): Promise<void> {
    if (env === 'electron') {
      const client = getClient();
      const root = await client.openFolderPath?.(folderPath);
      if (!root) {
        error.value = `Failed to open folder path: ${folderPath}`;
        return;
      }
      store.exitSingleFileMode();
      store.tabs.length = 0;
      store.activeTabId = null;

      const sc = getServerClient();
      if (store.activeWorkspaceId) {
        try { await sc.closeWorkspace(store.activeWorkspaceId); } catch { /* ignore */ }
      }
      try {
        const info = await sc.openWorkspace(root);
        client.setWorkspaceRoot?.(info.rootPath);
        store.workspaceRoots = [{ path: info.rootPath, name: info.rootName, mode: 'local', workspaceId: info.workspaceId }];
        store.activeWorkspaceId = info.workspaceId;
        const sessionStore = useSessionStore();
        await sessionStore.bindWorkspace(info.workspaceId, info.agentSessions, info.rootPath);
      } catch {
        error.value = t('fs.singleFileWorkspaceFailed');
        return;
      }

      await loadDirectory('.');
      window.electronAPI?.registerWorkspace?.(root);
      return;
    }
    await openWorkspaceAtPath(folderPath);
  }

  /** 打开文件夹：先选择目录，再走统一的 workspace 打开逻辑 */
  async function openFolderDialog(): Promise<string | null> {
    const rootPath = await resolveFolderPath();
    if (!rootPath) return null;
    await openWorkspaceViaPath(rootPath);
    return rootPath;
  }

  /** 打开文件：先选择文件，再走统一的 lightweight workspace 打开逻辑 */
  async function openFileDialog(): Promise<string | null> {
    const filePath = await resolveFilePath();
    if (!filePath) return null;
    await openFileAsLightweightWorkspace(filePath);
    return filePath;
  }

  /** 通过 server API 打开工作区 */
  async function openWorkspaceAtPath(rootPath: string): Promise<WorkspaceInfo> {
    error.value = null;
    try {
      store.exitSingleFileMode();
      const client = getClient();
      const info = await client.openWorkspace(rootPath);
      if (store.activeWorkspaceId && store.activeWorkspaceId !== info.workspaceId) {
        try { await client.closeWorkspace(store.activeWorkspaceId); } catch { /* ignore */ }
      }
      store.tabs.length = 0;
      store.activeTabId = null;
      client.setWorkspaceRoot?.(info.rootPath);
      store.workspaceRoots = [{ path: info.rootPath, name: info.rootName, mode: 'server', workspaceId: info.workspaceId }];
      store.activeWorkspaceId = info.workspaceId;
      store.workspaceMode = 'server';

      // 绑定 Agent 会话到工作区
      const sessionStore = useSessionStore();
      await sessionStore.bindWorkspace(info.workspaceId, info.agentSessions, info.rootPath);

      await loadDirectory('.');

      // 恢复上次打开的标签页（兼容文件已删除的情况）
      if (info.openTabs && info.openTabs.length > 0) {
        for (const tabInfo of info.openTabs) {
          const exists = await client.exists(tabInfo.path).catch(() => false);
          if (exists) {
            await openAndReadFile(tabInfo.path);
          }
        }
        if (info.activeTabPath) {
          store.setActiveTabByName?.(info.activeTabPath);
        }
      }

      return info;
    } catch (e: any) {
      error.value = e.message;
      throw e;
    }
  }

  /** 拖放打开文件夹或文件（仅 Electron 模式支持） */
  async function openDroppedFolder(dataTransfer: DataTransfer | null): Promise<boolean> {
    error.value = null;
    if (!dataTransfer) return false;

    // Server / Browser 模式：无法获取文件系统路径，不支持拖放
    if (env !== 'electron') {
      error.value = t('fs.dropNotSupported');
      return false;
    }

    try {
      const client = getClient();

      if (client.openFolderPath) {
        const dropped = Array.from(dataTransfer.files)
          .map(f => (f as File & { path?: string }).path)
          .filter((p): p is string => Boolean(p));

        for (const droppedPath of dropped) {
          try {
            let isDirectory = false;
            try {
              const entry = await client.stat(droppedPath);
              isDirectory = entry.isDirectory;
            } catch { /* stat 失败，假定为文件 */ }

            if (isDirectory) {
              const root = await client.openFolderPath(droppedPath);
              if (root) {
                store.exitSingleFileMode();
                store.tabs.length = 0;
                store.activeTabId = null;

                const sc = getServerClient();
                if (store.activeWorkspaceId) {
                  try { await sc.closeWorkspace(store.activeWorkspaceId); } catch { /* ignore */ }
                }
                try {
                  const info = await sc.openWorkspace(root);
                  client.setWorkspaceRoot?.(info.rootPath);
                  store.workspaceRoots = [{ path: info.rootPath, name: info.rootName, mode: 'local', workspaceId: info.workspaceId }];
                  store.activeWorkspaceId = info.workspaceId;
                  const sessionStore = useSessionStore();
                  await sessionStore.bindWorkspace(info.workspaceId, info.agentSessions, info.rootPath);
                } catch {
                  error.value = t('fs.singleFileWorkspaceFailed');
                  return false;
                }

                await loadDirectory('.');
                return true;
              }
            } else {
              await openFileAsLightweightWorkspace(droppedPath);
              return true;
            }
          } catch { /* try next */ }
        }
      }
      return false;
    } catch (e: any) {
      error.value = e.message;
      return false;
    }
  }

  /** 保存当前工作区打开的标签页状态到 .openwork/workspace.json */
  async function persistWorkspaceState() {
    const wsId = store.activeWorkspaceId;
    if (!wsId) return;
    try {
      const tabInfos = store.tabs
        .filter(t => !t.isUntitled)
        .map(t => ({ path: t.path }));
      const activeTabPath = store.activeTab?.isUntitled ? undefined : store.activeTab?.path;
      const client = env === 'electron' ? getServerClient() : getClient();
      await client.updateWorkspace(wsId, {
        openTabs: tabInfos,
        activeTabPath,
        workspaceRoot: store.workspaceRoot,
      });
    } catch (e: any) {
      // 不要静默失败 —— server 重启等场景下持久化失败需要可追踪
      console.warn(`persistWorkspaceState failed: ${e.message}`);
    }
  }

  /**
   * 判断当前是否有文本输入控件聚焦
   *
   * 用于键盘快捷键保护：当用户在 input/textarea/Monaco 编辑器中输入时，
   * 不触发全局快捷键，避免干扰正常编辑。
   */
  function isInputFocused(): boolean {
    const el = document.activeElement;
    if (!el) return false;
    const editor = getEditorInstance();
    if (editor?.hasTextFocus()) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (el as HTMLElement).isContentEditable;
  }

  // 全局键盘快捷键处理
  const handleKeydown = (e: KeyboardEvent) => {
    const ctrl = e.ctrlKey || e.metaKey;

    // Ctrl+S: 保存
    if (ctrl && e.key === 's') {
      if (!isInputFocused()) {
        e.preventDefault();
        saveCurrentFile();
      }
      return;
    }

    // Ctrl+C: 复制（Monaco 失焦时通过剪贴板 API 实现）
    if (ctrl && e.key === 'c') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor && !editor.hasTextFocus()) {
          const selection = editor.getSelection();
          if (selection && !selection.isEmpty()) {
            const model = editor.getModel();
            if (model) {
              const text = model.getValueInRange(selection);
              navigator.clipboard.writeText(text).catch(() => {});
            }
          }
        }
      }
      return;
    }

    // Ctrl+V: 粘贴（Monaco 失焦时通过剪贴板 API 实现）
    if (ctrl && e.key === 'v') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor && !editor.hasTextFocus()) {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            if (text) {
              editor.executeEdits('clipboard-paste', [
                { range: editor.getSelection()!, text },
              ]);
            }
          }).catch(() => {});
        }
      }
      return;
    }

    // Ctrl+N: 新建文件（优先使用弹窗流程）
    if (ctrl && e.key === 'n') {
      if (!isInputFocused()) {
        e.preventDefault();
        if (newFileHandler) {
          newFileHandler();
        } else {
          store.newUntitled();
        }
      }
      return;
    }

    // Ctrl+W: 关闭标签页
    if (ctrl && e.key === 'w') {
      if (!isInputFocused()) {
        e.preventDefault();
        if (store.activeTab) store.closeTab(store.activeTab.id);
      }
      return;
    }

    // Ctrl+X: 剪切
    if (ctrl && e.key === 'x') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor && !editor.hasTextFocus()) {
          e.preventDefault();
          const selection = editor.getSelection();
          if (selection && !selection.isEmpty()) {
            const model = editor.getModel();
            if (model) {
              const text = model.getValueInRange(selection);
              navigator.clipboard.writeText(text).then(() => {
                editor.executeEdits('clipboard-cut', [
                  { range: selection, text: '' },
                ]);
              }).catch(() => {});
            }
          }
        }
      }
      return;
    }

    // Ctrl+Z: 撤销
    if (ctrl && e.key === 'z') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor) {
          e.preventDefault();
          editor.trigger('keyboard', 'undo', null);
        }
      }
      return;
    }

    // Ctrl+Y / Ctrl+Shift+Z: 重做
    if (ctrl && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor) {
          e.preventDefault();
          editor.trigger('keyboard', 'redo', null);
        }
      }
      return;
    }

    // Ctrl+F: 查找
    if (ctrl && e.key === 'f') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor) {
          e.preventDefault();
          editor.focus();
          editor.getAction('actions.find')?.run();
        }
      }
      return;
    }

    // Ctrl+H: 替换
    if (ctrl && e.key === 'h') {
      if (!isInputFocused()) {
        const editor = getEditorInstance();
        if (editor) {
          e.preventDefault();
          editor.focus();
          editor.getAction('editor.action.startFindReplaceAction')?.run();
        }
      }
      return;
    }
  };

  onMounted(() => window.addEventListener('keydown', handleKeydown));
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown));

  /**
   * Agent 写盘后刷新已打开标签。
   * - 仅处理文本型 viewMode；脏标签跳过（避免覆盖用户未保存修改）
   */
  async function reloadTabsForPaths(paths: string[]) {
    const client = getClient();
    for (const p of paths) {
      const tab = store.findTabByPath(p);
      if (!tab || tab.isUntitled) continue;
      if (tab.isDirty) continue;
      if (tab.viewMode !== 'code' && tab.viewMode !== 'markdown' && tab.viewMode !== 'html') {
        continue;
      }
      try {
        const content = await client.readFile(tab.path);
        store.replaceTabContent(tab.id, content);
      } catch (e: any) {
        error.value = e.message;
      }
    }
  }

  return {
    client: activeClient,
    isLoading,
    error,
    env,
    loadDirectory,
    openAndReadFile,
    reloadTabsForPaths,
    openFileAsLightweightWorkspace,
    saveCurrentFile,
    openFolderDialog,
    openDroppedFolder,
    openFileDialog,
    openWorkspaceAtPath,
    openWorkspaceViaPath,
    resolveFolderPath,
    resolveFilePath,
    persistWorkspaceState,
    deleteFile,
    deleteDir,
    undoDelete,
    createFolder,
    createFileInDir,
    createDirInPath,
    renameFile,
    copyPathToClipboard,
    clipboard,
    cutItem,
    copyItem,
    pasteItem,
    lastDeleted,
    showUndoNotification,
    setSaveAsHandler,
    setOnAfterSave,
    setOpenFolderDialogHandler,
    setOpenFileDialogHandler,
    setNewFileHandler,
  };
}

/**
 * 独立刷新已打开标签（AgentChatB 用；勿再调 useFileSystem() 以免重复注册快捷键）。
 */
export async function reloadTabsForPaths(paths: string[]) {
  const store = useEditorStore();
  const client = createFileServiceClient();
  for (const p of paths) {
    const tab = store.findTabByPath(p);
    if (!tab || tab.isUntitled || tab.isDirty) continue;
    if (tab.viewMode !== 'code' && tab.viewMode !== 'markdown' && tab.viewMode !== 'html') {
      continue;
    }
    try {
      const content = await client.readFile(tab.path);
      store.replaceTabContent(tab.id, content);
    } catch {
      /* ignore single-file reload failures */
    }
  }
}
