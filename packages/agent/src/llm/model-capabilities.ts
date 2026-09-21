/**
 * 按 model 维护的 LLM 能力表（OpenAI-compatible 国产模型优先）。
 *
 * 策略：
 * - 预设命中 → 用预设
 * - 未命中 → 不假装支持：auto 靠 provider 是否实现 chatWithTools
 * - 用户可显式 toolProtocol 强制 xml/fc
 */

export interface ModelCapabilities {
  /** 是否支持 OpenAI tools / tool_calls */
  functionCalling: boolean;
  parallelToolCalls?: boolean;
  supportsReasoningContent?: boolean;
}

interface CapabilityRule {
  /** 匹配 model 字符串（不区分大小写） */
  test: (model: string) => boolean;
  capabilities: ModelCapabilities;
  note?: string;
}

const PRESETS: CapabilityRule[] = [
  {
    test: (m) => /^deepseek-chat/.test(m) || m.startsWith('deepseek-v3'),
    capabilities: { functionCalling: true, parallelToolCalls: false, supportsReasoningContent: false },
    note: 'DeepSeek 对话型，tools 可用',
  },
  {
    test: (m) => m.startsWith('deepseek-reasoner') || m.startsWith('deepseek-r1'),
    capabilities: { functionCalling: false, supportsReasoningContent: true },
    note: '推理型默认不走 tools，避免与 reasoning 通道纠缠',
  },
  {
    test: (m) => m.startsWith('moonshot') || m.startsWith('kimi'),
    capabilities: { functionCalling: true, parallelToolCalls: false },
  },
  {
    // MiMo 等：仅当明确 chat 工具型号时再补；未列出则视为未知
    test: (m) => /^mimo[-_]/.test(m) && /chat|instruct/.test(m),
    capabilities: { functionCalling: true },
    note: 'MiMo 对话/指令型号预设；具体以联调矩阵为准',
  },
];

/** 查预设；未命中返回 null */
export function lookupModelCapabilities(model?: string): ModelCapabilities | null {
  if (!model) return null;
  const lower = model.toLowerCase();
  for (const rule of PRESETS) {
    if (rule.test(lower)) {
      return { ...rule.capabilities };
    }
  }
  return null;
}

export type ResolvedToolProtocol = 'xml' | 'fc';

export interface ResolveToolProtocolInput {
  /** 用户/配置请求：默认 auto */
  requested?: 'xml' | 'fc' | 'auto';
  model?: string;
  /** 显式传入覆盖预设 */
  capabilities?: ModelCapabilities | null;
  /** provider 是否实现了 chatWithTools */
  hasChatWithTools?: boolean;
}

/**
 * 解析实际工具协议。
 * - xml：永远尊重显式 xml
 * - fc：显式 fc，或 auto 且（预设/覆盖 functionCalling !== false）且 hasChatWithTools
 * - auto 且 functionCalling === false → xml
 * - 未知模型 + auto + hasChatWithTools → fc（允许试探；失败再由 Agent 降级）
 */
export function resolveToolProtocol(input: ResolveToolProtocolInput): ResolvedToolProtocol {
  const requested = input.requested ?? 'auto';
  if (requested === 'xml') return 'xml';
  if (requested === 'fc') return 'fc';

  const caps =
    input.capabilities !== undefined && input.capabilities !== null
      ? input.capabilities
      : lookupModelCapabilities(input.model);

  if (caps && caps.functionCalling === false) {
    return 'xml';
  }
  if (input.hasChatWithTools) {
    return 'fc';
  }
  return 'xml';
}
