import { createLogger } from '../logger';
import { LOG_CATEGORY } from '../log-categories';
import { sanitizeThinking, sanitizeDisplayContent } from '../sanitize';
import {
  type MemoryEntry,
  type ToolCallRecord,
  type IDESnapshot,
  type LLMMessage,
  type DisplayMessage,
  type DisplayBlock,
  type SerializedSessionMemory,
  CHARS_PER_TOKEN,
  DEFAULT_MEMORY_TOKEN_BUDGET,
} from './types';

const log = createLogger(LOG_CATEGORY.MEMORY);

/**
 * SessionMemory —— 会话级记忆模块,替代旧的 Session.messages 与前端透传的 conversationHistory。
 *
 * 三种正交投影:
 * 1. projectToLLMMessages: 投影为 openai 格式消息数组,自动按 token 预算滑窗
 * 2. projectToDisplay:     投影为前端展示用的 DisplayMessage[](block 化时间轴)
 * 3. serialize/deserialize:序列化为可持久化的 SerializedSessionMemory
 *
 * 写入后由 Session 在流结束时调用 persist();前端通过 GET 拉取 projectToDisplay 结果。
 */
export class SessionMemory {
  readonly sessionId: string;
  private entries: MemoryEntry[] = [];
  private tokenBudget: number;

  constructor(sessionId: string, tokenBudget: number = DEFAULT_MEMORY_TOKEN_BUDGET) {
    this.sessionId = sessionId;
    this.tokenBudget = tokenBudget;
  }

  /** 调整 token 预算(配置变更时使用) */
  setTokenBudget(budget: number): void {
    this.tokenBudget = Math.max(1024, budget);
  }

  // ====================== 写入 ======================

  appendUserMessage(content: string): MemoryEntry {
    return this.append({
      role: 'user',
      content,
    });
  }

  appendAssistantMessage(opts: {
    content: string;
    thinking?: string;
    agentId?: string;
    parentAgentId?: string;
    error?: boolean;
  }): MemoryEntry {
    return this.append({
      role: 'assistant',
      content: opts.content,
      thinking: opts.thinking,
      agentId: opts.agentId,
      parentAgentId: opts.parentAgentId,
      error: opts.error,
    });
  }

  appendToolResult(toolCall: ToolCallRecord): MemoryEntry {
    return this.append({
      role: 'tool',
      content: toolCall.result,
      toolCall,
      agentId: toolCall.agentId,
    });
  }

  appendSystemMessage(content: string, error = false): MemoryEntry {
    return this.append({ role: 'system', content, error });
  }

  /** 底层写入入口 */
  append(partial: Omit<MemoryEntry, 'id' | 'sessionId' | 'timestamp'>): MemoryEntry {
    const entry: MemoryEntry = {
      id: this.nextId(),
      sessionId: this.sessionId,
      timestamp: Date.now(),
      ...partial,
    };
    this.entries.push(entry);
    return entry;
  }

  /** 清空记忆(关闭会话用) */
  clear(): void {
    this.entries = [];
  }

  // ====================== 投影 1: 给 LLM ======================

  /**
   * 投影为 LLM 消息数组,自动按 token 预算滑窗。
   *
   * 消息序列:
   *   [system: systemPrompt]
   *   [system: toolsSection]      (若有)
   *   [system: workspaceRoot]
   *   [system: IDE snapshot blocks]
   *   [system: active file content] (若有,单独成条便于 LLM 定位)
   *   [...history entries 按 token 预算从尾部保留]
   *   [user: currentMessage]
   *
   * 滑窗策略:
   *   - System 段永远保留
   *   - 历史从尾部累加,超预算时丢最旧
   *   - 工具调用还原为 assistant(serializeToolCall) + user("Tool result:...") 配对
   *   - 首条 user 消息视为"任务源头",若预算还允许则保留
   */
  projectToLLMMessages(
    systemPrompt: string,
    toolsSection: string | undefined,
    workspaceRoot: string,
    ideSnapshot: IDESnapshot | undefined,
    currentMessage: string,
  ): LLMMessage[] {
    const messages: LLMMessage[] = [];

    // 1. System prompt
    messages.push({ role: 'system', content: systemPrompt });

    // 2. Tools section
    if (toolsSection) {
      messages.push({ role: 'system', content: toolsSection });
    }

    // 3. Workspace root
    messages.push({ role: 'system', content: `## Workspace Root\n${workspaceRoot}` });

    // 4. IDE snapshot
    if (ideSnapshot) {
      const snapshotParts = this.buildIDESnapshotMessages(ideSnapshot);
      messages.push(...snapshotParts);
    }

    // 5. 历史滑窗
    const systemTokens = this.estimateTokens(messages);
    const currentMessageTokens = this.estimateTokens([{ role: 'user', content: currentMessage }]);
    const remainingBudget = this.tokenBudget - systemTokens - currentMessageTokens;
    const historyMessages = this.buildHistoryMessages(Math.max(0, remainingBudget));
    messages.push(...historyMessages);

    // 6. 当前用户消息
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  /** 构造 IDE 快照相关消息(只发激活文件内容 + 其余 tab 路径) */
  private buildIDESnapshotMessages(snapshot: IDESnapshot): LLMMessage[] {
    const parts: string[] = [];

    if (snapshot.openFilePaths && snapshot.openFilePaths.length > 0) {
      const activePath = snapshot.activeFile?.path;
      const otherPaths = snapshot.openFilePaths.filter(p => p !== activePath);
      if (otherPaths.length > 0) {
        parts.push('## Other Open Tabs');
        parts.push(otherPaths.join('\n'));
        parts.push('(Use `read_file` to read these files if needed.)');
      }
    }

    if (snapshot.fileTree && snapshot.fileTree.length > 0) {
      const tree = snapshot.fileTree.slice(0, 200);
      parts.push('\n## Project File Tree');
      parts.push(tree.join('\n'));
      if (snapshot.fileTree.length > tree.length) {
        parts.push(`... (${snapshot.fileTree.length - tree.length} more entries; use list_dir to explore)`);
      }
    }

    if (snapshot.cursorPosition) {
      parts.push(`\n## Cursor Position: ${snapshot.cursorPosition.file}:${snapshot.cursorPosition.line}:${snapshot.cursorPosition.column}`);
    }

    if (snapshot.selection && snapshot.selection.text) {
      parts.push(`\n## Selected Text (${snapshot.selection.file}, lines ${snapshot.selection.startLine}-${snapshot.selection.endLine}):`);
      parts.push('```');
      parts.push(snapshot.selection.text);
      parts.push('```');
    }

    const messages: LLMMessage[] = [];
    if (parts.length > 0) {
      messages.push({ role: 'system', content: parts.join('\n') });
    }
    if (snapshot.activeFile) {
      messages.push({
        role: 'system',
        content: `## Active File: ${snapshot.activeFile.path}\n\`\`\`\n${snapshot.activeFile.content}\n\`\`\``,
      });
    }
    return messages;
  }

  /**
   * 历史滑窗构造:从尾部往头部累加,超预算丢最旧。
   * 工具调用 entry 还原为两条 LLM 消息(assistant 调用 + user 结果)。
   */
  private buildHistoryMessages(tokenBudget: number): LLMMessage[] {
    const result: LLMMessage[] = [];
    let usedTokens = 0;

    // 反向遍历,从最新到最旧
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const entry = this.entries[i]!;
      const msgs = this.entryToLLMMessages(entry);
      const entryTokens = this.estimateTokens(msgs);

      if (usedTokens + entryTokens > tokenBudget) {
        // 预算用完,丢弃更早的
        log.debug(`history sliding window: dropping ${i + 1} older entries (budget=${tokenBudget}, used=${usedTokens})`, {
          sessionId: this.sessionId,
          dropped: i + 1,
        });
        break;
      }

      // 头部插入(因为我们反向遍历)
      result.unshift(...msgs);
      usedTokens += entryTokens;
    }

    return result;
  }

  /** 把单个 entry 还原为 LLM 消息(可能 1 条或 2 条) */
  private entryToLLMMessages(entry: MemoryEntry): LLMMessage[] {
    switch (entry.role) {
      case 'user':
        return [{ role: 'user', content: entry.content }];
      case 'system':
        return [{ role: 'system', content: entry.content }];
      case 'assistant': {
        const msgs: LLMMessage[] = [{ role: 'assistant', content: entry.content }];
        // 若该 assistant 还有 toolCall,补一条工具结果
        if (entry.toolCall) {
          msgs.push({
            role: 'user',
            content: `Tool result (${entry.toolCall.type}):\n${entry.toolCall.result}`,
          });
        }
        return msgs;
      }
      case 'tool': {
        if (!entry.toolCall) return [];
        // 还原为 assistant(工具调用)+ user(工具结果)的配对格式
        return [
          {
            role: 'assistant',
            content: `[Tool call: ${entry.toolCall.type} ${this.serializeParams(entry.toolCall.params)}]`,
          },
          {
            role: 'user',
            content: `Tool result (${entry.toolCall.type}):\n${entry.toolCall.result}`,
          },
        ];
      }
    }
  }

  /** 工具参数简短序列化(给 LLM 看的 assistant 消息用) */
  private serializeParams(params: Record<string, string>): string {
    return Object.entries(params)
      .filter(([, v]) => v)
      .map(([k, v]) => {
        const trimmed = v.length > 60 ? v.slice(0, 60) + '...' : v;
        return `${k}=${trimmed}`;
      })
      .join(', ');
  }

  // ====================== 投影 2: 给前端展示 ======================

  /**
   * 投影为前端展示消息列表。
   * 同一 turn 的 assistant + 关联 tool 调用合并为一条 DisplayMessage,
   * blocks 数组保存该消息内的所有块(thinking / tool_call / response)。
   */
  projectToDisplay(): DisplayMessage[] {
    const result: DisplayMessage[] = [];

    for (const entry of this.entries) {
      switch (entry.role) {
        case 'user':
          result.push({
            id: entry.id,
            role: 'user',
            content: entry.content,
            timestamp: entry.timestamp,
            blocks: [{
              id: `${entry.id}_r`,
              type: 'response',
              content: entry.content,
            }],
          });
          break;

        case 'system':
          result.push({
            id: entry.id,
            role: 'system',
            content: entry.content,
            timestamp: entry.timestamp,
            error: entry.error,
            blocks: [{
              id: `${entry.id}_r`,
              type: 'response',
              content: entry.content,
            }],
          });
          break;

        case 'assistant': {
          const blocks: DisplayBlock[] = [];
          let cleanThinking = entry.thinking ? sanitizeThinking(entry.thinking) : '';
          // 过短思考碎片不进展示，避免英文 "The" 之类噪音
          if (cleanThinking.trim().length < 12) cleanThinking = '';
          let cleanContent = entry.content ? sanitizeDisplayContent(entry.content) : '';
          // 清洗后正文为空、但 thinking 有内容时，不要让 UI 完全空白：
          // 保留 thinking 块；正文用占位提示（避免用户以为没有输出）
          if (!cleanContent && cleanThinking && !entry.toolCall) {
            cleanContent = '*[无额外正文，详见思考过程]*';
          }
          if (cleanThinking) {
            blocks.push({
              id: `${entry.id}_t`,
              type: 'thinking',
              content: cleanThinking,
              completed: true,
            });
          }
          if (cleanContent) {
            blocks.push({
              id: `${entry.id}_r`,
              type: 'response',
              content: cleanContent,
            });
          }
          if (entry.toolCall) {
            blocks.push(this.toolCallToBlock(entry.id, entry.toolCall));
          }
          result.push({
            id: entry.id,
            role: 'assistant',
            content: cleanContent,
            timestamp: entry.timestamp,
            thinking: cleanThinking || undefined,
            blocks,
            error: entry.error,
          });
          break;
        }

        case 'tool': {
          if (!entry.toolCall) break;
          // 工具调用 entry 单独成一条展示消息(便于时间轴布局)
          const block = this.toolCallToBlock(entry.id, entry.toolCall);
          result.push({
            id: entry.id,
            role: 'assistant',
            content: '',
            timestamp: entry.timestamp,
            agentId: entry.agentId,
            blocks: [block],
          });
          break;
        }
      }
    }

    return result;
  }

  private toolCallToBlock(entryId: string, tc: ToolCallRecord): DisplayBlock {
    return {
      id: `${entryId}_tc`,
      type: 'tool_call',
      toolType: tc.type,
      toolLabel: tc.params.path || tc.params.pattern || tc.params.command || '',
      params: tc.params,
      result: tc.result,
      durationMs: tc.durationMs,
      completed: true,
      error: tc.result.startsWith('Error'),
    };
  }

  // ====================== 投影 3: 持久化 ======================

  serialize(): SerializedSessionMemory {
    return {
      sessionId: this.sessionId,
      entries: this.entries,
      schemaVersion: 1,
    };
  }

  /**
   * 从序列化数据恢复。
   * 若 schemaVersion 不匹配或缺字段,清空重来(用户已确认无需迁移老数据)。
   */
  deserialize(data: unknown): void {
    if (!data || typeof data !== 'object') {
      log.warn(`deserialize: invalid data, starting fresh`, { sessionId: this.sessionId });
      this.entries = [];
      return;
    }
    const obj = data as Partial<SerializedSessionMemory>;
    if (obj.schemaVersion !== 1 || !Array.isArray(obj.entries)) {
      log.warn(`deserialize: schema mismatch (got ${obj.schemaVersion}), starting fresh`, { sessionId: this.sessionId });
      this.entries = [];
      return;
    }
    this.entries = obj.entries.filter(e => e && typeof e.id === 'string' && typeof e.content === 'string');
    log.info(`deserialize: ${this.entries.length} entries restored`, { sessionId: this.sessionId });
  }

  // ====================== 查询 ======================

  getEntries(): readonly MemoryEntry[] {
    return this.entries;
  }

  get size(): number {
    return this.entries.length;
  }

  /** 估算 token 数:字符数 / 4 (粗略,避免 tiktoken 依赖) */
  private estimateTokens(messages: LLMMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      // 每条消息固定 overhead ~4 token(role + 分隔符)
      chars += 4 * CHARS_PER_TOKEN;
      chars += (m.content || '').length;
    }
    return Math.ceil(chars / CHARS_PER_TOKEN);
  }

  private nextId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
