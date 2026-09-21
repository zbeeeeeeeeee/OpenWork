import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  readFileBuffer: (filePath: string) => ipcRenderer.invoke('file:readBuffer', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  deleteFile: (filePath: string) => ipcRenderer.invoke('file:delete', filePath),
  readDir: (dirPath: string) => ipcRenderer.invoke('file:readDir', dirPath),
  createDir: (dirPath: string) => ipcRenderer.invoke('file:createDir', dirPath),
  deleteDir: (dirPath: string, recursive?: boolean) => ipcRenderer.invoke('file:deleteDir', dirPath, recursive),
  exists: (filePath: string) => ipcRenderer.invoke('file:exists', filePath),
  stat: (filePath: string) => ipcRenderer.invoke('file:stat', filePath),
  rename: (oldPath: string, newPath: string) => ipcRenderer.invoke('file:rename', oldPath, newPath),
  openFolderPath: (folderPath: string) => ipcRenderer.invoke('file:openFolderPath', folderPath),
  listDirectories: (path?: string) => ipcRenderer.invoke('picker:listDirectories', path),
  createDirectory: (parent: string, name: string) => ipcRenderer.invoke('picker:createDirectory', parent, name),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  saveFile: (filePath: string, content: string) => ipcRenderer.invoke('dialog:saveFile', filePath, content),
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  readConfig: (filename: string) => ipcRenderer.invoke('config:read', filename),
  writeConfig: (filename: string, data: unknown) => ipcRenderer.invoke('config:write', filename, data),
  onMenuAction: (callback: (action: string) => void) => {
    ipcRenderer.on('menu:action', (_event, action) => callback(action));
  },
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  unmaximizeWindow: () => ipcRenderer.invoke('window:unmaximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  getBounds: () => ipcRenderer.invoke('window:getBounds'),
  resizeWindow: (x: number, y: number, w: number, h: number) => ipcRenderer.invoke('window:resize', x, y, w, h),
  onMaximizeChange: (callback: (isMaximized: boolean) => void) => {
    ipcRenderer.on('window:maximizeChange', (_event, isMaximized: boolean) => callback(isMaximized));
  },
  createWindow: (workspacePath: string, isFile?: boolean) => ipcRenderer.invoke('window:create', workspacePath, isFile),
  showNotification: (title: string, body: string) => ipcRenderer.invoke('window:showNotification', title, body),
  registerWorkspace: (workspacePath: string) => ipcRenderer.invoke('window:registerWorkspace', workspacePath),
});
