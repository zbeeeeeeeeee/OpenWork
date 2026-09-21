<template>
  <div class="agent-chat-b">
    <!-- 会话标签栏 -->
    <ChatSessionTabs
      :sessions="sessionStore.sessions"
      :activeSessionId="sessionStore.activeSessionId"
      :visible="!!(editorStore.activeWorkspaceId || providerSettings.providers.value.length > 0)"
      @update:activeSessionId="sessionStore.setActiveSession($event)"
      @close="sessionStore.closeSession($event)"
      @add="createNewSession"
    />

    <!-- 流式处理时的加载提示 -->
    <div v-if="agentCtrl.isProcessing.value" class="b-thinking-bar">
      <n-spin size="small" />
      <span class="b-thinking-text">{{ t('agent.reasoning') }}...</span>
    </div>

    <!-- 引导/空状态 -->
    <template v-if="showGuide">
      <ChatEmptyState
        v-if="!hasProviders"
        :description="t('agent.guideTitle')"
        :actionLabel="t('agent.addProvider')"
        @action="$emit('open-settings')"
      />
      <ChatEmptyState
        v-else-if="!hasWorkspace"
        :description="t('agent.noWorkspaceDesc')"
      />
      <ChatEmptyState
        v-else-if="!hasSession"
        :description="t('agent.noSessionPrompt')"
        :actionLabel="t('agent.newSession')"
        @action="createNewSession"
      />
    </template>

    <!-- 正常聊天界面 -->
    <template v-else>
      <!-- 消息列表 -->
      <div v-if="visibleMessages.length === 0" class="b-empty-chat">
        <ChatEmptyState :description="t('agent.emptyChat')" />
      </div>
      <div v-else class="b-messages" ref="messagesContainer">
        <ChatMessageItem
          v-for="msg in visibleMessages"
          :key="msg.id"
          :message="msg"
        />
      </div>

      <!-- 输入区域 -->
      <ChatInputArea
        v-model="input"
        :isProcessing="agentCtrl.isProcessing.value"
        @send="send"
        @stop="stopStream"
      />

      <!-- 底部栏 -->
      <ChatFooter
        :providers="providerSettings.providers.value"
        :activeProviderId="providerSettings.activeId.value"
        :currentMode="currentMode"
        :canUndo="canUndo"
        :undoing="undoing"
        @select-provider="providerSettings.setActive($event)"
        @update:currentMode="agentCtrl.config.value.mode = $event"
        @open-settings="$emit('open-settings')"
        @undo-write="handleUndoWrite"
      />
    </template>

    <!-- 权限确认弹窗 -->
    <ApprovalDialog
      :visible="approvalDialog.dialogVisible.value"
      :toolName="approvalDialog.pendingApproval.value?.toolName || ''"
      :label="approvalDialog.pendingApproval.value?.label || ''"
      :preview="approvalDialog.pendingApproval.value?.preview"
      :mode="approvalDialog.pendingApproval.value?.mode || ''"
      :errorMessage="approvalDialog.errorMessage.value"
      @allow="approvalDialog.resolveApproval('allow')"
      @deny="approvalDialog.resolveApproval('deny')"
      @retry="approvalDialog.retryApproval()"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { NSpin } from 'naive-ui';
import { useSessionStore } from '../../stores/sessions';
import { useLLMSettings } from '../../composables/useLLMSettings';
import { useEditorStore } from '../../stores/editor';
import { useAgent } from '../../composables/useAgent';
import { useSessionMessages } from '../../composables/useSessionMessages';
import { reloadTabsForPaths } from '../../composables/useFileSystem';
import type { DisplayMessage } from '@openwork/agent';
import ChatSessionTabs from './chat-b/ChatSessionTabs.vue';
import ChatEmptyState from './chat-b/ChatEmptyState.vue';
import ChatMessageItem from './chat-b/ChatMessageItem.vue';
import ChatInputArea from './chat-b/ChatInputArea.vue';
import ChatFooter from './chat-b/ChatFooter.vue';
import ApprovalDialog from './ApprovalDialog.vue';
import { useApprovalDialog } from '../../composables/useApprovalDialog';
import { webAgentLog } from '../../services/logger';

defineEmits<{
  'open-settings': [];
}>();

const { t } = useI18n();
const sessionStore = useSessionStore();
const providerSettings = useLLMSettings();
const editorStore = useEditorStore();
const input = ref('');

const agentCtrl = useAgent();
const approvalDialog = useApprovalDialog();

const { messages: persistedMessages, refresh: refreshMessages } = useSessionMessages(
  () => editorStore.activeWorkspaceId,
  () => sessionStore.activeSessionId,
  () => editorStore.workspaceRoot,
);

// 引导页判定
const hasProviders = computed(() => providerSettings.providers.value.length > 0);
const hasWorkspace = computed(() => !!editorStore.activeWorkspaceId || editorStore.workspaceRoots.length > 0);
const hasSession = computed(() => !!sessionStore.activeSessionId);
const showGuide = computed(() => !hasProviders.value || !hasWorkspace.value || !hasSession.value);

// 消息列表
const pendingUserMessage = ref<DisplayMessage | null>(null);
const visibleMessages = computed<DisplayMessage[]>(() => {
  const result = [...persistedMessages.value];
  if (agentCtrl.liveMessage.value) {
    if (pendingUserMessage.value) result.push(pendingUserMessage.value);
    result.push(agentCtrl.liveMessage.value);
  }
  return result;
});

watch(() => sessionStore.activeSessionId, () => {
  pendingUserMessage.value = null;
  agentCtrl.clearLive();
});

const currentMode = computed({
  get: () => agentCtrl.config.value.mode,
  set: (val) => { agentCtrl.config.value.mode = val; },
});

async function createNewSession() {
  await sessionStore.createSession();
}

// ===== 自动滚动（用户上翻时不打断）=====
const messagesContainer = ref<HTMLElement>();
let scrollRafId = 0;
/** 距底部多少像素内视为「贴底」，才继续自动滚动 */
const NEAR_BOTTOM_PX = 80;

function isNearBottom(): boolean {
  const el = messagesContainer.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
}

function scrollToBottom() {
  const el = messagesContainer.value;
  if (el) el.scrollTop = el.scrollHeight;
}

function scheduleScroll(force = false) {
  cancelAnimationFrame(scrollRafId);
  scrollRafId = requestAnimationFrame(() => {
    if (force || isNearBottom()) scrollToBottom();
  });
}

onMounted(() => {
  providerSettings.reload();
  agentCtrl.setApproveHandler((req) => approvalDialog.openApproval(req));
  webAgentLog.info('approval handler connected (ApprovalDialog)');
});

onUnmounted(() => {
  cancelAnimationFrame(scrollRafId);
  approvalDialog.cancelAllPending();
});

async function send() {
  if (!sessionStore.activeSessionId) {
    await sessionStore.createSession();
  }
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;

  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const tempUserMsg: DisplayMessage = {
    id: `pending_user_${Date.now()}`,
    role: 'user',
    content: text,
    timestamp: Date.now(),
    blocks: [{ id: `pending_user_${Date.now()}_r`, type: 'response', content: text }],
  };
  pendingUserMessage.value = tempUserMsg;

  if (sessionStore.activeSession && !sessionStore.activeSession.nameAutoGenerated) {
    sessionStore.autoNameFromFirstMessage(sessionStore.activeSession.id, text);
  }

  const activeFilePath = editorStore.activeTab?.path;
  webAgentLog.info('send(B): starting streamMessage');

  const streamPromise = agentCtrl.streamMessage(
    sessionId,
    text,
    providerSettings.activeProvider.value,
    activeFilePath,
    {
      onChunk: () => scheduleScroll(false),
      onFilesChanged: async (paths) => {
        webAgentLog.info('send(B): agent changed files', { paths });
        try {
          await reloadTabsForPaths(paths);
        } catch (e: any) {
          webAgentLog.warn(`reloadTabsForPaths failed: ${e.message}`);
        }
      },
      onDone: async () => {
        webAgentLog.info('send(B): streamMessage completed, refreshing from backend');
        approvalDialog.cancelAllPending();
        try {
          await refreshMessages();
        } catch (e: any) {
          webAgentLog.warn(`refresh after stream failed: ${e.message}`);
        }
        // 后端已有权威消息时再清掉临时态，避免失败瞬间「闪没」
        if (persistedMessages.value.length > 0) {
          pendingUserMessage.value = null;
          agentCtrl.clearLive();
        }
        // 仅贴底时才跟滚，用户上翻阅读时不拉回底部
        scheduleScroll(false);
      },
      onError: (err) => {
        webAgentLog.error(`send(B): streamMessage failed: ${err.message}`, { name: err.name, message: err.message });
      },
    },
  );

  await nextTick();
  // 用户主动发送时强制滚到底
  scheduleScroll(true);

  try {
    await streamPromise;
  } catch (e: any) {
    webAgentLog.error(`send(B): streamPromise rejected: ${e.message}`, { name: e.name, message: e.message });
  }
}

function stopStream() {
  agentCtrl.cancelStream();
}

// ===== 撤销 Agent 写盘 =====
const undoing = ref(false);
const canUndo = ref(true);

async function handleUndoWrite() {
  if (undoing.value) return;
  undoing.value = true;
  try {
    const workspaceRoot = editorStore.workspaceRoot || undefined;
    const workspaceId = editorStore.activeWorkspaceId || undefined;
    const sessionId = sessionStore.activeSessionId || undefined;
    const res = await fetch(
      (typeof __SERVER_PORT__ !== 'undefined' ? `http://localhost:${__SERVER_PORT__}` : '') +
        '/api/agent/undo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceRoot, workspaceId, sessionId }),
      },
    );
    const data = await res.json();
    if (data.ok) {
      // 恢复后刷新编辑器标签
      await reloadTabsForPaths([data.path]);
      webAgentLog.info('undo write ok', { path: data.path });
    } else {
      webAgentLog.warn(`undo write: ${data.reason || 'empty stack'}`);
    }
  } catch (e: any) {
    webAgentLog.error(`undo write failed: ${e.message}`);
  } finally {
    undoing.value = false;
  }
}
</script>

<style scoped>
.agent-chat-b {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-secondary);
  overflow: hidden;
}

.b-thinking-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}
.b-thinking-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.b-empty-chat {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.b-messages {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
}
</style>
