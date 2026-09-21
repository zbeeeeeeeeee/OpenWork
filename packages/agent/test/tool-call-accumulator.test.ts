import { describe, it, expect } from 'vitest';
import { ToolCallAccumulator } from '../src/llm/accumulate-tool-calls';

describe('ToolCallAccumulator', () => {
  it('assembles arguments split across deltas', () => {
    const acc = new ToolCallAccumulator();
    acc.apply({
      tool_calls: [
        { index: 0, id: 'c1', function: { name: 'read_file', arguments: '{"pa' } },
      ],
    });
    acc.apply({
      tool_calls: [{ index: 0, function: { arguments: 'th":"a.ts"}' } }],
    });
    const list = acc.snapshot();
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe('c1');
    expect(list[0]!.name).toBe('read_file');
    expect(JSON.parse(list[0]!.arguments)).toEqual({ path: 'a.ts' });
  });

  it('collects parallel tool calls by index', () => {
    const acc = new ToolCallAccumulator();
    acc.apply({
      tool_calls: [
        { index: 0, id: 'a', function: { name: 'list_dir', arguments: '{}' } },
        { index: 1, id: 'b', function: { name: 'read_file', arguments: '{"path":"x"}' } },
      ],
    });
    acc.apply({ tool_calls: [{ index: 1, function: { arguments: '' } }] });
    const list = acc.snapshot();
    expect(list).toHaveLength(2);
    expect(list.map((t) => t.name)).toEqual(['list_dir', 'read_file']);
  });

  it('ignores empty tool_calls and supports reset', () => {
    const acc = new ToolCallAccumulator();
    acc.apply(null);
    acc.apply({ tool_calls: [] });
    expect(acc.snapshot()).toHaveLength(0);
    acc.apply({
      tool_calls: [{ index: 0, id: 'z', function: { name: 'bash', arguments: '{}' } }],
    });
    expect(acc.snapshot()).toHaveLength(1);
    acc.reset();
    expect(acc.snapshot()).toHaveLength(0);
  });

  it('falls back to sequential slots when index missing', () => {
    const acc = new ToolCallAccumulator();
    acc.apply({
      tool_calls: [
        { id: '1', function: { name: 'a', arguments: '{}' } },
        { id: '2', function: { name: 'b', arguments: '{}' } },
      ],
    });
    expect(acc.snapshot().map((t) => t.name)).toEqual(['a', 'b']);
  });
});
