import { describe, it, expect } from 'vitest';
import { SessionMemory } from '../src/memory/SessionMemory';
import type { ToolCallRecord } from '../src/memory/types';

const toolCall = (over: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  type: 'file_edit',
  params: { path: 'src/a.ts' },
  result: '## File edited: src/a.ts',
  durationMs: 42,
  agentId: 'main',
  ...over,
});

describe('SessionMemory', () => {
  it('appends entries with ids and timestamps', () => {
    const m = new SessionMemory('s1');
    const e = m.appendUserMessage('hello');
    expect(e.id).toBeTruthy();
    expect(e.sessionId).toBe('s1');
    expect(e.role).toBe('user');
    expect(e.timestamp).toBeGreaterThan(0);
    expect(m.size).toBe(1);
  });

  it('setTokenBudget clamps to minimum of 1024', () => {
    const m = new SessionMemory('s1');
    m.setTokenBudget(1);
    expect(m.getEntries()).toBeDefined();
    // 通过滑窗行为验证 clamp:预算 1 -> 1024,小消息仍可容纳
    m.appendUserMessage('hi');
    m.appendUserMessage('there');
    const msgs = m.projectToLLMMessages('sys', undefined, '/ws', undefined, 'now');
    expect(msgs.at(-1)).toEqual({ role: 'user', content: 'now' });
    expect(msgs.filter(x => x.content === 'hi')).toHaveLength(1);
  });

  describe('projectToDisplay', () => {
    it('groups assistant thinking + response + tool call into blocks', () => {
      const m = new SessionMemory('s1');
      m.appendUserMessage('fix it');
      m.appendAssistantMessage({ content: 'ok', thinking: 'step by step' });
      m.appendToolResult(toolCall());
      const out = m.projectToDisplay();
      expect(out).toHaveLength(3);
      const asst = out.find(x => x.role === 'assistant' && x.content === 'ok')!;
      expect(asst.thinking).toBe('step by step');
      expect(asst.blocks.map(b => b.type)).toEqual(['thinking', 'response']);
      const toolMsg = out.find(x => x.blocks.some(b => b.type === 'tool_call'))!;
      expect(toolMsg.blocks[0]).toMatchObject({
        type: 'tool_call',
        toolType: 'file_edit',
        toolLabel: 'src/a.ts',
        completed: true,
      });
    });

    it('marks failed tool results with error flag', () => {
      const m = new SessionMemory('s1');
      m.appendToolResult(toolCall({ result: 'Error: not found' }));
      const block = m.projectToDisplay()[0]!.blocks[0] as { error?: boolean };
      expect(block.error).toBe(true);
    });
  });

  describe('projectToLLMMessages sliding window', () => {
    it('keeps system sections and drops oldest history when over budget', () => {
      const m = new SessionMemory('s1');
      m.setTokenBudget(1024);
      for (let i = 0; i < 30; i++) {
        m.appendUserMessage(`message number ${i} `.repeat(80));
      }
      const msgs = m.projectToLLMMessages('SYSTEM PROMPT', 'TOOLS', '/ws', undefined, 'current');
      expect(msgs[0]).toEqual({ role: 'system', content: 'SYSTEM PROMPT' });
      expect(msgs[1]).toEqual({ role: 'system', content: 'TOOLS' });
      expect(msgs[2]).toEqual({ role: 'system', content: '## Workspace Root\n/ws' });
      expect(msgs.at(-1)).toEqual({ role: 'user', content: 'current' });
      const history = msgs.slice(3, -1);
      expect(history.length).toBeLessThan(30);
      // 丢最旧:第一条消息不该在历史里
      expect(history.some(x => x.content.includes('message number 0'))).toBe(false);
    });

    it('restores tool entries as assistant call + user result pair', () => {
      const m = new SessionMemory('s1');
      m.appendUserMessage('q');
      m.appendToolResult(toolCall());
      const msgs = m.projectToLLMMessages('sys', undefined, '/ws', undefined, 'now');
      const pair = msgs.filter(x => x.content.includes('Tool result'));
      expect(pair).toHaveLength(1);
      expect(pair[0]!.content).toContain('file_edit');
      const assistant = msgs.find(x => x.content.includes('[Tool call: file_edit'));
      expect(assistant).toBeTruthy();
    });

    it('includes IDE snapshot blocks and active file content', () => {
      const m = new SessionMemory('s1');
      m.appendUserMessage('q');
      const msgs = m.projectToLLMMessages('sys', undefined, '/ws', {
        activeFile: { path: 'src/a.ts', content: 'export const a = 1;' },
        openFilePaths: ['src/a.ts', 'src/b.ts'],
        fileTree: ['src/', 'src/a.ts'],
        cursorPosition: { file: 'src/a.ts', line: 3, column: 5 },
      }, 'now');
      const joined = msgs.map(x => x.content).join('\n');
      expect(joined).toContain('## Other Open Tabs');
      expect(joined).toContain('src/b.ts');
      expect(joined).toContain('## Active File: src/a.ts');
      expect(joined).toContain('## Cursor Position: src/a.ts:3:5');
    });
  });

  describe('serialize / deserialize', () => {
    it('roundtrips entries', () => {
      const m = new SessionMemory('s1');
      m.appendUserMessage('q');
      m.appendAssistantMessage({ content: 'a', thinking: 'step by step reasoning' });
      const data = m.serialize();
      expect(data.schemaVersion).toBe(1);
      expect(data.entries).toHaveLength(2);

      const m2 = new SessionMemory('s1');
      m2.deserialize(data);
      expect(m2.size).toBe(2);
      expect(m2.projectToDisplay()[1]).toMatchObject({ role: 'assistant', thinking: 'step by step reasoning' });
    });

    it('starts fresh on invalid data', () => {
      const m = new SessionMemory('s1');
      m.appendUserMessage('q');
      m.deserialize({ schemaVersion: 99, entries: [] });
      expect(m.size).toBe(0);
      m.deserialize(null);
      expect(m.size).toBe(0);
    });

    it('filters malformed entries', () => {
      const m = new SessionMemory('s1');
      m.deserialize({ schemaVersion: 1, entries: [{ id: 'x', content: 42 }, { id: 'y' }, { id: 'z', content: 'ok' }] });
      expect(m.size).toBe(1);
    });
  });
});
