import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Agent } from '../src/agent';
import type { ILLMProvider, ChatWithToolsResult } from '../src/types/provider';
import type { AgentEvent } from '../src/agent';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';
import type { FileChangeMeta } from '../src/types/tool';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };

let tmp: string;

beforeAll(async () => {
  tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ow-fc-refresh-'));
});
afterAll(async () => {
  await fs.promises.rm(tmp, { recursive: true, force: true });
});

/** 模拟前端「读盘 → 替换 Tab 内容」：与 useFileSystem.reloadTabsForPaths 策略一致 */
function applyTabReload(
  tabs: Array<{ id: string; path: string; content: string; originalContent: string; isDirty: boolean; isUntitled: boolean }>,
  diskFiles: Record<string, string>,
  changedPaths: string[],
): string[] {
  const reloaded: string[] = [];
  for (const p of changedPaths) {
    const tab = tabs.find((t) => t.path === p || t.path.endsWith(`/${p}`) || t.path.endsWith(`\\${p}`));
    if (!tab || tab.isUntitled || tab.isDirty) continue;
    if (!(p in diskFiles) && !(tab.path in diskFiles)) continue;
    const content = diskFiles[p] ?? diskFiles[tab.path] ?? '';
    tab.content = content;
    tab.originalContent = content;
    tab.isDirty = false;
    reloaded.push(tab.path);
  }
  return reloaded;
}

describe('file_changed → editor refresh pipeline', () => {
  it('stream FC write emits fileChanges and disk matches reload source', async () => {
    const fileName = 'refresh-me.txt';
    const abs = path.join(tmp, fileName);
    // 模拟已打开 Tab，内容为旧值
    const tabs = [
      {
        id: 't1',
        path: fileName,
        content: 'old-content',
        originalContent: 'old-content',
        isDirty: false,
        isUntitled: false,
      },
    ];

    let call = 0;
    const provider: ILLMProvider = {
      async chat() {
        return '';
      },
      async chatStream() {
        return '';
      },
      async chatWithTools(): Promise<ChatWithToolsResult> {
        call += 1;
        if (call === 1) {
          return {
            content: '',
            toolCalls: [
              {
                id: 'c1',
                name: 'file_write',
                arguments: JSON.stringify({ path: fileName, content: 'new-from-agent\nDONE\n' }),
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        return { content: 'written', toolCalls: [], finishReason: 'stop' };
      },
      async chatStreamWithTools(_m, _t, onChunk) {
        call += 1;
        if (call === 1) {
          onChunk('content', 'Writing…');
          return {
            content: 'Writing…',
            toolCalls: [
              {
                id: 'c1',
                name: 'file_write',
                arguments: JSON.stringify({ path: fileName, content: 'new-from-agent\nDONE\n' }),
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        onChunk('content', 'written');
        return { content: 'written', toolCalls: [], finishReason: 'stop' };
      },
    };

    const cfg: AgentConfig = {
      mode: 'build',
      enableBash: false,
      toolProtocol: 'fc',
      permissionMode: 'full-auto',
    };

    const agent = new Agent(def, cfg, tmp, undefined, {
      provider,
      toolProtocol: 'fc',
      permissionMode: 'full-auto',
    });

    const toolEnds: AgentEvent[] = [];
    const allFileChanges: FileChangeMeta[] = [];
    const changedPaths = new Set<string>();

    await agent.executeStream(
      [{ role: 'user', content: 'write file' }],
      (e) => {
        if (e.type === 'tool_end') toolEnds.push(e);
        if (e.fileChanges?.length) {
          for (const fc of e.fileChanges) {
            allFileChanges.push(fc);
            changedPaths.add(fc.path);
          }
        }
      },
    );

    // 1) Agent 事件带 fileChanges
    expect(allFileChanges.length).toBeGreaterThan(0);
    expect(allFileChanges[0]!.path).toBe(fileName);
    expect(toolEnds[0]?.fileChanges?.[0]?.path).toBe(fileName);

    // 2) 磁盘已更新
    const onDisk = await fs.promises.readFile(abs, 'utf-8');
    expect(onDisk).toContain('new-from-agent');

    // 3) 模拟 SSE file_changed.paths → 前端 reload
    const paths = Array.from(changedPaths);
    expect(paths).toEqual([fileName]);

    const reloaded = applyTabReload(tabs, { [fileName]: onDisk }, paths);
    expect(reloaded).toEqual([fileName]);
    expect(tabs[0]!.content).toContain('new-from-agent');
    expect(tabs[0]!.isDirty).toBe(false);
  });

  it('skips reload when tab is dirty (protect user edits)', () => {
    const tabs = [
      {
        id: 't1',
        path: 'a.txt',
        content: 'user-edit',
        originalContent: 'disk',
        isDirty: true,
        isUntitled: false,
      },
    ];
    const reloaded = applyTabReload(tabs, { 'a.txt': 'agent-disk' }, ['a.txt']);
    expect(reloaded).toEqual([]);
    expect(tabs[0]!.content).toBe('user-edit');
  });
});
