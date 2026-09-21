import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { promises as fsp } from 'fs';
import { AgentRuntime } from '../src/runtime';

describe('AgentRuntime.createDefaultFS path safety', () => {
  let tmpRoot: string;
  let runtime: AgentRuntime;

  beforeAll(async () => {
    tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'openwork-fs-'));
    runtime = new AgentRuntime({
      mode: 'build',
      provider: {},
      workspaceRoot: tmpRoot,
      enableBash: false,
    });
    await fsp.writeFile(path.join(tmpRoot, 'hello.txt'), 'hi', 'utf-8');
  });

  afterAll(async () => {
    await runtime.dispose();
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });

  it('reads files inside workspace root', async () => {
    await expect(runtime.fileSystem.readFile('hello.txt')).resolves.toBe('hi');
  });

  it('rejects parent-directory traversal', async () => {
    await expect(runtime.fileSystem.readFile(path.join('..', 'secret'))).rejects.toThrow(
      /Path traversal not allowed/,
    );
  });

  it('writeFile also enforces traversal check', async () => {
    await expect(
      runtime.fileSystem.writeFile(path.join('..', 'evil.txt'), 'x'),
    ).rejects.toThrow(/Path traversal not allowed/);
  });

  it('list dir works under root', async () => {
    const entries = await runtime.fileSystem.readDir('.');
    expect(entries.some((e) => e.name === 'hello.txt')).toBe(true);
  });
});
