import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  previewParam,
  buildApprovalLabel,
  requiresApproval,
  defaultDecision,
} from '../src/permission';
import { Agent } from '../src/agent';
import type { ILLMProvider } from '../src/types/provider';
import type { ITool } from '../src/types/tool';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };

describe('permission helpers', () => {
  it('previews and truncates long params', () => {
    expect(previewParam('short')).toBe('short');
    const long = 'x'.repeat(200);
    const p = previewParam(long, 10);
    expect(p.startsWith('xxxxxxxxxx')).toBe(true);
    expect(p).toContain('200 chars');
  });

  it('builds readable labels', () => {
    expect(buildApprovalLabel('bash', { command: 'ls -la' })).toContain('bash');
    expect(buildApprovalLabel('file_write', { path: 'a.txt', content: 'y'.repeat(50) })).toContain('a.txt');
    expect(buildApprovalLabel('file_write', { path: 'a.txt', content: 'y'.repeat(50) })).toContain('chars');
  });

  it('requiresApproval matrix', () => {
    const ro = { name: 'read_file', readOnlyHint: true };
    const write = { name: 'file_write', readOnlyHint: false, destructiveHint: false };
    const bash = { name: 'bash', readOnlyHint: false, destructiveHint: true };

    expect(requiresApproval(ro, 'suggest')).toBe(false);
    expect(requiresApproval(write, 'suggest')).toBe(true);
    expect(requiresApproval(bash, 'suggest')).toBe(true);
    expect(requiresApproval(write, 'auto-edit')).toBe(false);
    expect(requiresApproval(bash, 'auto-edit')).toBe(true);
    expect(requiresApproval(write, 'full-auto')).toBe(false);
    expect(requiresApproval(bash, 'full-auto')).toBe(false);
  });

  it('defaultDecision without approver', () => {
    expect(defaultDecision('suggest')).toBe('deny');
    expect(defaultDecision('auto-edit')).toBe('deny');
    expect(defaultDecision('full-auto')).toBe('allow');
  });
});

function xmlWriteProvider(): ILLMProvider {
  let n = 0;
  return {
    async chat() {
      n += 1;
      return n === 1
        ? `<file_write path="p.txt">hello</file_write>`
        : 'ok';
    },
    async chatStream() {
      return 'ok';
    },
  };
}

describe('Agent permission gate', () => {
  let tmp: string;
  beforeAll(async () => {
    tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ow-perm-'));
  });
  afterAll(async () => {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  });

  const baseCfg = (mode: 'suggest' | 'auto-edit' | 'full-auto'): AgentConfig => ({
    mode: 'build',
    enableBash: false,
    toolProtocol: 'xml',
    permissionMode: mode,
  });

  it('suggest without approver denies write', async () => {
    const agent = new Agent(def, baseCfg('suggest'), tmp, undefined, {
      provider: xmlWriteProvider(),
      toolProtocol: 'xml',
      permissionMode: 'suggest',
    });
    const result = await agent.execute([{ role: 'user', content: 'write' }]);
    expect(result.content).toContain('User denied');
    expect(fs.existsSync(path.join(tmp, 'p.txt'))).toBe(false);
  });

  it('suggest with allow approver writes file', async () => {
    const agent = new Agent(def, baseCfg('suggest'), tmp, undefined, {
      provider: xmlWriteProvider(),
      toolProtocol: 'xml',
      permissionMode: 'suggest',
      approver: () => 'allow',
    });
    const result = await agent.execute([{ role: 'user', content: 'write' }]);
    expect(result.content).not.toContain('User denied');
    expect(fs.existsSync(path.join(tmp, 'p.txt'))).toBe(true);
    await fs.promises.rm(path.join(tmp, 'p.txt'), { force: true });
  });

  it('full-auto without approver allows write', async () => {
    const agent = new Agent(def, baseCfg('full-auto'), tmp, undefined, {
      provider: xmlWriteProvider(),
      toolProtocol: 'xml',
      permissionMode: 'full-auto',
    });
    await agent.execute([{ role: 'user', content: 'write' }]);
    expect(fs.existsSync(path.join(tmp, 'p.txt'))).toBe(true);
  });
});
