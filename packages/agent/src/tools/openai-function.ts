import type { ITool, OpenAIFunctionDefinition, ToolInputSchema } from '../types/tool';

/** OpenAI function name：字母数字下划线连字符，最长 64 */
export function sanitizeFunctionName(name: string): string {
  const cleaned = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'tool';
}

/**
 * 把 ITool.inputSchema 规范成适合国产模型 tools 的 JSON Schema。
 * 去掉 default 等个别兼容层不稳的关键字，保留 type/description/required。
 */
function toFunctionParameters(schema: ToolInputSchema): ToolInputSchema {
  const properties: ToolInputSchema['properties'] = {};
  for (const [key, prop] of Object.entries(schema.properties || {})) {
    const next: ToolInputSchema['properties'][string] = { type: prop.type };
    if (prop.description) next.description = prop.description;
    if (prop.enum) next.enum = prop.enum;
    if (prop.type === 'string' && prop.pattern) next.pattern = prop.pattern;
    properties[key] = next;
  }
  const out: ToolInputSchema = { type: 'object', properties };
  if (schema.required?.length) out.required = [...schema.required];
  return out;
}

/**
 * 默认：由 name/description/inputSchema 生成 OpenAI function 定义。
 * 工具若自实现 toOpenAIFunction，应优先使用工具自身实现。
 */
export function toolToOpenAIFunction(tool: ITool): OpenAIFunctionDefinition {
  if (tool.toOpenAIFunction) {
    const custom = tool.toOpenAIFunction();
    return {
      type: 'function',
      function: {
        name: sanitizeFunctionName(custom.function.name),
        description: custom.function.description || tool.description,
        parameters: custom.function.parameters || toFunctionParameters(tool.inputSchema),
      },
    };
  }

  return {
    type: 'function',
    function: {
      name: sanitizeFunctionName(tool.name),
      description: tool.description,
      parameters: toFunctionParameters(tool.inputSchema),
    },
  };
}
