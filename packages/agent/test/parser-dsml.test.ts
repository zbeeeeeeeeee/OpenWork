import { describe, it, expect } from 'vitest';
import { parseToolCalls, parseDsmlToolCalls } from '../src/parser';
import { ToolRegistry } from '../src/tool-registry';
import type { ITool } from '../src/types/tool';

function makeRegistry(names: string[]): ToolRegistry {
  const reg = new ToolRegistry();
  for (const name of names) {
    const tool: ITool = {
      name,
      description: 'd',
      usage: 'u',
      inputSchema: { type: 'object', properties: {} },
      async execute() {
        return 'ok';
      },
    };
    reg.register(tool);
  }
  return reg;
}

describe('parseDsmlToolCalls', () => {
  const reg = makeRegistry(['list_dir', 'bash', 'read_file']);

  it('parses well-formed DSML invoke + parameter', () => {
    const text = [
      '准备查看。',
      '<｜｜DSML｜｜ calls>',
      '<｜｜DSML｜｜ invoke name="bash">',
      '<｜｜DSML｜｜ parameter name="command" string="true">echo hi</｜｜DSML｜｜ parameter>',
      '</｜｜DSML｜｜ invoke>',
      '</｜｜DSML｜｜ calls>',
    ].join('\n');
    const tools = parseDsmlToolCalls(text, reg);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.type).toBe('bash');
    expect(tools[0]!.params.command).toBe('echo hi');
  });

  it('parses glued self-closing invoke name', () => {
    const text = '<｜｜DSML｜｜ invoke name="list_dir path="G:\\实验1"/>';
    const tools = parseDsmlToolCalls(text, reg);
    expect(tools.length).toBeGreaterThanOrEqual(1);
    expect(tools[0]!.type).toBe('list_dir');
    expect(tools[0]!.params.path).toContain('实验1');
  });

  it('returns empty when no DSML present', () => {
    expect(parseDsmlToolCalls('普通中文回复', reg)).toEqual([]);
  });

  it('parseToolCalls falls back to DSML when XML finds nothing', () => {
    const text = '<｜｜DSML｜｜ invoke name="list_dir path="." />';
    const tools = parseToolCalls(text, reg);
    expect(tools.some(t => t.type === 'list_dir')).toBe(true);
  });

  it('parseToolCalls still prefers real XML tags', () => {
    const text = '<list_dir path="src"/>';
    const tools = parseToolCalls(text, reg);
    expect(tools).toHaveLength(1);
    expect(tools[0]!.params.path).toBe('src');
  });
});
