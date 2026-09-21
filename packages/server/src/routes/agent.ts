import { Router, Request, Response } from 'express';
import {
  AgentRuntime,
  type AgentRuntimeConfig,
  type AgentRuntimeEvent,
  type AgentContext,
  type IDESnapshot,
} from '@openwork/agent';
import { createLogger, buildApprovalPreview } from '@openwork/agent';
import { loadEnabledMcpServers } from './mcp';
import type { WorkspaceManager } from '../workspace/manager';
import type { LLMGateway } from '@openwork/agent';
import { approvalBroker, resolveRequestPermissionMode, handleApprovalDecision } from '../approval-broker';

const log = createLogger('AgentRouter');

/** bash 工具开关:默认启用;OPENWORK_ENABLE_BASH=0/false 时关闭 */
function resolveEnableBash(): boolean {
  const v = process.env.OPENWORK_ENABLE_BASH;
  if (v === undefined || v === '') return true;
  return !(v === '0' || v.toLowerCase() === 'false');
}

function buildRuntimeConfig(body: Record<string, unknown>, configDir: string, llmGateway: LLMGateway, workspaceRoot?: string): AgentRuntimeConfig {
  const cfg = (body.config as any) || body;
  const mode = (cfg.mode || 'plan') as 'build' | 'plan';
  const providerId = cfg.providerId as string | undefined;

  const provider = providerId
    ? llmGateway.getProvider(providerId)
    : llmGateway.getActiveProvider();

  return {
    mode,
    provider: {
      apiUrl: provider?.apiUrl || '',
      apiKey: provider?.apiKey || '',
      model: provider?.model || '',
    },
    systemPrompt: cfg.systemPrompt,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    workspaceRoot: workspaceRoot || process.cwd(),
    mcpServers: mode === 'build' ? loadEnabledMcpServers(configDir) : undefined,
    memoryTokenBudget: cfg.memoryTokenBudget ? Number(cfg.memoryTokenBudget) : undefined,
    enableBash: resolveEnableBash(),
    permissionMode: resolveRequestPermissionMode(cfg.permissionMode),
    toolProtocol: cfg.toolProtocol === 'fc' || cfg.toolProtocol === 'auto' || cfg.toolProtocol === 'xml'
      ? cfg.toolProtocol
      : undefined,
    approver: approvalBroker.request,
  };
}

/** 把当前 Provider 凭证刷进已缓存的 workspace runtime（打开工作区后再配 Key 也要生效） */
function applyProviderToRuntime(
  runtime: AgentRuntime,
  cfg: Record<string, unknown>,
  llmGateway: LLMGateway,
): { apiKey?: string; model?: string; apiUrl?: string } {
  const providerId = cfg.providerId as string | undefined;
  const provider = providerId
    ? llmGateway.getProvider(providerId)
    : llmGateway.getActiveProvider();
  const credentials = {
    apiUrl: provider?.apiUrl,
    apiKey: provider?.apiKey,
    model: provider?.model,
  };
  runtime.setProviderCredentials(credentials);
  log.info(
    `apply provider: id=${providerId || 'active'} name=${provider?.name || 'none'} hasKey=${Boolean(credentials.apiKey)} model=${credentials.model || 'none'}`,
    {
      providerId: providerId || null,
      providerName: provider?.name,
      hasKey: Boolean(credentials.apiKey),
      model: credentials.model,
    },
  );
  return credentials;
}

interface StreamRequestBody {
  message: string;
  /** build 模式:IDE 快照(激活文件 + 其他 tab 路径 + 文件树 + 光标/选区) */
  ideSnapshot?: IDESnapshot;
  /** plan 模式:沿用旧 AgentContext */
  context?: AgentContext;
  workspaceRoot?: string;
  workspaceId?: string;
  sessionId?: string;
  config?: Record<string, unknown>;
}

export function createAgentRouter(configDir: string, workspaceManager: WorkspaceManager, llmGateway: LLMGateway) {
  const router = Router();

  async function getRuntime(reqBody: Record<string, unknown>, workspaceRootOverride?: string): Promise<AgentRuntime> {
    const body = reqBody as unknown as StreamRequestBody;
    // Reuse workspace-cached runtime when workspaceId is provided
    if (body.workspaceId) {
      const existing = workspaceManager.getRuntime(body.workspaceId);
      if (existing) return existing; // REUSE — MCP already connected

      // Workspace not in memory (server restart / hot reload).
      // Re-open from disk to restore sessions + workspace data.
      const wsRoot = workspaceRootOverride ?? body.workspaceRoot;
      if (wsRoot) {
        try {
          log.info(`Workspace ${body.workspaceId} not in memory, re-opening from ${wsRoot}`);
          const data = await workspaceManager.openWorkspace(wsRoot, llmGateway);
          // openWorkspace generates a new workspaceId if the old workspace.json
          // doesn't have one. Use the returned workspaceId going forward.
          // But the frontend still sends the old workspaceId — so we need to
          // also make the old workspaceId work. The simplest way: if the
          // re-opened workspace has a different ID, just use its runtime
          // directly (the old ID is now stale but the runtime is fresh).
          const runtime = workspaceManager.getRuntime(data.workspaceId);
          if (runtime) return runtime;
        } catch (e: any) {
          log.warn(`Re-open workspace failed: ${e.message}`);
        }
      }

      // Last resort: create a bare runtime (no restored sessions, no persistence)
      const fallbackRoot = wsRoot || process.cwd();
      const runtime = new AgentRuntime(buildRuntimeConfig(reqBody, configDir, llmGateway, fallbackRoot));
      workspaceManager.cacheRuntime(body.workspaceId, runtime);
      return runtime;
    }
    // No workspace: create throwaway runtime
    const wsRoot = workspaceRootOverride || body.workspaceRoot;
    return new AgentRuntime(buildRuntimeConfig(reqBody, configDir, llmGateway, wsRoot));
  }

  router.post('/chat', async (req: Request, res: Response) => {
    try {
      const { message, context, ideSnapshot, sessionId } = req.body as StreamRequestBody;
      if (!message) {
        res.status(400).json({ error: 'message is required' });
        return;
      }

      const runtime = await getRuntime(req.body);
      if (req.body.workspaceId) {
        const latestMcpServers = loadEnabledMcpServers(configDir);
        await runtime.reinitialize(latestMcpServers.length > 0 ? latestMcpServers : undefined);
      }
      const cfg = (req.body.config as any) || {};
      applyProviderToRuntime(runtime, cfg, llmGateway);
      runtime.setPermissionMode(resolveRequestPermissionMode(cfg.permissionMode));

      // build 模式:走 ideSnapshot;plan 模式:走 context
      const payload = ideSnapshot ?? context;
      const result = await runtime.chat(message, payload as IDESnapshot | AgentContext, sessionId || 'default');

      // 流结束后同步 session memory 到 workspace.json
      if (req.body.workspaceId && sessionId) {
        await workspaceManager.persistSessionMemory(req.body.workspaceId, sessionId);
      }

      res.json({
        id: `agent_${Date.now()}`,
        role: 'assistant',
        content: result.content,
        thinking: result.thinking,
        timestamp: Date.now(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  router.post('/stream', async (req: Request, res: Response) => {
    const body = req.body as StreamRequestBody;
    const { message, context, ideSnapshot, workspaceRoot, workspaceId, sessionId } = body;
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const reqLog = log.child({ requestId, mode: body.config?.mode });
    reqLog.info(`Stream request started (workspaceId=${workspaceId || 'none'})`);

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const writeSSE = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 将本连接接到确认代理：pending 时把 approval_required 推给前端
    const requestSessionId = sessionId || 'default';
    const unsubscribeApproval = approvalBroker.subscribe((approvalReq) => {
      // 仅推送与当前请求匹配的 approval（无 sessionId 的旧事件仍推送，前端兜底）
      if (approvalReq.sessionId && approvalReq.sessionId !== requestSessionId) return;
      writeSSE({
        approval_required: {
          approvalId: approvalReq.approvalId,
          toolName: approvalReq.toolName,
          label: approvalReq.label,
          mode: approvalReq.mode,
          preview: buildApprovalPreview(approvalReq.params),
          sessionId: approvalReq.sessionId,
        },
      });
    });

    const runtime = await getRuntime(req.body, workspaceRoot);
    const startMs = Date.now();

    if (body.workspaceId) {
      const latestMcpServers = loadEnabledMcpServers(configDir);
      await runtime.reinitialize(latestMcpServers.length > 0 ? latestMcpServers : undefined);
    }

    const keepAlive = setInterval(() => { res.write(': heartbeat\n\n'); }, 15000);

    try {
      // 每请求覆盖权限模式（前端设置 / 默认 auto-edit）并刷新 LLM 凭证
      const cfg = (body.config as any) || {};
      applyProviderToRuntime(runtime, cfg, llmGateway);
      runtime.setPermissionMode(resolveRequestPermissionMode(cfg.permissionMode));

      const mcpStatus = runtime.mcpStatus;
      if (mcpStatus.serverCount > 0) {
        await runtime.initialize();
        reqLog.info(`MCP initialized: ${mcpStatus.serverCount} server(s), ${mcpStatus.toolCount} tool(s)`);
        writeSSE({ tool_start: { toolType: 'mcp', toolLabel: `MCP: ${mcpStatus.serverCount} server(s), ${mcpStatus.toolCount} tool(s)`, toolParams: {} } });
      }

      reqLog.info('Stream started');
      // build 模式:走 ideSnapshot;plan 模式:走 context
      const payload = ideSnapshot ?? context;
      const result = await runtime.chatStream(
        message,
        payload as IDESnapshot | AgentContext,
        (e: AgentRuntimeEvent) => {
          switch (e.type) {
            case 'chunk':
              writeSSE({ chunk: e.text });
              break;
            case 'thinking':
              writeSSE({ thinking: e.text });
              break;
            case 'tool_start':
              writeSSE({ tool_start: { toolType: e.toolName, toolLabel: e.toolLabel || '', toolParams: e.toolParams || {} } });
              break;
            case 'tool_end':
              writeSSE({
                tool_end: {
                  toolType: e.toolName,
                  durationMs: e.durationMs || 0,
                  fileChanges: e.fileChanges,
                },
              });
              if (e.fileChanges && e.fileChanges.length > 0) {
                const paths = Array.from(new Set(e.fileChanges.map((c) => c.path)));
                writeSSE({ file_changed: { paths, fileChanges: e.fileChanges } });
              }
              break;
            case 'tool_result':
              writeSSE({ tool_result: { name: e.toolName, content: e.text } });
              break;
            case 'done':
              break;
            case 'error':
              writeSSE({ error: e.error });
              break;
          }
        },
        undefined,
        sessionId || 'default'
      );

      reqLog.info(`Stream done: ${Date.now() - startMs}ms, ${result.content.length} chars, ${result.toolCalls.length} tool calls`);

      // 流结束 → 立即把 session memory 序列化并写入 workspace.json
      if (workspaceId && sessionId) {
        try {
          await workspaceManager.persistSessionMemory(workspaceId, sessionId);
        } catch (e: any) {
          reqLog.warn(`persistSessionMemory failed: ${e.message}`);
        }
      }

      writeSSE({ done: true, toolCalls: result.toolCalls.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      reqLog.error(`Stream error: ${msg}`);
      // 失败也落盘，避免用户消息在内存里丢失
      if (workspaceId && sessionId) {
        try {
          await workspaceManager.persistSessionMemory(workspaceId, sessionId);
        } catch (e: any) {
          reqLog.warn(`persistSessionMemory after error failed: ${e.message}`);
        }
      }
      writeSSE({ error: msg });
      writeSSE({ done: true });
    } finally {
      clearInterval(keepAlive);
      unsubscribeApproval();
      if (!body.workspaceId) {
        try { await runtime.dispose(); } catch { /* ignore */ }
      }
    }
  });

  /** 前端确认结果回传 */
  router.post('/approval', (req: Request, res: Response) => {
    const { approvalId, decision } = req.body as {
      approvalId?: string;
      decision?: string;
    };
    if (!approvalId || (decision !== 'allow' && decision !== 'deny')) {
      res.status(400).json({ error: 'approvalId and decision (allow|deny) required' });
      return;
    }
    const ok = handleApprovalDecision(approvalId, decision);
    res.json({ success: ok });
  });

  /** 撤销最近一次 Agent 写盘 */
  router.post('/undo', async (req: Request, res: Response) => {
    try {
      const { workspaceId, workspaceRoot, sessionId } = req.body as {
        workspaceId?: string;
        workspaceRoot?: string;
        sessionId?: string;
      };
      const runtime = await getRuntime(req.body, workspaceRoot);
      const result = await runtime.undoLastFileChange(sessionId || 'default');
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ ok: false, reason: msg });
    }
  });

  return router;
}
