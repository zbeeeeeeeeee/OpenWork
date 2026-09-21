/**
 * 记忆模块的类型定义。
 *
 * 设计原则:
 * 1. MemoryEntry 是最小存储单元,工具调用作为一等公民(不再是字符串拼接)
 * 2. 三种投影互不依赖:LLM 消息 / 展示消息 / 持久化序列化
 * 3. 仅存必要字段,不冗余存可重算的状态(如 token 数)
 */

/** 工具调用记录 —— 作为 MemoryEntry 的一部分,或独立 entry(role='tool') */
export interface ToolCallRecord {
  /** 工具标签名,如 "read_file" / "file_edit" / "bash" */
  type: string;
  /** 解析后的参数(对 file_edit 包含 old/new 等大文本) */
  params: Record<string, string>;
  /** 工具执行返回的结果文本(已格式化) */
  result: string;
  /** 执行耗时,毫秒 */
  durationMs: number;
  /** 执行该工具的 agent id;默认为主 agent */
  agentId?: string;
  /** 若由子 agent 产生,记录其父 agent id(委托链) */
  parentAgentId?: string;
  /** 写盘类工具的结构化变更（file_edit/file_write）；可选，旧数据无此字段 */
  fileChanges?: import('../types/tool').FileChangeMeta[];
}

/** 主/子 agent 标识 */
export type AgentRole = 'main' | 'sub';

/** 记忆条目 —— 后端 SessionMemory 的最小存储单元 */
export interface MemoryEntry {
  id: string;
  sessionId: string;
  /** 'user' = 用户输入; 'assistant' = LLM 回复; 'tool' = 工具调用结果; 'system' = 系统/错误 */
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  timestamp: number;
  /** 该 entry 产生的 agent(main 或 sub-agent id);user/system 留空 */
  agentId?: string;
  /** 子 agent 委托链:若该 entry 由子 agent 产生,parentAgentId 记录主 agent id */
  parentAgentId?: string;
  /** LLM 思考过程(reasoning_content);仅 assistant 可有 */
  thinking?: string;
  /** 关联的工具调用;仅 role='tool' 必填,assistant 可选(若 assistant 同时调了工具) */
  toolCall?: ToolCallRecord;
  /** 标记错误消息(流式崩溃 / 工具失败等),展示层特殊处理 */
  error?: boolean;
}

/** IDE 当前快照 —— 每次请求时由前端打包传入,不持久化 */
export interface IDESnapshot {
  /** 激活文件的完整内容(LLM 直接可见) */
  activeFile?: {
    path: string;
    content: string;
  };
  /** 其他打开 tab 的路径列表(仅路径,LLM 需主动 read_file) */
  openFilePaths: string[];
  /** 项目文件树路径(扁平字符串数组,与现状一致) */
  fileTree?: string[];
  /** 光标位置 */
  cursorPosition?: {
    file: string;
    line: number;
    column: number;
  };
  /** 选区 */
  selection?: {
    file: string;
    text: string;
    startLine: number;
    endLine: number;
  };
}

/** 推给 LLM 的消息格式 (openai-compatible) */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** 前端展示用的单个工具调用块 */
export interface DisplayToolBlock {
  id: string;
  type: 'tool_call';
  toolType: string;
  toolLabel: string;
  /** 完整参数(展示层可折叠) */
  params: Record<string, string>;
  result: string;
  durationMs: number;
  completed: boolean;
  error?: boolean;
}

/** 前端展示用的思考块 */
export interface DisplayThinkingBlock {
  id: string;
  type: 'thinking';
  content: string;
  completed: boolean;
}

/** 前端展示用的回复块 */
export interface DisplayResponseBlock {
  id: string;
  type: 'response';
  content: string;
}

export type DisplayBlock = DisplayToolBlock | DisplayThinkingBlock | DisplayResponseBlock;

/** 前端展示用消息(由后端 projectToDisplay 产出) */
export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  thinking?: string;
  /** 时间轴布局的块序列(展示层按顺序渲染) */
  blocks: DisplayBlock[];
  /** 该消息源自哪个 agent(主/子);user/system 留空 */
  agentId?: string;
  /** 该消息是否源自流式期间(尚未最终落盘) */
  live?: boolean;
  error?: boolean;
}

/** 持久化到 workspace.json 的序列化格式 */
export interface SerializedSessionMemory {
  sessionId: string;
  entries: MemoryEntry[];
  /** schema 版本,后续迁移用 */
  schemaVersion: 1;
}

/** Token 估算策略:字符数 / 4 近似(避免引入 tiktoken 依赖) */
export const CHARS_PER_TOKEN = 4;

/** 默认 token 预算(若配置未指定) */
export const DEFAULT_MEMORY_TOKEN_BUDGET = 32_000;
