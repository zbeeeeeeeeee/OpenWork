import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileEditTool } from '../src/tools/file-edit/FileEditTool';
import { FileWriteTool } from '../src/tools/file-write/FileWriteTool';
import { lineNumberOfOffset, buildEditHunk } from '../src/tools/_shared/file-change';
import { normalizePathKey } from '../src/tools/_shared/path';
import type { FileChangeMeta } from '../src/types/tool';

let tmp: string;

beforeAll(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ow-fc-meta-'));
});
afterAll(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

describe('file-change helpers', () => {
  it('computes 1-based line numbers', () => {
    expect(lineNumberOfOffset('a\nb\nc', 0)).toBe(1);
    expect(lineNumberOfOffset('a\nb\nc', 2)).toBe(2);
    expect(lineNumberOfOffset('a\nb\nc', 4)).toBe(3);
  });

  it('builds edit hunks with truncated text', () => {
    const oldT = 'x'.repeat(5000);
    const h = buildEditHunk(`head\n${oldT}\ntail`, oldT, 'NEW', 5);
    expect(h.oldStart).toBe(2);
    expect(h.newText).toBe('NEW');
    expect(h.oldText!.length).toBeLessThan(5000);
    expect(h.oldText).toContain('truncated');
  });
});

describe('file tools report fileChanges', () => {
  it('file_write reports create', async () => {
    const changes: FileChangeMeta[] = [];
    const tool = new FileWriteTool();
    await tool.execute(
      { path: 'hello.txt', content: 'line1\nline2' },
      { workspaceRoot: tmp, onFileChange: (m) => changes.push(m) },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('create');
    expect(changes[0]!.path).toBe('hello.txt');
    expect(changes[0]!.newSize).toBeGreaterThan(0);
    expect(changes[0]!.hunks?.[0]?.newLines).toBe(2);
  });

  it('file_edit reports edit hunk', async () => {
    const file = path.join(tmp, 'edit-me.txt');
    await fs.promises.writeFile(file, 'alpha\nbeta\ngamma\n', 'utf-8');
    const key = normalizePathKey(file);
    const changes: FileChangeMeta[] = [];
    const tool = new FileEditTool();
    const text = await tool.execute(
      { path: 'edit-me.txt', old: 'beta', new: 'BETA' },
      {
        workspaceRoot: tmp,
        readFileState: new Set([key]),
        onFileChange: (m) => changes.push(m),
      },
    );
    expect(text).toContain('File edited');
    expect(changes).toHaveLength(1);
    expect(changes[0]!.kind).toBe('edit');
    expect(changes[0]!.hunks?.[0]?.oldStart).toBe(2);
    expect(changes[0]!.hunks?.[0]?.newText).toBe('BETA');
    expect(fs.readFileSync(file, 'utf-8')).toContain('BETA');
  });
});
