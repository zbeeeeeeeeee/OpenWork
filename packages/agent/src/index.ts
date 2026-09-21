// ============================
// @openwork/agent 公共 API
// ============================
// 外部模块通过此入口访问全部 agent 功能。
// 未列在此文件中的导出为内部实现,不应被外部引用。

// -- AgentRuntime 统一入口 --
export {
  AgentRuntime,
  type AgentRuntimeConfig,
  type AgentRuntimeEvent,
  type AgentRuntimeEventCallback,
  type ChatResult,
} from './runtime';

export {
  Agent,
  type AgentOverrides,
  type AgentEvent,
  DEFAULT_AGENT_MAX_TURNS,
  ABSOLUTE_MAX_TURNS,
  resolveMaxTurns,
  isAbortError,
} from './agent';

// -- 核心类型 --
export type { AgentContext, AgentResult, SessionMessage } from './types/agent';
export type { AgentMessage } from './types/message';
export type { IAgentFileSystem, FileEntry } from './types/filesystem';
export type { ITool, OpenAIFunctionDefinition, ToolInputSchema, FileChangeMeta, FileChangeHunk } from './types/tool';

// -- 工具调用解析（编辑能力已下沉为 FileWriteTool / FileEditTool,不再有独立的 edits 路径） --
export { parseToolCalls, type ParsedTool } from './parser';

// -- 展示清洗（thinking / 回复正文去工具协议噪声） --
export {
  stripToolMarkup,
  stripToolResultBlocks,
  sanitizeThinking,
  sanitizeDisplayContent,
  COMMON_TOOL_NAMES,
} from './sanitize';

// -- OpenAI function calling 定义 --
export { toolToOpenAIFunction, sanitizeFunctionName } from './tools/openai-function';
export {
  lookupModelCapabilities,
  resolveToolProtocol,
  type ModelCapabilities,
} from './llm/model-capabilities';

// -- 记忆模块(SessionMemory + 类型) --
export { SessionMemory } from './memory';
export type {
  MemoryEntry,
  ToolCallRecord,
  AgentRole,
  IDESnapshot,
  LLMMessage,
  DisplayMessage,
  DisplayBlock,
  DisplayToolBlock,
  DisplayThinkingBlock,
  DisplayResponseBlock,
  SerializedSessionMemory,
} from './memory';
export { CHARS_PER_TOKEN, DEFAULT_MEMORY_TOKEN_BUDGET } from './memory';

// -- MCP 配置类型 --
export type {
  StdioServerConfig,
  SseServerConfig,
  HttpServerConfig,
  McpServerConfig,
  McpConfig,
  McpServerEntry,
  McpSettingsFile,
} from './mcp/config';

// -- LLM Gateway(提供商配置管理)+ OpenAI Provider(提供商调用) --
export { LLMGateway, maskApiKey, type LLMProvider, type LLMSettings } from './llm/index';
export {
  createOpenAILLMProvider,
  buildMessages,
  resolveLLMConfig,
} from './llm/openai-client';
export type {
  ILLMProvider,
  LLMChatMessage,
  ToolCallRequest,
  ChatWithToolsResult,
  LLMCallOptions,
} from './types/provider';
export { ToolCallAccumulator } from './llm/accumulate-tool-calls';
export { FileUndoStack, UNDO_MAX_ENTRIES, UNDO_MAX_BYTES, type FileUndoEntry } from './file-undo';
export {
  DEFAULT_PERMISSION_MODE,
  previewParam,
  buildApprovalLabel,
  requiresApproval,
  defaultDecision,
  resolvePermissionMode,
  nextApprovalId,
  ApprovalBroker,
  buildApprovalPreview,
  type PermissionMode,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalPreview,
  type Approver,
} from './permission';

// -- MCP 管理器(服务端 MCP CRUD / 测试使用) --
export { McpManager } from './mcp/manager';
export type { McpToolInfo } from './mcp/manager';

// -- 结构化日志 --
export { createLogger, runWithContext, type Logger, type LogLevel } from './logger';
export { LOG_CATEGORY, type LogCategory } from './log-categories';
