import type { AgentMessage } from './message';
import type { ModelCapabilities } from '../llm/model-capabilities';
import type { PermissionMode } from '../permission';

/** Agent 工作模式 */
export type AgentMode = 'build' | 'plan';

/** Agent 运行配置 */
export interface AgentConfig {
  mode: AgentMode;
  model?: string;
  apiUrl?: string;
  apiKey?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** 是否启用 bash 工具(默认 true)。远程部署建议关闭。 */
  enableBash?: boolean;
  /** 工具协议：xml=标签解析；fc=OpenAI tools；auto=按能力表/provider 选择 */
  toolProtocol?: 'xml' | 'fc' | 'auto';
  /** 覆盖内置 model 能力表 */
  modelCapabilities?: ModelCapabilities;
  /** 权限模式；默认 suggest（写/bash 需确认） */
  permissionMode?: PermissionMode;
}

/** Agent 预置定义 —— 绑定提示词、模型、温度等预设 */
export interface AgentDefinition {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  maxTurns?: number;
  subAgentIds?: string[];
}

/** Agent 上下文 —— 当前编码环境的完整快照 */
export interface AgentContext {
  openFiles: { path: string; content: string }[];
  fileTree: string[];
  cursorPosition?: { file: string; line: number; column: number };
  selection?: { file: string; text: string; startLine: number; endLine: number };
  conversationHistory: AgentMessage[];
}

/** Agent 单次运行结果 */
export interface AgentResult {
  agentId: string;
  content: string;
  turns: number;
  toolCalls: { type: string; params: Record<string, string> }[];
  /** 流式期间累积的 thinking 文本(reasoning models) */
  thinking?: string;
  error?: string;
  /** 本轮停止原因（maxTurns / 取消 / 正常收尾等） */
  stopReason?: 'stop' | 'max_turns' | 'aborted' | 'empty' | 'error';
}

/** 会话消息 —— 记录每条消息来源 Agent */
export interface SessionMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  agentId?: string;
  content: string;
  timestamp: number;
}
