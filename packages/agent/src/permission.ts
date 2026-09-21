/**
 * 工具执行权限闸门（桌面本地优先）。
 *
 * - suggest：非只读工具均需确认（默认最安全）
 * - auto-edit：文件写改自动；bash / destructive 需确认
 * - full-auto：全部自动（仅本地可信环境 / 脚本）
 */
export type PermissionMode = 'suggest' | 'auto-edit' | 'full-auto';

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'suggest';

export type ApprovalDecision = 'allow' | 'deny';

export interface ApprovalRequest {
  /** 确认请求 ID，供前端回传 allow/deny */
  approvalId: string;
  toolName: string;
  params: Record<string, string>;
  /** 人类可读预览（大参数已截断） */
  label: string;
  mode: PermissionMode;
  /** 发起此确认的会话 ID（用于 SSE 过滤，避免跨会话污染） */
  sessionId?: string;
  /** 发起此确认的工作区 ID */
  workspaceId?: string;
}

/** SSE 推送给前端的截断预览（避免传输全量 params） */
export interface ApprovalPreview {
  path?: string;
  commandPreview?: string;
  contentPreview?: string;
  oldPreview?: string;
  newPreview?: string;
  contentLength?: number;
}

/**
 * 构建确认弹窗用的截断预览。
 * 只保留展示所需字段，content/old/new 均截断。
 */
export function buildApprovalPreview(params: Record<string, string>): ApprovalPreview {
  return {
    path: params.path,
    commandPreview: params.command ? previewParam(params.command, 200) : undefined,
    contentPreview: params.content ? previewParam(params.content, 500) : undefined,
    oldPreview: params.old ? previewParam(params.old, 300) : undefined,
    newPreview: params.new ? previewParam(params.new, 300) : undefined,
    contentLength: params.content?.length,
  };
}

export type Approver = (req: ApprovalRequest) => Promise<ApprovalDecision> | ApprovalDecision;

/** 单参数预览截断，避免大文件内容刷屏 */
export function previewParam(value: string, max = 120): string {
  const v = value ?? '';
  if (v.length <= max) return v;
  return `${v.slice(0, max)}…(${v.length} chars)`;
}

/** 拼接确认用 label */
export function buildApprovalLabel(
  toolName: string,
  params: Record<string, string>,
): string {
  const path = params.path;
  const command = params.command;
  if (command) return `${toolName} \`${previewParam(command, 80)}\``;
  if (path) {
    const extras: string[] = [];
    if (params.old) extras.push(`old=${previewParam(params.old, 40)}`);
    if (params.new) extras.push(`new=${previewParam(params.new, 40)}`);
    if (params.content) extras.push(`content=${previewParam(params.content, 40)}`);
    return extras.length
      ? `${toolName} ${path} (${extras.join(', ')})`
      : `${toolName} ${path}`;
  }
  const keys = Object.keys(params);
  if (keys.length === 0) return toolName;
  return `${toolName} ${keys.map((k) => `${k}=${previewParam(params[k] || '', 40)}`).join(' ')}`;
}

export interface ToolPermissionHints {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  name: string;
}

/** 是否需要用户确认 */
export function requiresApproval(
  tool: ToolPermissionHints,
  mode: PermissionMode,
): boolean {
  if (mode === 'full-auto') return false;
  if (tool.readOnlyHint === true) return false;
  if (mode === 'auto-edit') {
    return tool.name === 'bash' || tool.destructiveHint === true;
  }
  // suggest：一切非只读
  return true;
}

/** 无 approver 时的默认决策：除 full-auto 外一律 deny */
export function defaultDecision(mode: PermissionMode): ApprovalDecision {
  return mode === 'full-auto' ? 'allow' : 'deny';
}

export function resolvePermissionMode(requested?: PermissionMode): PermissionMode {
  return requested || DEFAULT_PERMISSION_MODE;
}

let approvalSeq = 0;
export function nextApprovalId(): string {
  approvalSeq += 1;
  return `apr_${Date.now().toString(36)}_${approvalSeq}`;
}

/**
 * 进程内确认代理：Approver 阻塞等待 UI/HTTP 回传决策。
 * 供 Server SSE / Electron 桥使用；CLI 用 readline Approver 不走这里。
 */
export class ApprovalBroker {
  private pending = new Map<
    string,
    {
      resolve: (d: ApprovalDecision) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private listeners = new Set<(req: ApprovalRequest) => void>();

  /** 作为 Approver 注入 AgentRuntime */
  request = (req: ApprovalRequest): Promise<ApprovalDecision> => {
    return new Promise<ApprovalDecision>((resolve) => {
      const id = req.approvalId;
      const timeoutMs = Number(process.env.OPENWORK_APPROVAL_TIMEOUT_MS) || 60_000;
      const timer = setTimeout(() => {
        this.finish(id, 'deny');
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      for (const l of this.listeners) {
        try {
          l(req);
        } catch {
          /* ignore listener errors */
        }
      }
    });
  };

  subscribe(listener: (req: ApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    return this.finish(approvalId, decision);
  }

  private finish(id: string, decision: ApprovalDecision): boolean {
    const p = this.pending.get(id);
    if (!p) return false;
    clearTimeout(p.timer);
    this.pending.delete(id);
    p.resolve(decision);
    return true;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
