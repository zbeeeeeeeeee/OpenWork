import {
  ApprovalBroker,
  type ApprovalDecision,
  type PermissionMode,
} from '@openwork/agent';
import { createLogger } from '@openwork/agent';

const log = createLogger('ApprovalBroker');

/** Server 进程级确认代理（SSE approval_required + POST /api/agent/approval） */
export const approvalBroker = new ApprovalBroker();

/**
 * 产品权限模式：
 * - 环境变量 OPENWORK_PERMISSION_MODE 可强制
 * - 否则由请求 config.permissionMode 指定
 * - 都未指定时默认 full-auto（无 UI 的 headless 兼容；前端会显式传 auto-edit）
 */
export function resolveRequestPermissionMode(requested?: string): PermissionMode {
  const env = process.env.OPENWORK_PERMISSION_MODE?.toLowerCase();
  if (env === 'suggest' || env === 'auto-edit' || env === 'full-auto') {
    return env;
  }
  if (requested === 'suggest' || requested === 'auto-edit' || requested === 'full-auto') {
    return requested;
  }
  return 'full-auto';
}

export function handleApprovalDecision(approvalId: string, decision: ApprovalDecision): boolean {
  const ok = approvalBroker.resolve(approvalId, decision);
  log.info(`approval resolve id=${approvalId} decision=${decision} ok=${ok}`, {
    approvalId,
    decision,
    ok,
  });
  return ok;
}
