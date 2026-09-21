import { describe, it, expect } from 'vitest';
import {
  lookupModelCapabilities,
  resolveToolProtocol,
} from '../src/llm/model-capabilities';
import { Agent } from '../src/agent';
import type { ILLMProvider, ChatWithToolsResult } from '../src/types/provider';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };

describe('lookupModelCapabilities', () => {
  it('knows deepseek-chat and blocks deepseek-reasoner', () => {
    expect(lookupModelCapabilities('deepseek-chat')?.functionCalling).toBe(true);
    expect(lookupModelCapabilities('deepseek-reasoner')?.functionCalling).toBe(false);
  });

  it('knows moonshot/kimi and returns null for unknown', () => {
    expect(lookupModelCapabilities('moonshot-v1-8k')?.functionCalling).toBe(true);
    expect(lookupModelCapabilities('kimi-latest')?.functionCalling).toBe(true);
    expect(lookupModelCapabilities('totally-unknown-model')).toBeNull();
    expect(lookupModelCapabilities(undefined)).toBeNull();
  });
});

describe('resolveToolProtocol', () => {
  it('respects explicit xml and fc', () => {
    expect(resolveToolProtocol({ requested: 'xml', hasChatWithTools: true })).toBe('xml');
    expect(resolveToolProtocol({ requested: 'fc', hasChatWithTools: false })).toBe('fc');
  });

  it('auto + capability false → xml even if provider supports tools', () => {
    expect(
      resolveToolProtocol({
        requested: 'auto',
        model: 'deepseek-reasoner',
        hasChatWithTools: true,
      }),
    ).toBe('xml');
  });

  it('auto + known true + hasChatWithTools → fc', () => {
    expect(
      resolveToolProtocol({
        requested: 'auto',
        model: 'deepseek-chat',
        hasChatWithTools: true,
      }),
    ).toBe('fc');
  });

  it('auto + unknown model + hasChatWithTools → fc (probe)', () => {
    expect(
      resolveToolProtocol({
        requested: 'auto',
        model: 'some-new-model',
        hasChatWithTools: true,
      }),
    ).toBe('fc');
  });

  it('explicit capabilities override presets', () => {
    expect(
      resolveToolProtocol({
        requested: 'auto',
        model: 'deepseek-chat',
        capabilities: { functionCalling: false },
        hasChatWithTools: true,
      }),
    ).toBe('xml');
  });
});

function failingThenOkProvider(failTimes: number): ILLMProvider {
  let fails = 0;
  const ok: ChatWithToolsResult = {
    content: 'ok via fc',
    toolCalls: [],
    finishReason: 'stop',
  };
  return {
    async chat() {
      return 'xml-path-text';
    },
    async chatWithTools(): Promise<ChatWithToolsResult> {
      if (fails < failTimes) {
        fails += 1;
        throw new Error('tools not supported');
      }
      return ok;
    },
    async chatStream() {
      return 'xml-stream';
    },
    async chatStreamWithTools(_m, _t, onChunk) {
      if (fails < failTimes) {
        fails += 1;
        throw new Error('stream tools not supported');
      }
      onChunk('content', 'ok via fc');
      return ok;
    },
  };
}

describe('Agent FC auto-fallback', () => {
  const cfg = (over?: Partial<AgentConfig>): AgentConfig => ({
    mode: 'build',
    enableBash: false,
    toolProtocol: 'auto',
    ...over,
  });

  it('stays on xml when capability says no tools', async () => {
    const provider = failingThenOkProvider(0);
    const agent = new Agent(def, cfg({ model: 'deepseek-reasoner' }), process.cwd(), undefined, {
      provider,
      toolProtocol: 'auto',
    });
    const result = await agent.execute([{ role: 'user', content: 'hi' }]);
    expect(result.content).toContain('xml-path-text');
  });

  it('falls back to xml after two consecutive FC failures', async () => {
    const provider = failingThenOkProvider(2);
    const agent = new Agent(def, cfg({ model: 'deepseek-chat' }), process.cwd(), undefined, {
      provider,
      toolProtocol: 'auto',
    });

    await expect(agent.execute([{ role: 'user', content: 'a' }])).rejects.toThrow(
      /tools not supported/,
    );
    await expect(agent.execute([{ role: 'user', content: 'b' }])).rejects.toThrow(
      /tools not supported/,
    );

    // 第三次：已降级，不再调 chatWithTools
    const result = await agent.execute([{ role: 'user', content: 'c' }]);
    expect(result.content).toContain('xml-path-text');
  });

  it('resets streak after success and stays on fc', async () => {
    const provider = failingThenOkProvider(1);
    const agent = new Agent(def, cfg({ model: 'deepseek-chat' }), process.cwd(), undefined, {
      provider,
      toolProtocol: 'auto',
    });
    await expect(agent.execute([{ role: 'user', content: 'a' }])).rejects.toThrow();
    const ok1 = await agent.execute([{ role: 'user', content: 'b' }]);
    expect(ok1.content).toBe('ok via fc');
    const ok2 = await agent.execute([{ role: 'user', content: 'c' }]);
    expect(ok2.content).toBe('ok via fc');
  });
});
