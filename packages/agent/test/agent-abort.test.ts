import { describe, it, expect } from 'vitest';
import { Agent, isAbortError } from '../src/agent';
import type { ILLMProvider, ChatWithToolsResult } from '../src/types/provider';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };

describe('isAbortError', () => {
  it('detects AbortError names and messages', () => {
    const a = new Error('x');
    a.name = 'AbortError';
    expect(isAbortError(a)).toBe(true);
    const b = new Error('Request was aborted.');
    expect(isAbortError(b)).toBe(true);
    expect(isAbortError(new Error('network down'))).toBe(false);
  });
});

describe('Agent abort', () => {
  it('XML stream stops between turns after abort', async () => {
    const ac = new AbortController();
    let calls = 0;
    const provider: ILLMProvider = {
      async chat() {
        return '';
      },
      async chatStream() {
        calls += 1;
        if (calls === 1) {
          ac.abort();
          return `<list_dir path="."/>`;
        }
        return 'should-not-run';
      },
    };
    const agent = new Agent(
      def,
      { mode: 'build', enableBash: false, toolProtocol: 'xml' },
      process.cwd(),
      undefined,
      { provider, toolProtocol: 'xml' },
    );
    const result = await agent.executeStream(
      [{ role: 'user', content: 'go' }],
      undefined,
      undefined,
      ac.signal,
    );
    // 第一轮工具执行后，下一轮会先查 aborted
    expect(result.stopReason).toBe('aborted');
    expect(result.content).toContain('已取消');
    expect(calls).toBe(1);
  });

  it('abort errors do not increment FC fail streak', async () => {
    let failWithAbort = 0;
    const provider: ILLMProvider = {
      async chat() {
        return 'xml';
      },
      async chatWithTools(): Promise<ChatWithToolsResult> {
        failWithAbort += 1;
        if (failWithAbort <= 2) {
          const e = new Error('The operation was aborted.');
          e.name = 'AbortError';
          throw e;
        }
        return { content: 'ok-fc', toolCalls: [], finishReason: 'stop' };
      },
      async chatStream() {
        return '';
      },
    };
    const agent = new Agent(
      def,
      { mode: 'build', enableBash: false, toolProtocol: 'fc' },
      process.cwd(),
      undefined,
      { provider, toolProtocol: 'fc' },
    );
    const r1 = await agent.execute([{ role: 'user', content: 'a' }]);
    expect(r1.stopReason).toBe('aborted');
    const r2 = await agent.execute([{ role: 'user', content: 'b' }]);
    expect(r2.stopReason).toBe('aborted');
    // 两次 abort 后仍应走 FC，未降级 XML
    const r3 = await agent.execute([{ role: 'user', content: 'c' }]);
    expect(r3.content).toBe('ok-fc');
    expect(r3.stopReason).toBe('stop');
  });

  it('skips tool execution when already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    let executed = false;
    const agent = new Agent(
      def,
      { mode: 'build', enableBash: false, toolProtocol: 'xml' },
      process.cwd(),
      undefined,
      {
        provider: {
          async chat() {
            return `<list_dir path="."/>`;
          },
          async chatStream() {
            return `<list_dir path="."/>`;
          },
        },
        toolProtocol: 'xml',
      },
    );
    // 在 execute 前已 abort → 第一轮 chat 前就停
    const result = await agent.execute([{ role: 'user', content: 'x' }], undefined, undefined, ac.signal);
    expect(result.stopReason).toBe('aborted');
    expect(executed).toBe(false);
  });
});
