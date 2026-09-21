import type { AgentConfig } from './types/agent';
import type { IAgentFileSystem } from './types/filesystem';
import type { McpServerEntry, McpConfig } from './mcp/config';
import type { ITool } from './types/tool';
import type { IDESnapshot, DisplayMessage, SerializedSessionMemory } from './memory';
import { DEFAULT_MEMORY_TOKEN_BUDGET, SessionMemory } from './memory';
import { Agent } from './agent';
import { Session, type SessionEvent } from './session';
import { McpManager } from './mcp/manager';
import { createOpenAILLMProvider, buildMessages } from './llm/openai-client';
import { createLogger } from './logger';
import { LOG_CATEGORY } from './log-categories';
import type { AgentContext } from './types/agent';
import { resolvePath } from './tools/_shared/path';
import { FileUndoStack } from './file-undo';
import * as path from 'path';
import { promises as fsp } from 'fs';

const log = createLogger(LOG_CATEGORY.AGENT_RUNTIME);

export interface AgentRuntimeConfig {
  mode: 'build' | 'plan';
  provider: {
    apiUrl?: string;
    apiKey?: string;
    model?: string;
  };
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** 是否启用 bash 工具(默认 true)。远程部署建议设为 false。 */
  enableBash?: boolean;
  workspaceRoot: string;
  mcpServers?: McpServerEntry[];
  maxTurns?: number;
  fileSystem?: IAgentFileSystem;
  /** 会话记忆的 token 预算(用于 LLM 历史滑窗);不设则用 DEFAULT_MEMORY_TOKEN_BUDGET */
  memoryTokenBudget?: number;
  /** 工具协议：默认 xml（兼容现状）；fc/auto 走 OpenAI tools */
  toolProtocol?: 'xml' | 'fc' | 'auto';
  /** 覆盖 model 能力预设 */
  modelCapabilities?: import('./llm/model-capabilities').ModelCapabilities;
  /** 权限模式；默认 suggest */
  permissionMode?: import('./permission').PermissionMode;
  /** 写/bash 等需确认时的回调；未提供则按模式 deny（full-auto 除外） */
  approver?: import('./permission').Approver;
}

export interface ChatResult {
  content: string;
  turns: number;
  toolCalls: { type: string; params: Record<string, string> }[];
  /** 本次会话产生的 thinking 内容(若有) */
  thinking?: string;
}

export interface AgentRuntimeEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_result' | 'done' | 'error';
  text?: string;
  toolName?: string;
  toolLabel?: string;
  /** 工具调用参数(tool_start 时携带) */
  toolParams?: Record<string, string>;
  /** 工具执行耗时(tool_end 时携带) */
  durationMs?: number;
  /** 写盘类工具变更 */
  fileChanges?: import('./types/tool').FileChangeMeta[];
  error?: string;
}

export type AgentRuntimeEventCallback = (event: AgentRuntimeEvent) => void;

const DEFAULT_SYSTEM_PROMPT = [
  'You are an autonomous coding agent. Your goal is to understand, plan, and execute code changes.',
  '',
  '## Environment',
  '- Desktop IDE on **Windows**. The `bash` tool runs **PowerShell**, not Unix bash.',
  '- Prefer `list_dir` and `read_file` to explore the project. They handle Chinese paths well.',
  '- Avoid Unix-only commands (`ls -la`, `find`, `head`, `pwd`) — they often fail on PowerShell.',
  '- If a tool fails, do **not** repeat the same call. Switch tool or path, then answer.',
  '- Call each tool at most 2 times with the same arguments. Move on.',
  '',
  '## Answering Questions',
  'When the user asks about a project, experiment, file, or code:',
  '- Explore first with read-only tools (`list_dir`, `read_file`, `search_code`).',
  '- Open the relevant files/folders before answering. Do not stop at a parent directory listing',
  '  if the question is about something inside it.',
  '- After 3–8 purposeful tool calls, write the final answer from what you actually read.',
  '- Answer in clear natural language (Markdown is fine). Ground claims in what you actually read.',
  '- Do not dump raw tool output into the reply; summarize.',
  '',
  '## Language (IMPORTANT)',
  '- **Always reply in the same language as the user\'s message.**',
  '- If the user writes Chinese, the final answer MUST be Chinese (Markdown/代码标识符可保留英文).',
  '- Do NOT mix long English prose into a Chinese answer.',
  '- Never end the answer with only a file path or tool name; write a complete explanation.',
  '- Internal reasoning may be in any language, but user-facing text follows the user language.',
  '',
  '## Making Changes',
  '',
  'You have THREE file tools. Their priority is fixed:',
  '',
  '1. `file_edit` — DEFAULT for any modification to an existing file.',
  '   Sends only the diff (old/new strings), so it is cheap and safe.',
  '2. `file_write` — ONLY for these two cases:',
  '   (a) creating a NEW file that does not exist yet;',
  '   (b) a COMPLETE rewrite where the change touches the majority of lines.',
  '   For anything else, use `file_edit`. Never use `file_write` to "make a small change".',
  '3. `read_file` — load a file before editing it. Both `file_edit` and `file_write`',
  '   REQUIRE a prior `read_file` of the same path in this session; otherwise they will refuse.',
  '',
  '## Rules',
  '1. Read files before editing them (`read_file` first, then `file_edit`).',
  '2. Prefer `file_edit` over `file_write`. If you find yourself reaching for `file_write`',
  '   to patch a few lines, STOP — use `file_edit` instead.',
  '3. With `file_edit`, the <old> text must match EXACTLY (whitespace included) and be unique',
  '   in the file. Add surrounding context lines if it is not unique, or set replace_all="true".',
  '4. With `file_write`, the body is the COMPLETE final file content (no code fences).',
  '5. Think step by step: explore → plan → execute → explain.',
  '6. Use read-only tools freely to answer questions. Only use write tools (`file_edit`, `file_write`)',
  '   when the user explicitly asks for file changes.',
  '7. User-facing replies must be plain natural language / Markdown, **in the user\'s language**.',
  '   Never leave tool-call markup (XML tags, DSML, function-call syntax) in your final answer.',
  '8. In reasoning, describe intent in natural language. Do not emit tool-call markup there.',
  '9. Use only the XML tool tags listed in Available Tools (e.g. `<list_dir path="..."/>`).',
  '   Do not invent other call syntaxes.',
  '10. Prefer Chinese for Chinese users: 结构、硬件说明、代码解读等正文一律用中文。',
].join('\n');

export class AgentRuntime {
  private config: AgentRuntimeConfig;
  private agentConfig: AgentConfig;
  private fs: IAgentFileSystem;
  private mcpManager: McpManager | null = null;
  private mcpTools: ITool[] = [];
  private initialized = false;
  private sessionMap = new Map<string, Session>();
  /** 同 sessionId 串行执行，避免并发写 SessionMemory 交错 */
  private sessionLocks = new Map<string, Promise<unknown>>();
  private undoStacks = new Map<string, FileUndoStack>();
  private readonly approver?: import('./permission').Approver;

  constructor(config: AgentRuntimeConfig) {
    this.config = config;
    this.fs = config.fileSystem || this.createDefaultFS(config.workspaceRoot);
    this.approver = config.approver;
    this.agentConfig = {
      mode: config.mode,
      model: config.provider.model,
      apiUrl: config.provider.apiUrl,
      apiKey: config.provider.apiKey,
      systemPrompt: config.systemPrompt || DEFAULT_SYSTEM_PROMPT,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      enableBash: config.enableBash,
      toolProtocol: config.toolProtocol || 'xml',
      modelCapabilities: config.modelCapabilities,
      permissionMode: config.permissionMode,
    };
  }

  private createDefaultFS(rootPath: string): IAgentFileSystem {
    const root = path.resolve(rootPath);
    const resolve = (relative: string): string => resolvePath(root, relative);

    return {
      async readFile(relative: string): Promise<string> {
        return fsp.readFile(resolve(relative), 'utf-8');
      },
      async writeFile(relative: string, content: string): Promise<void> {
        await fsp.mkdir(path.dirname(resolve(relative)), { recursive: true });
        await fsp.writeFile(resolve(relative), content, 'utf-8');
      },
      async exists(relative: string): Promise<boolean> {
        try { await fsp.access(resolve(relative)); return true; } catch { return false; }
      },
      async readDir(relative: string): Promise<{ name: string; path: string; isDirectory: boolean }[]> {
        const abs = resolve(relative);
        const entries = await fsp.readdir(abs, { withFileTypes: true });
        return entries.map((e: { name: string; isDirectory: () => boolean }) => ({
          name: e.name,
          path: path.relative(root, path.join(abs, e.name)).replace(/\\/g, '/'),
          isDirectory: e.isDirectory(),
        }));
      },
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.config.mode === 'build' && this.config.mcpServers && this.config.mcpServers.length > 0) {
      const mcpConfig: McpConfig = { mcpServers: {} };
      for (const entry of this.config.mcpServers) {
        mcpConfig.mcpServers[entry.id] = entry.config;
      }
      this.mcpManager = new McpManager();
      try {
        await this.mcpManager.connectAll(mcpConfig);
        this.mcpTools = await this.mcpManager.discoverAndCreateAdapters();
      } catch (e: any) {
        log.error(`MCP connection failed: ${e.message}`);
      }
    }

    this.initialized = true;
  }

  async dispose(): Promise<void> {
    if (this.mcpManager) {
      try { await this.mcpManager.disconnectAll(); } catch { /* ignore */ }
      this.mcpManager = null;
      this.mcpTools = [];
    }
    this.initialized = false;
  }

  /** 重新初始化 MCP 连接（当 MCP 配置变更时使用） */
  async reinitialize(mcpServers?: typeof this.config.mcpServers): Promise<void> {
    await this.dispose();
    if (mcpServers) this.config.mcpServers = mcpServers;
    await this.initialize();
  }

  /**
   * 将同一 sessionId 的操作串行化。
   * 前一次无论成功或失败，下一次都会开始；错误不阻塞后续请求。
   */
  private enqueueSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.sessionLocks.get(sessionId) ?? Promise.resolve();
    const run = prev.then(() => fn(), () => fn());
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.sessionLocks.set(sessionId, tail);
    void tail.then(() => {
      if (this.sessionLocks.get(sessionId) === tail) {
        this.sessionLocks.delete(sessionId);
      }
    });
    return run;
  }

  /**
   * 非流式 chat:build 模式走 Session+memory;plan 模式直连 LLM 不带记忆
   */
  async chat(
    message: string,
    payload: IDESnapshot | AgentContext,
    sessionId = 'default',
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    await this.initialize();

    if (this.agentConfig.mode === 'plan') {
      // plan 模式保持原行为:不走 memory,直接 buildMessages
      const context = payload as AgentContext;
      const provider = createOpenAILLMProvider(this.agentConfig);
      const messages = buildMessages(this.agentConfig, message, context);
      const content = await provider.chat(messages, { signal });
      return this.buildResult(content, 1, []);
    }

    const ideSnapshot = payload as IDESnapshot;
    return this.enqueueSession(sessionId, async () => {
      const session = this.getOrCreateSession(sessionId);
      const result = await session.start(message, ideSnapshot, undefined, signal);
      return this.buildResult(result.mainResult.content, result.mainResult.turns, result.mainResult.toolCalls, result.mainResult.thinking);
    });
  }

  async chatStream(
    message: string,
    payload: IDESnapshot | AgentContext,
    onEvent?: AgentRuntimeEventCallback,
    signal?: AbortSignal,
    sessionId = 'default'
  ): Promise<ChatResult> {
    await this.initialize();

    if (this.agentConfig.mode === 'plan') {
      const context = payload as AgentContext;
      return this.runPlanStream(message, context, onEvent, signal);
    }

    const ideSnapshot = payload as IDESnapshot;

    const emit = (e: AgentRuntimeEvent) => onEvent?.(e);
    const sessionEvent = (se: SessionEvent) => {
      switch (se.type) {
        case 'chunk':
          emit({ type: 'chunk', text: se.data });
          break;
        case 'thinking':
          emit({ type: 'thinking', text: se.data });
          break;
        case 'tool_start':
          emit({ type: 'tool_start', toolName: se.toolType, toolLabel: se.toolLabel, toolParams: se.toolParams });
          break;
        case 'tool_end':
          emit({ type: 'tool_end', toolName: se.toolType, durationMs: se.durationMs, fileChanges: se.fileChanges });
          break;
        case 'tool_result':
          emit({ type: 'tool_result', toolName: se.toolType, text: se.data });
          break;
        case 'done':
          break;
        case 'error':
          emit({ type: 'error', error: se.data });
          break;
      }
    };

    return this.enqueueSession(sessionId, async () => {
      const session = this.getOrCreateSession(sessionId);
      try {
        const result = await session.startStream(message, ideSnapshot, sessionEvent, signal);
        emit({ type: 'done' });
        return this.buildResult(result.mainResult.content, result.mainResult.turns, result.mainResult.toolCalls, result.mainResult.thinking);
      } catch (e: any) {
        emit({ type: 'error', error: e.message || String(e) });
        throw e;
      }
    });
  }

  get mcpStatus(): { serverCount: number; toolCount: number } {
    if (!this.mcpManager) return { serverCount: 0, toolCount: 0 };
    return {
      serverCount: this.mcpManager.serverCount,
      toolCount: this.mcpTools.length,
    };
  }

  /** MCP 工具元数据（供 CLI /tools 等展示）；未连接时为空数组 */
  listMcpTools(): ReturnType<McpManager['getTools']> {
    return this.mcpManager?.getTools() ?? [];
  }

  get fileSystem(): IAgentFileSystem {
    return this.fs;
  }

  // ====================== Session / Memory 管理 ======================

  private getOrCreateSession(sessionId: string): Session {
    let session = this.sessionMap.get(sessionId);
    if (!session) {
      const agent = this.createAgent(this.getUndoStack(sessionId), sessionId);
      const memory = new SessionMemory(sessionId, this.config.memoryTokenBudget ?? DEFAULT_MEMORY_TOKEN_BUDGET);
      session = new Session(sessionId, agent, memory);
      this.sessionMap.set(sessionId, session);
    }
    return session;
  }

  private getUndoStack(sessionId: string): FileUndoStack {
    let stack = this.undoStacks.get(sessionId);
    if (!stack) {
      stack = new FileUndoStack();
      this.undoStacks.set(sessionId, stack);
    }
    return stack;
  }

  /** 撤销该会话最近一次 Agent 写盘 */
  async undoLastFileChange(sessionId = 'default'): Promise<
    | { ok: true; path: string; existed: boolean; bytes: number }
    | { ok: false; reason: string }
  > {
    const stack = this.undoStacks.get(sessionId);
    if (!stack) return { ok: false, reason: 'undo stack empty' };
    return stack.undoLast(this.config.workspaceRoot);
  }

  getUndoStackSize(sessionId = 'default'): number {
    return this.undoStacks.get(sessionId)?.size ?? 0;
  }

  /** 返回展示用消息(给前端 GET 接口用) */
  getSessionDisplayMessages(sessionId: string): DisplayMessage[] {
    const session = this.sessionMap.get(sessionId);
    return session ? session.memory.projectToDisplay() : [];
  }

  /** 返回序列化的 memory(用于 workspace.json 持久化) */
  serializeSessionMemory(sessionId: string): SerializedSessionMemory | null {
    const session = this.sessionMap.get(sessionId);
    return session ? session.memory.serialize() : null;
  }

  /** 用持久化数据恢复 session memory */
  restoreSessionMemory(sessionId: string, data: unknown): void {
    const agent = this.createAgent(this.getUndoStack(sessionId), sessionId);
    const memory = new SessionMemory(sessionId, this.config.memoryTokenBudget ?? DEFAULT_MEMORY_TOKEN_BUDGET);
    memory.deserialize(data);
    const session = new Session(sessionId, agent, memory);
    this.sessionMap.set(sessionId, session);
  }

  /** 调整已存在 session 的 token 预算(配置变更时用) */
  setSessionTokenBudget(sessionId: string, budget: number): void {
    const session = this.sessionMap.get(sessionId);
    if (session) session.memory.setTokenBudget(budget);
  }

  getSessionIds(): string[] {
    return Array.from(this.sessionMap.keys());
  }

  deleteSession(sessionId: string): void {
    const session = this.sessionMap.get(sessionId);
    if (session) session.memory.clear();
    this.sessionMap.delete(sessionId);
  }

  /** 每请求/设置变更时切换权限模式（影响后续工具闸门） */
  setPermissionMode(mode: NonNullable<AgentRuntimeConfig['permissionMode']>): void {
    this.config.permissionMode = mode;
    this.agentConfig.permissionMode = mode;
    for (const session of this.sessionMap.values()) {
      session.setPermissionMode(mode);
    }
  }

  /**
   * 刷新 LLM 凭证/模型（工作区 runtime 打开后用户可能新配了 API Key）。
   * 会替换各会话主 Agent，但保留 SessionMemory。
   */
  setProviderCredentials(provider: {
    apiUrl?: string;
    apiKey?: string;
    model?: string;
  }): void {
    const next = {
      apiUrl: provider.apiUrl || this.agentConfig.apiUrl,
      apiKey: provider.apiKey || this.agentConfig.apiKey,
      model: provider.model || this.agentConfig.model,
    };
    this.config.provider = next;
    this.agentConfig.apiUrl = next.apiUrl;
    this.agentConfig.apiKey = next.apiKey;
    this.agentConfig.model = next.model;

    for (const [sessionId, session] of this.sessionMap.entries()) {
      const agent = this.createAgent(this.getUndoStack(sessionId), sessionId);
      session.replaceMainAgent(agent);
      session.setPermissionMode(this.config.permissionMode || 'suggest');
    }
    log.debug('provider credentials updated on runtime', {
      hasKey: Boolean(next.apiKey),
      model: next.model,
    });
  }

  // ====================== 内部实现 ======================

  private createAgent(undoStack?: FileUndoStack, sessionId?: string): Agent {
    return new Agent(
      {
        id: 'main',
        name: 'Main Agent',
        systemPrompt: this.agentConfig.systemPrompt || DEFAULT_SYSTEM_PROMPT,
        temperature: this.agentConfig.temperature,
        maxTokens: this.agentConfig.maxTokens,
        maxTurns: this.config.maxTurns,
      },
      this.agentConfig,
      this.config.workspaceRoot,
      this.mcpTools.length > 0 ? this.mcpTools : undefined,
      {
        approver: this.approver,
        permissionMode: this.config.permissionMode,
        undoStack,
        sessionId,
      },
    );
  }

  private async runPlanStream(
    message: string,
    context: AgentContext,
    onEvent?: AgentRuntimeEventCallback,
    signal?: AbortSignal,
  ): Promise<ChatResult> {
    const emit = (e: AgentRuntimeEvent) => onEvent?.(e);
    const provider = createOpenAILLMProvider(this.agentConfig);
    const messages = buildMessages(this.agentConfig, message, context);
    try {
      const content = await provider.chatStream(messages, (type, text) => {
        emit({ type: type === 'thinking' ? 'thinking' : 'chunk', text });
      }, { signal });
      emit({ type: 'done' });
      return this.buildResult(content, 1, []);
    } catch (e: any) {
      emit({ type: 'error', error: e.message || String(e) });
      throw e;
    }
  }

  private buildResult(
    content: string,
    turns: number,
    toolCalls: { type: string; params: Record<string, string> }[],
    thinking?: string,
  ): ChatResult {
    return {
      content,
      turns,
      toolCalls,
      thinking,
    };
  }
}
