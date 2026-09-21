import type { ITool, OpenAIFunctionDefinition } from './types/tool';
import { toolToOpenAIFunction } from './tools/openai-function';
import { createLogger } from './logger';

const log = createLogger('ToolRegistry');

export class ToolRegistry {
  private tools: Map<string, ITool> = new Map();

  register(tool: ITool): void {
    const replaced = this.tools.has(tool.name);
    this.tools.set(tool.name, tool);
    if (replaced) {
      log.info(`Replaced tool: ${tool.name}`);
    }
  }

  get(name: string): ITool | undefined {
    const tool = this.tools.get(name);
    if (!tool) {
      log.warn(`Tool not found: "${name}" (available: ${Array.from(this.tools.keys()).join(', ')})`);
    }
    return tool;
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  getAll(): ITool[] {
    return Array.from(this.tools.values());
  }

  /** 已注册工具数量 */
  get size(): number {
    return this.tools.size;
  }

  /** 所有已注册的标签名，供解析器使用 */
  getTagNames(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * 导出为 OpenAI tools[]（function calling 主路径）。
   * 顺序与注册顺序一致；同名工具在 register 时已覆盖。
   */
  listOpenAITools(): OpenAIFunctionDefinition[] {
    return Array.from(this.tools.values()).map(toolToOpenAIFunction);
  }

  /**
   * 查询工具的 body 承载模式。
   * - undefined：仅支持自闭合标签，无 body
   * - 'content'：body = params.content（整段文本）
   * - 'children'：body 由子标签 <key>val</key> 拆解为 params[key]
   */
  getBodyMode(name: string): 'content' | 'children' | undefined {
    return this.tools.get(name)?.body;
  }

  /** 生成 "## Available Tools" 系统提示词段落，包含参数描述和注解提示 */
  buildSystemPromptSection(): string {
    if (this.tools.size === 0) return '';
    const lines = ['## Available Tools'];
    for (const tool of this.tools.values()) {
      // 注解提示
      const hints = buildHints(tool);
      lines.push(`${tool.usage} — ${tool.description}${hints}`);

      // 每个参数的描述
      if (tool.inputSchema.properties) {
        for (const [key, prop] of Object.entries(tool.inputSchema.properties)) {
          if (prop.description) {
            const required = tool.inputSchema.required?.includes(key) ? '(required)' : '(optional)';
            lines.push(`  ${key}: ${prop.description} ${required}`);
          }
        }
      }
    }
    return lines.join('\n');
  }
}

/** 从工具注解构建简短提示后缀 */
function buildHints(tool: ITool): string {
  const ann = tool.annotations;
  if (!ann) return '';

  const hints: string[] = [];
  if (ann.readOnlyHint) hints.push('readonly');
  if (ann.destructiveHint) hints.push('destructive');
  if (ann.idempotentHint) hints.push('idempotent');
  if (ann.openWorldHint) hints.push('openWorld');

  return hints.length > 0 ? ` (${hints.join(', ')})` : '';
}
