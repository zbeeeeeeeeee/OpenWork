import type { ToolCallRequest } from '../types/provider';

interface Slot {
  id: string;
  name: string;
  arguments: string;
}

/**
 * 流式累积 OpenAI delta.tool_calls（国产兼容 API 分片实现差异大）。
 * - 按 index 分槽；无 index 时按出现顺序
 * - id/name 首次出现即固定，arguments 只做字符串拼接
 */
export class ToolCallAccumulator {
  private slots = new Map<number, Slot>();
  private order: number[] = [];
  private nextAutoIndex = 0;

  apply(delta?: {
    tool_calls?: Array<{
      index?: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }>;
  } | null): void {
    const list = delta?.tool_calls;
    if (!list || list.length === 0) return;

    for (const part of list) {
      const idx = typeof part.index === 'number' ? part.index : this.nextAutoIndex++;
      let slot = this.slots.get(idx);
      if (!slot) {
        slot = { id: '', name: '', arguments: '' };
        this.slots.set(idx, slot);
        this.order.push(idx);
      }
      if (part.id) slot.id = part.id;
      if (part.function?.name) slot.name = part.function.name;
      if (part.function?.arguments) slot.arguments += part.function.arguments;
    }
  }

  snapshot(): ToolCallRequest[] {
    return this.order
      .map((idx) => this.slots.get(idx)!)
      .filter(Boolean)
      .map((s, i) => ({
        id: s.id || `call_${i}`,
        name: s.name,
        arguments: s.arguments,
      }));
  }

  reset(): void {
    this.slots.clear();
    this.order = [];
    this.nextAutoIndex = 0;
  }
}
