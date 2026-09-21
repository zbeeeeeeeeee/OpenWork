import { IpcMain, Dialog, BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const windowRoots = new Map<number, string>();

function getSenderRoot(event: Electron.IpcMainInvokeEvent): string | null {
  return windowRoots.get(event.sender.id) || null;
}

export function getOpenWorkspacePaths(): string[] {
  return Array.from(windowRoots.values());
}

export function clearWindowRoot(webContentsId: number) {
  windowRoots.delete(webContentsId);
}

const MAX_DIRECTORY_ENTRIES = 1000;

interface DirectoryBrowserEntry {
  name: string;
  path: string;
  isDirectory: true;
  hidden?: boolean;
}

interface DirectoryBrowseResult {
  path: string;
  parent: string | null;
  breadcrumbs: DirectoryBrowserEntry[];
  entries: DirectoryBrowserEntry[];
  truncated: boolean;
}

function isFullyQualifiedAbsolutePath(input: string): boolean {
  const candidate = String(input ?? '').trim();
  if (!candidate) return false;
  if (process.platform === 'win32') {
    const normalized = path.win32.normalize(candidate);
    if (!path.win32.isAbsolute(normalized)) return false;
    const root = path.win32.parse(normalized).root;
    if (/^[A-Za-z]:[\\/]/.test(root)) return true;
    if (root.startsWith('\\\\')) {
      const parts = root.split(/[\\/]+/).filter(Boolean);
      return parts.length >= 2;
    }
    return false;
  }
  return path.posix.isAbsolute(candidate);
}

function buildBreadcrumbs(absPath: string): DirectoryBrowserEntry[] {
  const parsed = path.parse(absPath);
  const root = parsed.root;
  if (!root) {
    return [{ name: absPath, path: absPath, isDirectory: true }];
  }
  const segments: string[] = [];
  let current = absPath;
  while (current !== root) {
    const currentParsed = path.parse(current);
    segments.unshift(currentParsed.base);
    current = currentParsed.dir;
  }
  const breadcrumbs: DirectoryBrowserEntry[] = [{ name: root, path: root, isDirectory: true }];
  let acc = root;
  for (const segment of segments) {
    acc = path.join(acc, segment);
    breadcrumbs.push({ name: segment, path: acc, isDirectory: true });
  }
  return breadcrumbs;
}

function validateSingleSegmentName(name: string): void {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) throw new Error('Folder name cannot be empty');
  if (trimmed === '.' || trimmed === '..') throw new Error('Invalid folder name');
  if (trimmed.includes('/') || trimmed.includes('\\')) throw new Error('Invalid folder name');
}

async function listDirectoriesForPicker(rawPath?: string): Promise<DirectoryBrowseResult> {
  const input = rawPath === undefined || rawPath === null || String(rawPath).trim() === ''
    ? os.homedir()
    : String(rawPath);
  if (!isFullyQualifiedAbsolutePath(input)) {
    throw new Error(`Invalid absolute path: ${input}`);
  }
  const absPath = path.resolve(input);
  const stat = await fs.stat(absPath);
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${absPath}`);
  }
  const dirents = await fs.readdir(absPath, { withFileTypes: true });
  const directories = dirents
    .filter((dirent) => dirent.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));
  const truncated = directories.length > MAX_DIRECTORY_ENTRIES;
  const visibleDirectories = directories.slice(0, MAX_DIRECTORY_ENTRIES);
  const entries: DirectoryBrowserEntry[] = visibleDirectories.map((dirent) => ({
    name: dirent.name,
    path: path.join(absPath, dirent.name),
    isDirectory: true,
    hidden: dirent.name.startsWith('.'),
  }));
  return {
    path: absPath,
    parent: path.dirname(absPath) === absPath ? null : path.dirname(absPath),
    breadcrumbs: buildBreadcrumbs(absPath),
    entries,
    truncated,
  };
}

export function registerFileHandlers(ipcMain: IpcMain, dialog: Dialog) {
  function resolvePath(event: Electron.IpcMainInvokeEvent, target: string): string {
    if (path.isAbsolute(target)) return target;
    const root = getSenderRoot(event) || process.cwd();
    return path.resolve(root, target);
  }

  async function openFolderAtPath(event: Electron.IpcMainInvokeEvent, folderPath: string): Promise<string> {
    const nextRoot = path.resolve(folderPath);
    const stat = await fs.stat(nextRoot);
    if (!stat.isDirectory()) {
      throw new Error('Dropped item is not a folder');
    }
    windowRoots.set(event.sender.id, nextRoot);
    return nextRoot;
  }

  function toEntry(event: Electron.IpcMainInvokeEvent, entryPath: string, name: string, isDir: boolean, stat?: { size: number; mtimeMs: number }): any {
    const root = getSenderRoot(event) || process.cwd();
    const relPath = path.relative(root, entryPath).replace(/\\/g, '/');
    return {
      name,
      path: relPath,
      isDirectory: isDir,
      size: stat?.size,
      modifiedAt: stat?.mtimeMs,
    };
  }

  ipcMain.handle('file:read', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    return fs.readFile(p, 'utf-8');
  });

  ipcMain.handle('file:readBuffer', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    const buffer = await fs.readFile(p);
    return buffer.toString('base64');
  });

  ipcMain.handle('file:write', async (event, filePath: string, content: string) => {
    const startMs = Date.now();
    const p = resolvePath(event, filePath);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf-8');
    log.info(`write done: ${content.length} chars, ${Date.now() - startMs}ms (IPC)`, { path: filePath, size: content.length });
  });

  ipcMain.handle('file:delete', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    await fs.unlink(p);
    log.info(`delete done (IPC)`, { path: filePath });
  });

  ipcMain.handle('file:readDir', async (event, dirPath: string) => {
    const p = resolvePath(event, dirPath);
    const entries = await fs.readdir(p, { withFileTypes: true });
    const result: any[] = [];
    for (const entry of entries) {
      const entryPath = path.join(p, entry.name);
      try {
        const stat = await fs.stat(entryPath);
        result.push(toEntry(event, entryPath, entry.name, entry.isDirectory(), stat));
      } catch {
        result.push(toEntry(event, entryPath, entry.name, entry.isDirectory()));
      }
    }
    result.sort((a: any, b: any) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return result;
  });

  ipcMain.handle('file:createDir', async (event, dirPath: string) => {
    const p = resolvePath(event, dirPath);
    await fs.mkdir(p, { recursive: true });
    log.info(`mkdir done (IPC)`, { path: dirPath });
  });

  ipcMain.handle('file:deleteDir', async (event, dirPath: string, recursive = true) => {
    const p = resolvePath(event, dirPath);
    await fs.rm(p, { recursive, force: true });
    log.info(`rmdir done (IPC)`, { path: dirPath, recursive });
  });

  ipcMain.handle('file:exists', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('file:stat', async (event, filePath: string) => {
    const p = resolvePath(event, filePath);
    const stat = await fs.stat(p);
    return toEntry(event, p, path.basename(p), stat.isDirectory(), stat);
  });

  ipcMain.handle('file:rename', async (event, oldPath: string, newPath: string) => {
    const startMs = Date.now();
    const src = resolvePath(event, oldPath);
    const dest = resolvePath(event, newPath);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    log.info(`rename done: ${Date.now() - startMs}ms (IPC)`, { oldPath, newPath });
  });

  ipcMain.handle('dialog:openFolder', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow!, {
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return openFolderAtPath(event, result.filePaths[0]);
  });

  ipcMain.handle('file:openFolderPath', async (event, folderPath: string) => {
    return openFolderAtPath(event, folderPath);
  });

  ipcMain.handle('picker:listDirectories', async (_event, rawPath?: string) => {
    return listDirectoriesForPicker(rawPath);
  });

  ipcMain.handle('picker:createDirectory', async (_event, parent: string, name: string) => {
    if (!isFullyQualifiedAbsolutePath(String(parent ?? ''))) {
      throw new Error(`Invalid parent path: ${parent}`);
    }
    validateSingleSegmentName(name);
    const target = path.join(parent, String(name).trim());
    await fs.mkdir(target, { recursive: false });
    return { name: String(name).trim(), path: target, isDirectory: true, hidden: String(name).trim().startsWith('.') };
  });

  ipcMain.handle('dialog:openFile', async (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(senderWindow!, {
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return { path: result.filePaths[0] };
  });

  ipcMain.handle('dialog:saveFile', async (event, filePath: string, content: string) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(senderWindow!, {
      defaultPath: filePath,
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, content, 'utf-8');
    return result.filePath;
  });
}
