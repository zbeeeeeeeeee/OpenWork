import type { AgentResult } from './types/agent';
import type { IDESnapshot, DisplayMessage, SerializedSessionMemory, ToolCallRecord } from './memory';
import { SessionMemory } from './memory';
import { Agent, type AgentEvent, type AgentEventCallback, type ToolCallReportCallback } from './agent';
import { createLogger } from './logger';
import { LOG_CATEGORY } from './log-categories';

const log = createLogger(LOG_CATEGORY.SESSION);

/** 会话运行结果 */
export interface SessionResult {
  sessionId: string;
  mainResult: AgentResult;
  subResults: AgentResult[];
}

/** 会话事件 */
export interface SessionEvent {
  type: 'chunk' | 'thinking' | 'tool_start' | 'tool_end' | 'tool_result' | 'sub_agent_start' | 'sub_agent_done' | 'done' | 'error';
  agentId?: string;
  data?: string;
  toolType?: string;
  toolLabel?: string;
  /** 工具调用参数(tool_start 时携带) */
  toolParams?: Record<string, string>;
  /** 工具执行耗时(tool_end 时携带) */
  durationMs?: number;
  /** 写盘变更 */
  fileChanges?: import('./types/tool').FileChangeMeta[];
}

export type SessionEventCallback = (event: SessionEvent) => void;

export class Session {
  readonly id: string;
  private mainAgent: Agent;
  private subAgents: Map<string, Agent> = new Map();
  /** 替代旧的 messages: SessionMessage[] —— 结构化记忆模块 */
  readonly memory: SessionMemory;

  constructor(id: string, mainAgent: Agent, memory?: SessionMemory) {
    this.id = id;
    this.mainAgent = mainAgent;
    this.memory = memory ?? new SessionMemory(id);
  }

  /** 注册子 Agent */
  registerSubAgent(agent: Agent): void {
    this.subAgents.set(agent.definition.id, agent);
  }

  /** 更换主 Agent（保留 memory；用于刷新 LLM 凭证） */
  replaceMainAgent(agent: Agent): void {
    this.mainAgent = agent;
  }

  /** 同步权限模式到主/子 Agent */
  setPermissionMode(mode: import('./permission').PermissionMode): void {
    this.mainAgent.setPermissionMode(mode);
    for (const sub of this.subAgents.values()) {
      sub.setPermissionMode(mode);
    }
  }

  /** 启动主 Agent 处理用户消息(非流式) */
  async start(
    message: string,
    ideSnapshot: IDESnapshot | undefined,
    onEvent?: SessionEventCallback,
    signal?: AbortSignal,
  ): Promise<SessionResult> {
    const emit = (e: SessionEvent) => onEvent?.(e);
    const startMs = Date.now();

    log.info(`Session start: sessionId=${this.id}, agentId=${this.mainAgent.definition.id}`);

    this.memory.appendUserMessage(message);

    let result: AgentResult;
    try {
      result = await this.runAgent(this.mainAgent, message, ideSnapshot, emit, signal);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        agentId: this.mainAgent.definition.id,
        content: `Agent failed: ${msg}`,
        turns: 0,
        toolCalls: [],
        error: msg,
        stopReason: 'error',
      };
      log.error(`Session start failed after appendUserMessage: ${msg}`, {
        sessionId: this.id,
        error: msg,
      });
      emit({ type: 'error', data: msg });
      await this.memoryFinalize(result, this.mainAgent.definition.id);
      emit({ type: 'done' });
      throw e;
    }
    await this.memoryFinalize(result, this.mainAgent.definition.id);

    const subResults = await this.handleDelegation(result, ideSnapshot, emit);

    emit({ type: 'done' });

    log.info(`Session done: ${result.turns} turns, ${subResults.length} sub-agent(s), ${Date.now() - startMs}ms`, {
      sessionId: this.id,
      turns: result.turns,
      subAgents: subResults.length,
      contentLen: result.content.length,
    });

    return {
      sessionId: this.id,
      mainResult: result,
      subResults,
    };
  }

  /** 启动主 Agent 处理用户消息(流式) */
  async startStream(
    message: string,
    ideSnapshot: IDESnapshot | undefined,
    onEvent?: SessionEventCallback,
    signal?: AbortSignal
  ): Promise<SessionResult> {
    const emit = (e: SessionEvent) => onEvent?.(e);
    const startMs = Date.now();

    log.info(`Session stream start: sessionId=${this.id}, agentId=${this.mainAgent.definition.id}`);

    this.memory.appendUserMessage(message);

    let result: AgentResult;
    try {
      result = await this.runAgentStream(this.mainAgent, message, ideSnapshot, emit, signal);
    } catch (e: any) {
      const msg = e instanceof Error ? e.message : String(e);
      result = {
        agentId: this.mainAgent.definition.id,
        content: `Agent failed: ${msg}`,
        turns: 0,
        toolCalls: [],
        error: msg,
        stopReason: 'error',
      };
      log.error(`Session stream failed after appendUserMessage: ${msg}`, {
        sessionId: this.id,
        error: msg,
      });
      emit({ type: 'error', data: msg });
      await this.memoryFinalize(result, this.mainAgent.definition.id);
      emit({ type: 'done' });
      throw e;
    }
    await this.memoryFinalize(result, this.mainAgent.definition.id);

    const subResults = await this.handleDelegation(result, ideSnapshot, emit);

    emit({ type: 'done' });

    log.info(`Session stream done: ${result.turns} turns, ${subResults.length} sub-agent(s), ${Date.now() - startMs}ms`, {
      sessionId: this.id,
      turns: result.turns,
      subAgents: subResults.length,
      contentLen: result.content.length,
    });

    return {
      sessionId: this.id,
      mainResult: result,
      subResults,
    };
  }

  /** 手动将任务委托给子 Agent */
  async delegateToSubAgent(
    agentId: string,
    task: string,
    ideSnapshot: IDESnapshot | undefined,
    onEvent?: AgentEventCallback
  ): Promise<AgentResult> {
    const agent = this.subAgents.get(agentId);
    if (!agent) throw new Error(`Sub-agent "${agentId}" not found`);

    // 子 agent 执行时构造一份消息:基于主 memory 投影,加上当前 task
    const llmMessages = this.memory.projectToLLMMessages(
      agent.getSystemPrompt(),
      agent.getToolsSection(),
      agent.getWorkspaceRoot(),
      ideSnapshot,
      task,
    );

    const toolReport: ToolCallReportCallback = (tc) => {
      this.memory.appendToolResult({ ...tc, agentId, parentAgentId: this.mainAgent.definition.id });
    };

    const result = await agent.execute(llmMessages, onEvent, toolReport);
    this.memory.appendAssistantMessage({
      content: result.content,
      thinking: result.thinking,
      agentId,
      parentAgentId: this.mainAgent.definition.id,
    });
    return result;
  }

  /** 把 AgentResult 落到 memory(主 agent 的 assistant 消息) */
  private async memoryFinalize(result: AgentResult, agentId: string): Promise<void> {
    this.memory.appendAssistantMessage({
      content: result.content,
      thinking: result.thinking,
      agentId,
      error: !!result.error,
    });
  }

  private async runAgent(
    agent: Agent,
    message: string,
    ideSnapshot: IDESnapshot | undefined,
    emit: SessionEventCallback,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
    const llmMessages = this.memory.projectToLLMMessages(
      agent.getSystemPrompt(),
      agent.getToolsSection(),
      agent.getWorkspaceRoot(),
      ideSnapshot,
      message,
    );

    const toolReport: ToolCallReportCallback = (tc) => {
      this.memory.appendToolResult(tc);
    };

    return agent.execute(llmMessages, (e: AgentEvent) => {
      switch (e.type) {
        case 'chunk':
          emit({ type: 'chunk', agentId: agent.definition.id, data: e.text });
          break;
        case 'thinking':
          emit({ type: 'thinking', agentId: agent.definition.id, data: e.text });
          break;
        case 'tool_start':
          emit({ type: 'tool_start', agentId: agent.definition.id, toolType: e.toolType, toolLabel: e.toolLabel, toolParams: e.toolParams });
          break;
        case 'tool_end':
          emit({ type: 'tool_end', agentId: agent.definition.id, toolType: e.toolType, durationMs: e.durationMs, fileChanges: e.fileChanges });
          break;
        case 'tool_result':
          emit({ type: 'tool_result', agentId: agent.definition.id, toolType: e.toolType, data: e.text });
          break;
      }
    }, toolReport, signal);
  }

  private async runAgentStream(
    agent: Agent,
    message: string,
    ideSnapshot: IDESnapshot | undefined,
    emit: SessionEventCallback,
    signal?: AbortSignal
  ): Promise<AgentResult> {
    const llmMessages = this.memory.projectToLLMMessages(
      agent.getSystemPrompt(),
      agent.getToolsSection(),
      agent.getWorkspaceRoot(),
      ideSnapshot,
      message,
    );

    const toolReport: ToolCallReportCallback = (tc) => {
      this.memory.appendToolResult(tc);
    };

    return agent.executeStream(llmMessages, (e: AgentEvent) => {
      switch (e.type) {
        case 'chunk':
          emit({ type: 'chunk', agentId: agent.definition.id, data: e.text });
          break;
        case 'thinking':
          emit({ type: 'thinking', agentId: agent.definition.id, data: e.text });
          break;
        case 'tool_start':
          emit({ type: 'tool_start', agentId: agent.definition.id, toolType: e.toolType, toolLabel: e.toolLabel, toolParams: e.toolParams });
          break;
        case 'tool_end':
          emit({ type: 'tool_end', agentId: agent.definition.id, toolType: e.toolType, durationMs: e.durationMs, fileChanges: e.fileChanges });
          break;
        case 'tool_result':
          emit({ type: 'tool_result', agentId: agent.definition.id, toolType: e.toolType, data: e.text });
          break;
      }
    }, toolReport, signal);
  }

  /** 从主 Agent 结果中解析委托指令并启动子 Agent */
  private async handleDelegation(
    mainResult: AgentResult,
    ideSnapshot: IDESnapshot | undefined,
    emit: SessionEventCallback
  ): Promise<AgentResult[]> {
    const subResults: AgentResult[] = [];
    const delegateRe = /<delegate\s+agent="([^"]+)"\s+task="([^"]*)"\s*\/>/g;
    let m: RegExpExecArray | null;

    while ((m = delegateRe.exec(mainResult.content)) !== null) {
      const agentId = m[1];
      const task = m[2];
      if (!this.subAgents.has(agentId)) continue;

      log.info(`Sub-agent delegation: agentId=${agentId}, task="${task.slice(0, 100)}"`);
      emit({ type: 'sub_agent_start', agentId });

      const subResult = await this.delegateToSubAgent(agentId, task, ideSnapshot);
      subResults.push(subResult);

      log.info(`Sub-agent done: agentId=${agentId}, ${subResult.content.length} chars, ${subResult.turns} turns`);
      emit({ type: 'sub_agent_done', agentId, data: subResult.content });
    }

    return subResults;
  }
}
