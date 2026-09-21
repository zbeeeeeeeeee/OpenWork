import { describe, it, expect } from 'vitest';
import {
  Agent,
  DEFAULT_AGENT_MAX_TURNS,
  ABSOLUTE_MAX_TURNS,
  resolveMaxTurns,
} from '../src/agent';
import type { ILLMProvider, ChatWithToolsResult } from '../src/types/provider';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };

function xmlAlwaysToolsProvider(toolName = 'list_dir'): ILLMProvider {
  return {
    async chat() {
      return `<${toolName} path="."/>`;
    },
    async chatStream() {
      return `<${toolName} path="."/>`;
    },
  };
}

function fcAlwaysToolsProvider(): ILLMProvider {
  const step = (): ChatWithToolsResult => ({
    content: '',
    toolCalls: [
      { id: 'c', name: 'list_dir', arguments: JSON.stringify({ path: '.' }) },
    ],
    finishReason: 'tool_calls',
  });
  return {
    async chat() {
      return '';
    },
    async chatWithTools() {
      return step();
    },
    async chatStream() {
      return '';
    },
    async chatStreamWithTools(_m, _t, onChunk) {
      onChunk('content', '');
      return step();
    },
  };
}

describe('resolveMaxTurns', () => {
  it('defaults and clamps', () => {
    expect(resolveMaxTurns(undefined)).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(resolveMaxTurns(0)).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(resolveMaxTurns(-1)).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(resolveMaxTurns(Number.NaN)).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(resolveMaxTurns(3)).toBe(3);
    expect(resolveMaxTurns(999)).toBe(ABSOLUTE_MAX_TURNS);
  });
});

describe('Agent maxTurns', () => {
  const cfg = (maxTurns?: number, protocol: 'xml' | 'fc' = 'xml'): AgentConfig => ({
    mode: 'build',
    enableBash: false,
    toolProtocol: protocol,
    ...(maxTurns !== undefined ? {} : {}),
  });

  it('XML stops at default 20 and marks max_turns', async () => {
    const agent = new Agent(
      { ...def },
      cfg(),
      process.cwd(),
      undefined,
      { provider: xmlAlwaysToolsProvider(), toolProtocol: 'xml' },
    );
    const result = await agent.execute([{ role: 'user', content: 'loop' }]);
    expect(result.turns).toBe(DEFAULT_AGENT_MAX_TURNS);
    expect(result.stopReason).toBe('max_turns');
    expect(result.content).toContain('已达到最大轮次');
    expect(result.content.match(/已达到最大轮次/g)).toHaveLength(1);
  });

  it('respects explicit maxTurns=3', async () => {
    const agent = new Agent(
      { ...def, maxTurns: 3 },
      cfg(3),
      process.cwd(),
      undefined,
      { provider: xmlAlwaysToolsProvider(), toolProtocol: 'xml' },
    );
    const result = await agent.execute([{ role: 'user', content: 'loop' }]);
    expect(result.turns).toBe(3);
    expect(result.stopReason).toBe('max_turns');
  });

  it('clamps maxTurns=999 to absolute cap', async () => {
    const agent = new Agent(
      { ...def, maxTurns: 999 },
      cfg(999),
      process.cwd(),
      undefined,
      { provider: xmlAlwaysToolsProvider(), toolProtocol: 'xml' },
    );
    const result = await agent.execute([{ role: 'user', content: 'loop' }]);
    expect(result.turns).toBe(ABSOLUTE_MAX_TURNS);
    expect(result.stopReason).toBe('max_turns');
  });

  it('FC uses same maxTurns policy', async () => {
    const agent = new Agent(
      { ...def, maxTurns: 4 },
      cfg(4, 'fc'),
      process.cwd(),
      undefined,
      { provider: fcAlwaysToolsProvider(), toolProtocol: 'fc' },
    );
    const result = await agent.execute([{ role: 'user', content: 'loop' }]);
    expect(result.turns).toBe(4);
    expect(result.stopReason).toBe('max_turns');
    expect(result.content).toContain('已达到最大轮次');
  });

  it('normal stop has no max_turns note', async () => {
    const provider: ILLMProvider = {
      async chat() {
        return 'hello done';
      },
      async chatStream() {
        return 'hello done';
      },
    };
    const agent = new Agent(def, cfg(), process.cwd(), undefined, {
      provider,
      toolProtocol: 'xml',
    });
    const result = await agent.execute([{ role: 'user', content: 'hi' }]);
    expect(result.turns).toBe(1);
    expect(result.stopReason).toBe('stop');
    expect(result.content).not.toContain('已达到最大轮次');
  });
});
