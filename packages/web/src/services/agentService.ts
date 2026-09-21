import { i18n } from '../locales';
import { webAgentLog } from './logger';
import type { IDESnapshot } from '@openwork/agent';

declare const __SERVER_PORT__: number;

const DEFAULT_BASE_URL: string = typeof __SERVER_PORT__ !== 'undefined'
  ? `http://localhost:${__SERVER_PORT__}`
  : '';


/** Agent 运行配置 */
export interface AgentConfig {
  mode: 'build' | 'plan';
  providerId?: string;
  model?: string;
  apiUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  memoryTokenBudget?: number;
  /** 权限模式；桌面默认 auto-edit（写文件自动，bash 需确认） */
  permissionMode?: 'suggest' | 'auto-edit' | 'full-auto';
  toolProtocol?: 'xml' | 'fc' | 'auto';
}

/** SSE 推送的截断预览 */
export interface ApprovalPreview {
  path?: string;
  commandPreview?: string;
  contentPreview?: string;
  oldPreview?: string;
  newPreview?: string;
  contentLength?: number;
}

/** 服务端推来的待确认请求 */
export interface ApprovalRequiredEvent {
  approvalId: string;
  toolName: string;
  label: string;
  mode: string;
  preview?: ApprovalPreview;
  sessionId?: string;
}

/** 对话消息 */
export interface AgentMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  timestamp: number;
}

/** SSE 流式事件类型 */
export interface StreamEvent {
  type: 'tool_start' | 'tool_end' | 'tool_result' | 'thinking_start' | 'thinking_end' | 'file_changed';
  /** tool_result 的内容文本 */
  content?: string;
  /** 工具类型(tool_start/tool_end) */
  toolType?: string;
  /** 工具标签(tool_start) */
  toolLabel?: string;
  /** 工具参数(tool_start) */
  toolParams?: Record<string, string>;
  /** 工具执行耗时毫秒(tool_end) */
  durationMs?: number;
  /** Agent 写盘路径（相对 workspaceRoot） */
  paths?: string[];
}

/** 流式请求 body —— 与 server 端 StreamRequestBody 对齐 */
export interface StreamRequestBody {
  message: string;
  ideSnapshot?: IDESnapshot;
  workspaceRoot?: string;
  workspaceId?: string;
  sessionId?: string;
  config?: AgentConfig;
}

export function createAgentService(baseUrl = DEFAULT_BASE_URL) {
  async function sendApproval(approvalId: string, decision: 'allow' | 'deny'): Promise<{ success: boolean }> {
    const res = await fetch(`${baseUrl}/api/agent/approval`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approvalId, decision }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { success: data.success === true };
  }

  return {
    sendApproval,
    get baseUrl() { return baseUrl; },

    async sendMessage(
      message: string,
      body: Partial<StreamRequestBody>,
      config: AgentConfig,
    ): Promise<AgentMessage> {
      const fullBody: StreamRequestBody = {
        message,
        ideSnapshot: body.ideSnapshot,
        workspaceRoot: body.workspaceRoot,
        workspaceId: body.workspaceId,
        sessionId: body.sessionId,
        config,
      };
      const res = await fetch(`${baseUrl}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody),
      });
      if (!res.ok) throw new Error(`${i18n.global.t('errors.apiError')}: ${res.status}`);
      return res.json();
    },

    async streamMessage(
      message: string,
      body: Partial<StreamRequestBody>,
      config: AgentConfig,
      onChunk: (type: 'thinking' | 'content', text: string) => void,
      onEvent?: (event: StreamEvent) => void,
      options?: {
        signal?: AbortSignal;
        /** 收到服务端 approval_required 时回调（负责弹窗+POST，返回最终决策） */
        onApprovalRequired?: (req: ApprovalRequiredEvent) => Promise<'allow' | 'deny'>;
      },
    ): Promise<AgentMessage> {
      const fullBody: StreamRequestBody = {
        message,
        ideSnapshot: body.ideSnapshot,
        workspaceRoot: body.workspaceRoot,
        workspaceId: body.workspaceId,
        sessionId: body.sessionId,
        config,
      };
      const res = await fetch(`${baseUrl}/api/agent/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullBody),
        signal: options?.signal,
      });

      if (!res.ok) {
        const errText = await res.text();
        const msg = `${i18n.global.t('errors.apiError')} ${res.status}: ${errText}`;
        webAgentLog.error(`streamMessage fetch error: ${msg}`);
        throw new Error(msg);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error(i18n.global.t('errors.streamNotAvailable'));

      const decoder = new TextDecoder();
      let fullContent = '';
      let fullThinking = '';
      let buffer = '';
      let thinkingActive = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() || '';

        let streamDone = false;
        for (const line of parts) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.error) throw new Error(data.error);
            if (data.done) {
              streamDone = true;
              break;
            }

            if (data.approval_required && options?.onApprovalRequired) {
              const req = data.approval_required as ApprovalRequiredEvent;
              // 回调负责展示弹窗 + POST 到服务端；返回最终决策
              await options.onApprovalRequired(req);
              continue;
            }

            if (data.file_changed && onEvent) {
              const fc = data.file_changed as { paths?: string[] };
              onEvent({
                type: 'file_changed',
                paths: fc.paths || [],
              });
            }

            if (data.tool_start && onEvent) {
              const ts = typeof data.tool_start === 'string'
                ? { toolType: 'tool', toolLabel: data.tool_start, toolParams: {} }
                : data.tool_start;
              onEvent({
                type: 'tool_start',
                toolType: ts.toolType || 'tool',
                toolLabel: ts.toolLabel || '',
                toolParams: ts.toolParams || {},
              });
            } else if (data.tool_end && onEvent) {
              const te = typeof data.tool_end === 'string'
                ? { toolType: data.tool_end, durationMs: 0 }
                : data.tool_end;
              onEvent({
                type: 'tool_end',
                toolType: te.toolType,
                durationMs: te.durationMs || 0,
              });
            } else if (data.tool_result && onEvent) {
              const tr = data.tool_result;
              onEvent({
                type: 'tool_result',
                content: typeof tr === 'string' ? tr : (tr?.content || ''),
              });
            }

            if (data.thinking) {
              if (!thinkingActive) {
                thinkingActive = true;
                if (onEvent) onEvent({ type: 'thinking_start' });
              }
              fullThinking += data.thinking;
              onChunk('thinking', data.thinking);
            }

            if (data.chunk) {
              if (thinkingActive) {
                thinkingActive = false;
                if (onEvent) onEvent({ type: 'thinking_end' });
              }
              fullContent += data.chunk;
              onChunk('content', data.chunk);
            }
          } catch {
            // skip unparseable SSE lines
          }
        }
        if (streamDone) break;
      }

      if (thinkingActive && onEvent) {
        onEvent({ type: 'thinking_end' });
      }

      return {
        id: `agent_${Date.now()}`,
        role: 'assistant',
        content: fullContent,
        thinking: fullThinking,
        timestamp: Date.now(),
      };
    },
  };
}
