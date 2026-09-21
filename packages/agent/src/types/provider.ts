import type { AgentConfig, AgentContext } from './agent';
import type { AgentMessage } from './message';
import type { OpenAIFunctionDefinition } from './tool';

/** AI 提供者接口 */
export interface IAgentProvider {
  readonly name: string;
  readonly displayName: string;
  initialize(config: AgentConfig): Promise<void>;
  sendMessage(message: string, context: AgentContext): Promise<AgentMessage>;
  streamMessage?(message: string, context: AgentContext, onChunk: (type: 'thinking' | 'content', text: string) => void): Promise<AgentMessage>;
  dispose(): void;
}

/** 聊天消息（兼容 OpenAI tools 协议：assistant.tool_calls / role:tool） */
export interface LLMChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

/** 单次 function calling 请求 */
export interface ToolCallRequest {
  id: string;
  name: string;
  /** JSON 字符串，与 OpenAI function.arguments 一致 */
  arguments: string;
}

export interface ChatWithToolsResult {
  content: string;
  toolCalls: ToolCallRequest[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'unknown';
}

/** LLM 调用公共选项（中断等） */
export interface LLMCallOptions {
  signal?: AbortSignal;
}

/** Agent 所需的 LLM 调用最小接口 */
export interface ILLMProvider {
  chat(messages: { role: string; content: string }[], options?: LLMCallOptions): Promise<string>;
  /** OpenAI tools 主路径；未实现则 Agent 回落 XML */
  chatWithTools?(
    messages: LLMChatMessage[],
    tools: OpenAIFunctionDefinition[],
    options?: LLMCallOptions,
  ): Promise<ChatWithToolsResult>;
  /** 流式 + tools；onChunk 仍只收 thinking/content，tool_calls 在返回值中 */
  chatStreamWithTools?(
    messages: LLMChatMessage[],
    tools: OpenAIFunctionDefinition[],
    onChunk: (type: 'thinking' | 'content', text: string) => void,
    options?: LLMCallOptions,
  ): Promise<ChatWithToolsResult>;
  chatStream(
    messages: { role: string; content: string }[],
    onChunk: (type: 'thinking' | 'content', text: string) => void,
    options?: LLMCallOptions,
  ): Promise<string>;
}
