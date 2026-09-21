/// <reference types="vite/client" />

// Vue 单文件组件类型声明
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

declare module 'docx-preview';
declare module '@vue-office/excel';
declare module '@vue-office/pptx';

// Electron 环境下的 IPC API 类型声明
// Electron 主进程通过 preload 脚本将这些方法挂载到 window.electronAPI
interface Window {
  electronAPI?: {
    readFile: (path: string) => Promise<string>;
    readFileBuffer: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
    readDir: (path: string) => Promise<unknown[]>;
    exists: (path: string) => Promise<boolean>;
    stat: (path: string) => Promise<unknown>;
    createDir: (path: string) => Promise<void>;
    deleteFile: (path: string) => Promise<void>;
    deleteDir: (path: string, recursive?: boolean) => Promise<void>;
    rename: (oldPath: string, newPath: string) => Promise<void>;
    openFolderPath: (path: string) => Promise<string | null>;
    listDirectories: (path?: string) => Promise<{ path: string; parent: string | null; breadcrumbs: { name: string; path: string; isDirectory: true; hidden?: boolean }[]; entries: { name: string; path: string; isDirectory: true; hidden?: boolean }[]; truncated: boolean }>;
    createDirectory: (parent: string, name: string) => Promise<{ name: string; path: string; isDirectory: true; hidden?: boolean }>;
    openFolder: () => Promise<string | null>;
    openFile: () => Promise<{ path: string } | null>;
    saveFile: (path: string, content: string) => Promise<string | null>;
    getAppInfo: () => Promise<{ name: string; version: string; author: string }>;
    readConfig: (filename: string) => Promise<unknown>;
    writeConfig: (filename: string, data: unknown) => Promise<void>;
    onMenuAction: (callback: (action: string) => void) => void;
    minimizeWindow: () => Promise<void>;
    maximizeWindow: () => Promise<void>;
    unmaximizeWindow: () => Promise<void>;
    closeWindow: () => Promise<void>;
    isMaximized: () => Promise<boolean>;
    getBounds: () => Promise<{ x: number; y: number; width: number; height: number } | null>;
    resizeWindow: (x: number, y: number, w: number, h: number) => Promise<void>;
    onMaximizeChange: (callback: (isMaximized: boolean) => void) => void;
    createWindow: (workspacePath: string, isFile?: boolean) => Promise<{ status: 'created' } | { status: 'duplicate' }>;
    showNotification: (title: string, body: string) => Promise<void>;
    registerWorkspace: (workspacePath: string) => Promise<void>;
  };
  /** Electron 主进程注入的服务器端口号 */
  __OPENWORK_SERVER_PORT__?: number;
}

// 构建时从 app-info.json 注入的全局常量
declare const __APP_INFO__: {
  name: string;
  version: string;
  authors: { name: string; github: string }[];
};

// 浏览器 File System Access API 类型声明（部分浏览器可能不支持）
declare function showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>;
declare function showOpenFilePicker(options?: { multiple?: boolean }): Promise<FileSystemFileHandle[]>;
