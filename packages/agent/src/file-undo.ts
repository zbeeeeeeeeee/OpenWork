import { promises as fs, existsSync } from 'fs';
import * as path from 'path';
import { resolvePath } from './tools/_shared/path';
import { createLogger } from './logger';
import { LOG_CATEGORY } from './log-categories';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

/** 单次写盘前的备份（相对 workspace 路径） */
export interface FileUndoEntry {
  path: string;
  /** 写之前文件是否已存在 */
  existed: boolean;
  /** 写之前内容；新文件为 null */
  previousContent: string | null;
  createdAt: number;
  /** 该备份占用的估算字节 */
  bytes: number;
}

export const UNDO_MAX_ENTRIES = 20;
export const UNDO_MAX_BYTES = 2 * 1024 * 1024; // 2MB

/**
 * 会话级 Agent 写盘撤销栈。
 * 仅内存；大文件备份跳过（bytes 超限则不入栈）。
 */
export class FileUndoStack {
  private entries: FileUndoEntry[] = [];
  private totalBytes = 0;

  push(entry: FileUndoEntry): void {
    const bytes = entry.bytes;
    if (bytes > UNDO_MAX_BYTES) {
      log.warn(`undo: skip backup too large (${bytes} bytes): ${entry.path}`, { path: entry.path, bytes });
      return;
    }
    this.entries.push(entry);
    this.totalBytes += bytes;
    while (
      this.entries.length > UNDO_MAX_ENTRIES ||
      this.totalBytes > UNDO_MAX_BYTES
    ) {
      const dropped = this.entries.shift();
      if (!dropped) break;
      this.totalBytes -= dropped.bytes;
    }
  }

  peek(): FileUndoEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries = [];
    this.totalBytes = 0;
  }

  /**
   * 撤销最近一次写盘。返回恢复的路径与结果。
   * 文件在写后被用户改过（内容 ≠ Agent 写入结果）时：仍恢复备份，并标 conflicted。
   * （简化策略：不检测 mtime 冲突，只恢复；后续可增强。）
   */
  async undoLast(workspaceRoot: string): Promise<
    | { ok: true; path: string; existed: boolean; bytes: number }
    | { ok: false; reason: string }
  > {
    const entry = this.entries.pop();
    if (!entry) return { ok: false, reason: 'undo stack empty' };
    this.totalBytes -= entry.bytes;

    let abs: string;
    try {
      abs = resolvePath(workspaceRoot, entry.path);
    } catch (e: any) {
      return { ok: false, reason: `invalid path: ${e.message}` };
    }

    try {
      if (!entry.existed || entry.previousContent === null) {
        // Agent 新建的文件 → 删除
        if (existsSync(abs)) {
          await fs.rm(abs, { force: true });
        }
      } else {
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, entry.previousContent, 'utf-8');
      }
      log.info(`undo restored: ${entry.path}`, {
        path: entry.path,
        existed: entry.existed,
        bytes: entry.bytes,
      });
      return { ok: true, path: entry.path, existed: entry.existed, bytes: entry.bytes };
    } catch (e: any) {
      // 恢复失败：不回推栈（避免死循环），返回错误
      log.error(`undo failed for ${entry.path}: ${e.message}`, { path: entry.path, error: e.message });
      return { ok: false, reason: e.message };
    }
  }
}
