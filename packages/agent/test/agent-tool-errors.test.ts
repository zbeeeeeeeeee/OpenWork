import { describe, it, expect, beforeEach } from 'vitest';
import { Agent } from '../src/agent';
import { Session } from '../src/session';
import { SessionMemory } from '../src/memory';
import type { ILLMProvider } from '../src/types/provider';
import type { ITool } from '../src/types/tool';
import type { AgentDefinition, AgentConfig } from '../src/types/agent';

const def: AgentDefinition = { id: 'main', name: 'Main', systemPrompt: 'sys' };
const cfg: AgentConfig = { mode: 'build', enableBash: false, toolProtocol: 'xml' };

function xmlProviderAlways(toolXml: string): ILLMProvider {
  let n = 0;
  return {
    async chat() {
      n += 1;
      // 第一轮吐工具，第二轮收尾
      return n === 1 ? toolXml : 'all good';
    },
    async chatStream() {
      return n === 0 ? toolXml : 'all good';
    },
  };
}

describe('tool exception safety', () => {
  it('tool throw becomes Error result and loop continues', async () => {
    const boom: ITool = {
      name: 'list_dir',
      description: 'd',
      usage: 'u',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async execute() {
        throw new Error('exploded');
      },
    };
    const agent = new Agent(def, cfg, process.cwd(), [boom], {
      provider: xmlProviderAlways(`<list_dir path="."/>`),
      toolProtocol: 'xml',
      permissionMode: 'full-auto',
    });
    const result = await agent.execute([{ role: 'user', content: 'x' }]);
    expect(result.content).toContain('Error: exploded');
    expect(result.content).toContain('all good');
    expect(result.turns).toBe(2);
  });

  it('second tool still runs when first throws', async () => {
    const order: string[] = [];
    const t1: ITool = {
      name: 'list_dir',
      description: 'd',
      usage: 'u',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async execute() {
        order.push('t1');
        throw new Error('first fail');
      },
    };
    const t2: ITool = {
      name: 'read_file',
      description: 'd',
      usage: 'u',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      async execute() {
        order.push('t2');
        return 'ok-second';
      },
    };
    const provider: ILLMProvider = {
      async chat() {
        return order.length === 0
          ? `<list_dir path="."/><read_file path="package.json"/>`
          : 'done';
      },
      async chatStream() {
        return 'done';
      },
    };
    const agent = new Agent(def, cfg, process.cwd(), [t1, t2], {
      provider,
      toolProtocol: 'xml',
      permissionMode: 'full-auto',
    });
    const result = await agent.execute([{ role: 'user', content: 'x' }]);
    expect(order).toEqual(['t1', 't2']);
    expect(result.content).toContain('Error: first fail');
    expect(result.content).toContain('ok-second');
  });
});

describe('Session failure finalize', () => {
  it('writes error assistant when agent throws after user message', async () => {
    const provider: ILLMProvider = {
      async chat() {
        throw new Error('llm boom');
      },
      async chatStream() {
        throw new Error('llm boom');
      },
    };
    const agent = new Agent(def, cfg, process.cwd(), undefined, {
      provider,
      toolProtocol: 'xml',
    });
    const session = new Session('s-fail', agent, new SessionMemory('s-fail'));
    await expect(session.start('hello', undefined)).rejects.toThrow(/llm boom/);

    const entries = session.memory.getEntries();
    const roles = entries.map((e) => e.role);
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const last = entries[entries.length - 1]!;
    expect(last.role).toBe('assistant');
    expect(last.content).toContain('Agent failed');
  });
});
