import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent';
import type { ILLMProvider, ChatWithToolsResult } from '../src/types/provider';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';

const def: AgentDefinition = {
  id: 'main',
  name: 'Main',
  systemPrompt: 'sys',
};

const baseConfig: AgentConfig = {
  mode: 'build',
  enableBash: false,
  toolProtocol: 'fc',
};

function mockProvider(sequenced: ChatWithToolsResult[]): ILLMProvider {
  let i = 0;
  return {
    async chat() {
      return 'xml-should-not-be-used';
    },
    async chatWithTools(): Promise<ChatWithToolsResult> {
      const step = sequenced[Math.min(i, sequenced.length - 1)]!;
      i += 1;
      return step;
    },
    async chatStream() {
      return '';
    },
  };
}

describe('Agent function calling (non-stream)', () => {
  let events: string[];
  let toolReports: Array<{ type: string }>;

  beforeEach(() => {
    events = [];
    toolReports = [];
  });

  it('runs tool then final response', async () => {
    const provider = mockProvider([
      {
        content: 'Reading file',
        toolCalls: [
          {
            id: 'call_1',
            name: 'read_file',
            arguments: JSON.stringify({ path: 'package.json' }),
          },
        ],
        finishReason: 'tool_calls',
      },
      {
        content: 'Done reading.',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new Agent(def, baseConfig, process.cwd(), undefined, {
      provider,
      toolProtocol: 'fc',
    });

    const result = await agent.execute(
      [{ role: 'user', content: 'read package.json' }],
      (e) => events.push(e.type),
      (tc) => toolReports.push({ type: tc.type }),
    );

    expect(result.turns).toBe(2);
    expect(result.toolCalls.map((t) => t.type)).toEqual(['read_file']);
    expect(toolReports).toHaveLength(1);
    expect(events).toContain('tool_start');
    expect(events).toContain('tool_end');
    expect(events).toContain('done');
    expect(result.content).toContain('Done reading.');
    // 工具结果也会拼进 content
    expect(result.content).toContain('Tool: read_file');
  });

  it('records invalid arguments as tool error without throwing', async () => {
    const provider = mockProvider([
      {
        content: '',
        toolCalls: [{ id: 'call_bad', name: 'read_file', arguments: '{not-json' }],
        finishReason: 'tool_calls',
      },
      {
        content: 'ok after error',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]);

    const agent = new Agent(def, baseConfig, process.cwd(), undefined, {
      provider,
      toolProtocol: 'fc',
    });

    const result = await agent.execute(
      [{ role: 'user', content: 'x' }],
      undefined,
      (tc) => toolReports.push({ type: tc.type }),
    );

    expect(toolReports).toHaveLength(1);
    expect(toolReports[0]!.type).toBe('read_file');
    expect(result.content).toContain('Invalid tool arguments JSON');
    expect(result.content).toContain('ok after error');
    expect(result.turns).toBe(2);
  });

  it('uses XML path when protocol is xml', async () => {
    const provider = mockProvider([]);
    const agent = new Agent(def, { ...baseConfig, toolProtocol: 'xml' }, process.cwd(), undefined, {
      provider,
      toolProtocol: 'xml',
    });

    const result = await agent.execute([{ role: 'user', content: 'hi' }]);
    expect(result.turns).toBe(1);
    expect(result.content).toContain('xml-should-not-be-used');
  });

  it('auto picks fc when chatWithTools exists', async () => {
    const provider = mockProvider([
      { content: 'only text', toolCalls: [], finishReason: 'stop' },
    ]);
    const agent = new Agent(def, { ...baseConfig, toolProtocol: 'auto' }, process.cwd(), undefined, {
      provider,
      toolProtocol: 'auto',
    });
    const result = await agent.execute([{ role: 'user', content: 'hi' }]);
    expect(result.content).toBe('only text');
    expect(result.turns).toBe(1);
  });
});

describe('Agent function calling (stream)', () => {
  it('streams content then tool then final', async () => {
    let call = 0;
    const provider: ILLMProvider = {
      async chat() {
        return '';
      },
      async chatStream() {
        return '';
      },
      async chatStreamWithTools(_msgs, _tools, onChunk) {
        call += 1;
        if (call === 1) {
          onChunk('thinking', 'hmm');
          onChunk('content', 'Looking up ');
          onChunk('content', 'file...');
          return {
            content: 'Looking up file...',
            toolCalls: [
              {
                id: 's1',
                name: 'read_file',
                arguments: JSON.stringify({ path: 'package.json' }),
              },
            ],
            finishReason: 'tool_calls',
          };
        }
        onChunk('content', 'All good.');
        return { content: 'All good.', toolCalls: [], finishReason: 'stop' };
      },
    };

    const agent = new Agent(def, baseConfig, process.cwd(), undefined, {
      provider,
      toolProtocol: 'fc',
    });

    const chunks: string[] = [];
    const tools: string[] = [];
    const result = await agent.executeStream(
      [{ role: 'user', content: 'read' }],
      (e) => {
        if (e.type === 'chunk' && e.text) chunks.push(e.text);
        if (e.type === 'tool_start' && e.toolType) tools.push(e.toolType);
      },
      (tc) => tools.push(`report:${tc.type}`),
    );

    expect(result.turns).toBe(2);
    expect(result.toolCalls.map((t) => t.type)).toEqual(['read_file']);
    expect(chunks.join('')).toContain('Looking up');
    expect(chunks.join('')).toContain('All good.');
    expect(tools).toContain('read_file');
    expect(tools).toContain('report:read_file');
    expect(result.thinking).toContain('hmm');
    expect(result.content).toContain('Tool: read_file');
  });

  it('falls back to XML stream when only chatStream exists', async () => {
    const provider: ILLMProvider = {
      async chat() {
        return '';
      },
      async chatStream() {
        return 'plain stream text';
      },
    };
    const agent = new Agent(def, { ...baseConfig, toolProtocol: 'auto' }, process.cwd(), undefined, {
      provider,
      toolProtocol: 'auto',
    });
    const result = await agent.executeStream([{ role: 'user', content: 'x' }]);
    expect(result.content).toContain('plain stream text');
    expect(result.turns).toBe(1);
  });
});
