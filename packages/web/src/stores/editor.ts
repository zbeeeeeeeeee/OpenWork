import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff',
]);

/** 决定使用哪个渲染器来展示标签页内容 */
export type ViewMode = 'code' | 'image' | 'docx' | 'excel' | 'pptx' | 'pdf' | 'html' | 'markdown';

/** 编辑器标签页 —— 代表一个打开的文件 */
export interface EditorTab {
  id: string;
  path: string;
  name: string;
  language: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  isUntitled: boolean;
  viewMode: ViewMode;
}

/** 工作区模式 */
export type WorkspaceMode = 'local' | 'server';

/** 工作区根 */
export interface WorkspaceRoot {
  path: string;
  name: string;
  mode: WorkspaceMode;
  workspaceId?: string;
}

let tabCounter = 0;

/** 归一化路径：统一斜杠方向，去除 ./ 前缀 */
function norm(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** 判断两个路径是否指向同一文件（处理相对/绝对路径混用） */
function pathsMatch(a: string, b: string, workspaceRoot: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  if (na === nb) return true;
  const nr = norm(workspaceRoot).replace(/\/$/, '');
  if (!nr) return false;
  // 一方是相对路径，另一方是 workspaceRoot 下的绝对路径
  if (!na.includes(':') && nr + '/' + na === nb) return true;
  if (!nb.includes(':') && nr + '/' + nb === na) return true;
  // 后缀匹配：处理 LLM 输出带 / 前缀等边界情况，仅在前缀为纯分隔符时生效
  // 防止 src/hello.rs 误匹配 hello.rs
  if (na.endsWith('/' + nb)) {
    const prefix = na.slice(0, na.length - ('/' + nb).length);
    if (/^[\/\\]*$/.test(prefix)) return true;
  }
  if (nb.endsWith('/' + na)) {
    const prefix = nb.slice(0, nb.length - ('/' + na).length);
    if (/^[\/\\]*$/.test(prefix)) return true;
  }
  return false;
}

/** 根据文件扩展名映射到 Monaco Editor 语言标识符 */
function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', html: 'html', css: 'css', scss: 'scss',
    md: 'markdown', py: 'python', rs: 'rust', go: 'go',
    java: 'java', cpp: 'cpp', c: 'c', yaml: 'yaml', yml: 'yaml',
    xml: 'xml', sql: 'sql', sh: 'shell', ps1: 'powershell',
    vue: 'html', svg: 'xml',
  };
  return map[ext || ''] || 'plaintext';
}

/** 根据文件扩展名决定使用哪个渲染器 */
export function getViewModeFromPath(filePath: string): ViewMode {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext && IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (ext === 'docx' || ext === 'doc') return 'docx';
  if (ext === 'xlsx' || ext === 'xls') return 'excel';
  if (ext === 'pptx' || ext === 'ppt') return 'pptx';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown';
  return 'code';
}

/**
 * Pinia 编辑器状态存储 —— 应用中编辑器状态的唯一真相来源
 *
 * 管理：标签页列表、活动标签、文件树、工作区根路径和工作模式。
 * 所有对标签页的增删改操作均在此集中处理。
 */
export const useEditorStore = defineStore('editor', () => {
  const tabs = ref<EditorTab[]>([]);
  const activeTabId = ref<string | null>(null);
  const fileTreeNodes = ref<any[]>([]);
  const workspaceRoots = ref<WorkspaceRoot[]>([]);
  const workspaceMode = ref<WorkspaceMode>('server');
  const activeWorkspaceId = ref<string | null>(null);
  const isSingleFile = ref(false);

  function enterSingleFileMode() { isSingleFile.value = true; }
  function exitSingleFileMode() { isSingleFile.value = false; }

  /** 当前活动标签页（计算属性） */
  const activeTab = computed(() => tabs.value.find(t => t.id === activeTabId.value) ?? null);

  /** 首个工作区根路径（向后兼容） */
  const workspaceRoot = computed(() => workspaceRoots.value[0]?.path || '');

  /** 添加工作区根 */
  function addWorkspaceRoot(root: WorkspaceRoot) {
    if (!workspaceRoots.value.find(r => r.path === root.path)) {
      workspaceRoots.value.push(root);
      if (workspaceRoots.value.length === 1) {
        workspaceMode.value = root.mode;
      }
    }
  }

  /** 打开文件 —— 若已存在同路径标签则激活，否则新建标签 */
  const openFile = (filePath: string, content: string) => {
    const existing = tabs.value.find(t => pathsMatch(t.path, filePath, workspaceRoot.value));
    if (existing) {
      activeTabId.value = existing.id;
      return;
    }
    const id = `tab_${++tabCounter}`;
    const tab: EditorTab = {
      id,
      path: filePath,
      name: filePath.split('/').pop() || filePath.split('\\').pop() || filePath,
      language: getLanguageFromPath(filePath),
      content,
      originalContent: content,
      isDirty: false,
      isUntitled: false,
      viewMode: getViewModeFromPath(filePath),
    };
    tabs.value.push(tab);
    activeTabId.value = id;
  };

  /** 新建未命名标签页 */
  const newUntitled = () => {
    const id = `tab_${++tabCounter}`;
    const tab: EditorTab = {
      id,
      path: `untitled-${tabCounter}`,
      name: `untitled-${tabCounter}`,
      language: 'plaintext',
      content: '',
      originalContent: '',
      isDirty: false,
      isUntitled: true,
      viewMode: 'code',
    };
    tabs.value.push(tab);
    activeTabId.value = id;
  };

  /** 关闭标签页 —— 若关闭活动标签则自动切换到相邻标签 */
  const closeTab = (tabId: string) => {
    const idx = tabs.value.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    tabs.value.splice(idx, 1);
    if (activeTabId.value === tabId) {
      activeTabId.value = tabs.value.length > 0 ? tabs.value[Math.min(idx, tabs.value.length - 1)].id : null;
    }
  };

  /** 更新标签页内容并自动计算脏状态 */
  const updateContent = (tabId: string, content: string) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.content = content;
      tab.isDirty = content !== tab.originalContent;
    }
  };

  /** 保存标签页 —— 同步 originalContent，清除脏标记 */
  const saveTab = (tabId: string) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.originalContent = tab.content;
      tab.isDirty = false;
    }
  };

  /** 切换活动标签页（幂等：tabId 不存在则无操作） */
  const setActiveTab = (tabId: string) => {
    if (tabs.value.find(t => t.id === tabId)) {
      activeTabId.value = tabId;
    }
  };

  /** 更新标签页路径（用于"另存为"后更新路径和语言类型） */
  const setTabPath = (tabId: string, newPath: string) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.path = newPath;
      tab.name = newPath.split('/').pop() || newPath.split('\\').pop() || newPath;
      tab.language = getLanguageFromPath(newPath);
      tab.viewMode = getViewModeFromPath(newPath);
      tab.isUntitled = false;
    }
  };

  /** 按路径激活标签页(使用与 openFile 一致的 pathsMatch 模糊匹配) */
  const setActiveTabByName = (filePath: string) => {
    const tab = tabs.value.find(t => pathsMatch(t.path, filePath, workspaceRoot.value));
    if (tab) {
      activeTabId.value = tab.id;
    }
  };

  /** 按路径查找标签 */
  const findTabByPath = (filePath: string): EditorTab | undefined => {
    return tabs.value.find(t => pathsMatch(t.path, filePath, workspaceRoot.value));
  };

  /** 磁盘重载后替换内容并清脏标记 */
  const replaceTabContent = (tabId: string, content: string) => {
    const tab = tabs.value.find(t => t.id === tabId);
    if (tab) {
      tab.content = content;
      tab.originalContent = content;
      tab.isDirty = false;
    }
  };

  return {
    tabs, activeTabId, activeTab, fileTreeNodes, workspaceRoot, workspaceRoots, workspaceMode,
    activeWorkspaceId, isSingleFile,
    addWorkspaceRoot,
    openFile, newUntitled, closeTab, updateContent, saveTab, setActiveTab, setTabPath, setActiveTabByName,
    findTabByPath, replaceTabContent,
    enterSingleFileMode, exitSingleFileMode,
  };
});
