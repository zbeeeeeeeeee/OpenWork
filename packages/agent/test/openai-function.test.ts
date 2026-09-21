import { describe, it, expect } from 'vitest';
import { createDefaultTools } from '../src/tools/index';
import { toolToOpenAIFunction, sanitizeFunctionName } from '../src/tools/openai-function';
import { ToolRegistry } from '../src/tool-registry';
import type { ITool } from '../src/types/tool';

describe('sanitizeFunctionName', () => {
  it('keeps valid names', () => {
    expect(sanitizeFunctionName('file_edit')).toBe('file_edit');
    expect(sanitizeFunctionName('mcp-1.tool')).toBe('mcp-1_tool');
  });

  it('truncates to 64 chars and falls back when empty', () => {
    expect(sanitizeFunctionName('a'.repeat(80)).length).toBe(64);
    expect(sanitizeFunctionName('///')).toBe('___');
  });
});

describe('toolToOpenAIFunction', () => {
  it('maps default tools to OpenAI function entries', () => {
    const tools = createDefaultTools();
    const fns = tools.map(toolToOpenAIFunction);
    expect(fns).toHaveLength(7);
    expect(fns.map((f) => f.function.name)).toEqual([
      'list_dir',
      'read_file',
      'search_code',
      'file_edit',
      'file_write',
      'bash',
      'delegate',
    ]);
    for (const fn of fns) {
      expect(fn.type).toBe('function');
      expect(fn.function.description.length).toBeGreaterThan(0);
      expect(fn.function.parameters.type).toBe('object');
    }
  });

  it('file_edit schema requires path/old/new and drops default', () => {
    const edit = createDefaultTools().find((t) => t.name === 'file_edit')!;
    const fn = toolToOpenAIFunction(edit);
    expect(fn.function.parameters.required).toEqual(['path', 'old', 'new']);
    const replaceAll = fn.function.parameters.properties.replace_all;
    expect(replaceAll?.type).toBe('string');
    expect(replaceAll).not.toHaveProperty('default');
    // source schema 仍有 default，确认只影响导出副本
    expect(edit.inputSchema.properties.replace_all).toHaveProperty('default');
  });

  it('honors custom toOpenAIFunction when present', () => {
    const custom: ITool = {
      name: 'weird name!',
      description: 'desc',
      usage: 'usage',
      inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
      toOpenAIFunction() {
        return {
          type: 'function',
          function: {
            name: 'custom_tool',
            description: 'custom desc',
            parameters: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'] },
          },
        };
      },
      async execute() {
        return 'ok';
      },
    };
    const fn = toolToOpenAIFunction(custom);
    expect(fn.function.name).toBe('custom_tool');
    expect(fn.function.description).toBe('custom desc');
    expect(fn.function.parameters.required).toEqual(['y']);
  });
});

describe('ToolRegistry.listOpenAITools', () => {
  it('lists functions in registration order', () => {
    const registry = new ToolRegistry();
    for (const t of createDefaultTools()) registry.register(t);
    const names = registry.listOpenAITools().map((f) => f.function.name);
    expect(names[0]).toBe('list_dir');
    expect(names).toHaveLength(registry.size);
  });

  it('excludes bash when not registered', () => {
    const registry = new ToolRegistry();
    for (const t of createDefaultTools({ enableBash: false })) registry.register(t);
    const names = registry.listOpenAITools().map((f) => f.function.name);
    expect(names).not.toContain('bash');
    expect(names).toHaveLength(6);
  });
});
