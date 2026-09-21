import { ref } from 'vue';
import type { ApprovalRequiredEvent } from '../services/agentService';
import { createAgentService } from '../services/agentService';
import { webAgentLog } from '../services/logger';
import { i18n } from '../locales';

const APPROVAL_CLIENT_TIMEOUT_MS = 55_000;

export function useApprovalDialog() {
  const pendingApproval = ref<ApprovalRequiredEvent | null>(null);
  const dialogVisible = ref(false);
  const errorMessage = ref('');
  let resolver: ((d: 'allow' | 'deny') => void) | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let lastDecision: 'allow' | 'deny' = 'deny';
  const agentService = createAgentService();

  function openApproval(req: ApprovalRequiredEvent): Promise<'allow' | 'deny'> {
    // 若已有未完成请求，先 POST deny 到服务端，再关闭旧弹窗
    if (resolver && pendingApproval.value) {
      const oldId = pendingApproval.value.approvalId;
      webAgentLog.warn(`openApproval: auto-deny previous request ${oldId}`);
      void agentService.sendApproval(oldId, 'deny').catch(() => { /* best-effort */ });
      resolver('deny');
    }

    pendingApproval.value = req;
    dialogVisible.value = true;
    errorMessage.value = '';
    lastDecision = 'deny';

    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = setTimeout(() => {
      webAgentLog.warn('approval client timeout, auto-deny');
      void resolveApproval('deny');
    }, APPROVAL_CLIENT_TIMEOUT_MS);

    return new Promise<'allow' | 'deny'>((resolve) => {
      resolver = resolve;
    });
  }

  async function resolveApproval(decision: 'allow' | 'deny'): Promise<void> {
    const req = pendingApproval.value;
    if (!req || !resolver) return;

    lastDecision = decision;
    try {
      const result = await agentService.sendApproval(req.approvalId, decision);
      if (!result.success) {
        // 服务端已 resolve（超时/重复），直接关闭弹窗
        resolver('deny');
        cleanup();
        return;
      }
      resolver(decision);
      cleanup();
    } catch (e: any) {
      // 网络错误：不 resolve，弹窗保持打开，用户可重试
      errorMessage.value = i18n.global.t('approval.networkError');
      webAgentLog.error(`sendApproval failed: ${e.message}`);
    }
  }

  async function retryApproval(): Promise<void> {
    errorMessage.value = '';
    await resolveApproval(lastDecision);
  }

  function cancelAllPending(): void {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = null;
    const req = pendingApproval.value;
    if (resolver) {
      // 通知服务端 deny，避免 broker 等到 60s 超时
      if (req) {
        void agentService.sendApproval(req.approvalId, 'deny').catch(() => { /* best-effort */ });
      }
      resolver('deny');
    }
    cleanup();
  }

  function cleanup(): void {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = null;
    resolver = null;
    pendingApproval.value = null;
    dialogVisible.value = false;
    errorMessage.value = '';
  }

  return {
    pendingApproval,
    dialogVisible,
    errorMessage,
    openApproval,
    resolveApproval,
    retryApproval,
    cancelAllPending,
  };
}
