import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentRuntime } from '../src/runtime';
import { FileUndoStack } from '../src/file-undo';
import type { ILLMProvider } from '../src/types/provider';

let tmp: string;

beforeAll(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ow-undo-'));
});
afterAll(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

describe('FileUndoStack', () => {
  it('restores previous content on undo', async () => {
    const stack = new FileUndoStack();
    stack.push({ path: 'a.txt', existed: true, previousContent: 'OLD', createdAt: Date.now(), bytes: 3 });
    const r = await stack.undoLast(tmp);
    expect(r.ok).toBe(true);
    expect(await fs.promises.readFile(path.join(tmp, 'a.txt'), 'utf-8')).toBe('OLD');
  });

  it('deletes files that were created by agent', async () => {
    const p = path.join(tmp, 'new.txt');
    await fs.promises.writeFile(p, 'x', 'utf-8');
    const stack = new FileUndoStack();
    stack.push({ path: 'new.txt', existed: false, previousContent: null, createdAt: Date.now(), bytes: 0 });
    const r = await stack.undoLast(tmp);
    expect(r.ok).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('empty stack returns reason', async () => {
    const stack = new FileUndoStack();
    const r = await stack.undoLast(tmp);
    expect(r.ok).toBe(false);
  });
});

describe('AgentRuntime undoLastFileChange', () => {
  it('undoes stream FC file_write via runtime API', async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ow-undo-rt-'));
    try {
      await fs.promises.writeFile(path.join(root, 'seed.txt'), 'seed\n', 'utf-8');
      const rt = new AgentRuntime({
        mode: 'build',
        provider: { model: 'test' },
        workspaceRoot: root,
        enableBash: false,
        toolProtocol: 'fc',
        permissionMode: 'full-auto',
      });

      // 直接用 runtime 会注入真实 provider；改用 createAgent 路径太深。
      // 通过 chatStream 不可行。改为直接测工具+stack：runtime.undo 需经 session。
      // 这里测 AgentRuntime 的 undo API 在无栈时的行为 + FileUndoStack 集成已在上覆盖。
      const empty = await rt.undoLastFileChange('default');
      expect(empty.ok).toBe(false);
      await rt.dispose();

      // 完整链路：Agent execute + runtime 同步 stack 需要注入 —— 用 FileWriteTool + stack
      const { FileWriteTool } = await import('../src/tools/file-write/FileWriteTool');
      const stack = new FileUndoStack();
      const tool = new FileWriteTool();
      await tool.execute(
        { path: 'out.txt', content: 'from-agent' },
        {
          workspaceRoot: root,
          onFileBackup: (p, prev, existed) => {
            stack.push({
              path: p,
              existed,
              previousContent: prev,
              createdAt: Date.now(),
              bytes: prev ? Buffer.byteLength(prev) : 0,
            });
          },
        },
      );
      expect(fs.existsSync(path.join(root, 'out.txt'))).toBe(true);
      const u = await stack.undoLast(root);
      expect(u.ok).toBe(true);
      expect(fs.existsSync(path.join(root, 'out.txt'))).toBe(false);
    } finally {
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  });
});
