import { ref } from 'vue';
import { createAgentService } from '../services/agentService';
import type { AgentConfig, StreamEvent, ApprovalRequiredEvent } from '../services/agentService';
import type { ProviderConfig } from './useLLMSettings';
import type { IDESnapshot, DisplayMessage } from '@openwork/agent';
import { sanitizeThinking, sanitizeDisplayContent } from '@openwork/agent/sanitize';
import { useEditorStore } from '../stores/editor';
import { useSettingsStore } from '../stores/settings';
import { getEditorInstance } from '../services/editorInstance';
import { webAgentLog } from '../services/logger';

/**
 * buildAgentSnapshot —— 从当前 IDE 状态构造 IDESnapshot。
 *
 * 与旧的 buildAgentContext 的关键差异:
 * - 只发激活文件的完整内容;其他打开 tab 仅发路径列表
 * - 不再带 conversationHistory(记忆完全由后端 SessionMemory 管)
 */
export function buildAgentSnapshot(activeFilePath?: string): IDESnapshot {
  const store = useEditorStore();
  const editor = getEditorInstance();

  // 激活文件内容(若有)
  let activeFile: IDESnapshot['activeFile'] | undefined;
  const activeTab = activeFilePath
    ? store.tabs.find(t => t.path === activeFilePath)
    : store.activeTab;
  if (activeTab) {
    activeFile = {
      path: activeTab.path,
      content: activeTab.content,
    };
  }

  // 其他打开 tab 仅路径
  const openFilePaths = store.tabs
    .map(t => t.path)
    .filter(p => p !== activeFile?.path);

  // 文件树(扁平路径列表,与旧版一致)
  const fileTree = collectFileTreePaths(store.fileTreeNodes, '');

  // 光标 / 选区
  let cursorPosition: IDESnapshot['cursorPosition'];
  let selection: IDESnapshot['selection'];
  if (editor) {
    const file = activeFilePath || '';
    const pos = editor.getPosition();
    if (pos) {
      cursorPosition = { file, line: pos.lineNumber, column: pos.column };
    }
    const sel = editor.getSelection();
    if (sel && !sel.isEmpty()) {
      const model = editor.getModel();
      const text = model ? model.getValueInRange(sel) : '';
      selection = {
        file,
        text,
        startLine: sel.startLineNumber,
        endLine: sel.endLineNumber,
      };
    }
  }

  return {
    activeFile,
    openFilePaths,
    fileTree,
    cursorPosition,
    selection,
  };
}

function collectFileTreePaths(entries: any[], basePath: string): string[] {
  // 目录也要进树：否则 IDE 快照只有根下零星文件（如 keilkill.bat），Agent 会误判项目为空
  const paths: string[] = [];
  const MAX = 400;
  for (const entry of entries || []) {
    if (paths.length >= MAX) break;
    if (!entry?.name) continue;
    const full = basePath ? `${basePath}/${entry.name}` : entry.name;
    paths.push(entry.isDirectory ? `${full}/` : full);
  }
  return paths;
}

/**
 * Agent 流驱动器(无状态)。
 *
 * 不再持有 messages ref——展示消息由 useSessionMessages 从后端拉取。
 * 这里只负责构造请求 → 触发流式 → 把 live 消息通过 onLiveUpdate 回调上抛给 UI 层。
 *
 * useAgent 不绑定 sessionId;sessionId 在 streamMessage 调用时显式传入,
 * 同一个 useAgent 实例可复用于不同 session(只要不同时并发)。
 *
 * 用法(详见 AgentPanel):
 *   const { streamMessage, cancelStream, isProcessing, liveMessage } = useAgent();
 *   await streamMessage(sessionId, text, provider, activeFilePath, {
 *     onChunk: () => scheduleScroll(),
 *     onLiveUpdate: (msg) => { liveMsg.value = msg; },
 *     onDone: () => sessionMessages.refresh(),
 *   });
 */
export function useAgent() {
  const isProcessing = ref(false);
  const settings = useSettingsStore();
  /** 桌面默认：协议 auto、权限 auto-edit（可在设置/ChatFooter 中改） */
  const config = ref<AgentConfig>({
    mode: 'build',
  });
  const service = createAgentService();
  const liveMessage = ref<DisplayMessage | null>(null);
  let activeAbortController: AbortController | null = null;

  /** 也可由 UI 注入更精致的确认框 */
  const defaultApprove = async (req: ApprovalRequiredEvent): Promise<'allow' | 'deny'> => {
    const ok = typeof window !== 'undefined' && window.confirm(
      `允许执行工具？\n\n${req.label}\n\n工具: ${req.toolName}`,
    );
    return ok ? 'allow' : 'deny';
  };
  let approveHandler: (req: ApprovalRequiredEvent) => Promise<'allow' | 'deny'> = defaultApprove;

  function setApproveHandler(fn: typeof approveHandler) {
    approveHandler = fn;
  }

  function buildRequestConfig(provider?: ProviderConfig | null): AgentConfig {
    return {
      mode: 'build',
      ...config.value,
      providerId: provider?.id || undefined,
      // 始终从 settings 读取，保证 ChatFooter/设置页切换即时生效
      permissionMode: settings.permissionMode || 'auto-edit',
      toolProtocol: settings.toolProtocol || 'auto',
    };
  }

  async function streamMessage(
    sessionId: string,
    content: string,
    provider: ProviderConfig | null | undefined,
    activeFilePath: string | undefined,
    callbacks: {
      onChunk?: () => void;
      onDone?: () => void;
      onError?: (err: Error) => void;
      /** Agent 写盘后回调（相对路径列表） */
      onFilesChanged?: (paths: string[]) => void;
    },
  ) {
    isProcessing.value = true;

    // live 消息初始化
    const liveId = `live_${Date.now()}`;
    liveMessage.value = {
      id: liveId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      blocks: [],
      live: true,
    };

    // 取消上一个在途请求
    if (activeAbortController) {
      activeAbortController.abort();
    }
    activeAbortController = new AbortController();
    const signal = activeAbortController.signal;

    // 流式 block 状态机(同旧 useAgent,但更新的是 liveMessage 而非 messages 数组)
    // 用 LiveBlock 显式类型,避免 TS control-flow 在赋值后误判类型窄化
    type LiveBlock = DisplayMessage['blocks'][number];
    let activeBlock: LiveBlock | null = null;
    let blockIdCounter = 0;
    const changedPaths = new Set<string>();
    const nextBlockId = () => `${liveId}_blk${blockIdCounter++}`;
    /** 整次请求的原始 thinking 分片（liveMessage 汇总用） */
    let streamRawThinking = '';
    /** 当前思考块自己的原始分片，避免跨块重复拼接 */
    let currentBlockRawThinking = '';

    function finishBlock() {
      if (!activeBlock) return;
      if (activeBlock.type === 'tool_call') activeBlock.completed = true;
      if (activeBlock.type === 'thinking') {
        activeBlock.completed = true;
        // 空/过短思考块直接丢弃
        if (((activeBlock.content || '').trim().length) < 12 && liveMessage.value) {
          const idx = liveMessage.value.blocks.indexOf(activeBlock);
          if (idx >= 0) liveMessage.value.blocks.splice(idx, 1);
        }
      }
      activeBlock = null;
    }

    function pushBlock(b: LiveBlock) {
      activeBlock = b;
      liveMessage.value?.blocks.push(b);
    }

    function ensureResponseBlock() {
      if (activeBlock && activeBlock.type === 'response') return;
      finishBlock();
      pushBlock({ id: nextBlockId(), type: 'response', content: '' });
    }

    function ensureThinkingBlock() {
      if (activeBlock && activeBlock.type === 'thinking') return;
      // 若上一个块是空思考，复用它，而不是再新建
      const blocks = liveMessage.value?.blocks;
      if (blocks && blocks.length > 0) {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'thinking' && !(last.content || '').trim()) {
          activeBlock = last;
          return;
        }
      }
      finishBlock();
      currentBlockRawThinking = '';
      pushBlock({ id: nextBlockId(), type: 'thinking', content: '', completed: false });
    }

    function pruneEmptyThinkingBlocks() {
      if (!liveMessage.value) return;
      liveMessage.value.blocks = liveMessage.value.blocks.filter(b => {
        if (b.type !== 'thinking') return true;
        // 过短碎片（英文 "The" 等）不进入 UI
        return ((b.content || '').trim().length >= 12);
      });
    }

    function startToolCallBlock(toolType: string, toolLabel: string, params: Record<string, string>) {
      finishBlock();
      pushBlock({
        id: nextBlockId(),
        type: 'tool_call',
        toolType,
        toolLabel,
        params,
        result: '',
        durationMs: 0,
        completed: false,
      });
    }

    // 内容缓冲(50ms,与旧版一致,降低 markdown 重渲染频率)
    const contentBuffer: string[] = [];
    let rawResponse = '';
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const FLUSH_INTERVAL = 50;
    function flushContent() {
      if (contentBuffer.length === 0) return;
      const text = contentBuffer.join('');
      contentBuffer.length = 0;
      rawResponse += text;
      // 整段清洗后再展示，避免分片把未闭合标签当成正文
      const cleaned = sanitizeDisplayContent(rawResponse);
      if (activeBlock && activeBlock.type === 'response') {
        activeBlock.content = cleaned;
      }
      if (liveMessage.value) liveMessage.value.content = cleaned;
      callbacks.onChunk?.();
    }
    function scheduleFlush() {
      if (flushTimer) return;
      flushTimer = setTimeout(() => { flushTimer = null; flushContent(); }, FLUSH_INTERVAL);
    }

    try {
      const store = useEditorStore();
      const ideSnapshot = buildAgentSnapshot(activeFilePath);

      await service.streamMessage(
        content,
        {
          ideSnapshot,
          workspaceRoot: store.workspaceRoot || undefined,
          workspaceId: store.activeWorkspaceId || undefined,
          sessionId,
        },
        buildRequestConfig(provider),
        (type: 'thinking' | 'content', text: string) => {
          if (!liveMessage.value) return;
          if (type === 'thinking') {
            ensureThinkingBlock();
            streamRawThinking += text;
            currentBlockRawThinking += text;
            if (activeBlock && activeBlock.type === 'thinking') {
              activeBlock.content = sanitizeThinking(currentBlockRawThinking);
            }
            liveMessage.value.thinking = sanitizeThinking(streamRawThinking);
          } else {
            ensureResponseBlock();
            contentBuffer.push(text);
            scheduleFlush();
          }
          callbacks.onChunk?.();
        },
        (event: StreamEvent) => {
          if (event.type === 'file_changed') {
            for (const p of event.paths || []) changedPaths.add(p);
            return;
          }
          if (!liveMessage.value) return;
          if (event.type === 'tool_start') {
            startToolCallBlock(event.toolType || 'tool', event.toolLabel || '', event.toolParams || {});
          } else if (event.type === 'tool_end') {
            // 填入耗时再 finish
            if (activeBlock && activeBlock.type === 'tool_call') {
              activeBlock.durationMs = event.durationMs || 0;
            }
            finishBlock();
          } else if (event.type === 'tool_result') {
            const resultText = event.content || '';
            // 若当前块不是 tool_call,强制开一个
            if (!activeBlock || activeBlock.type !== 'tool_call') {
              startToolCallBlock('tool', '', {});
            }
            // 此时 activeBlock 必为 tool_call —— 用类型断言以避开 TS control-flow 残留窄化
            const tc = activeBlock as Extract<LiveBlock, { type: 'tool_call' }> | null;
            if (tc) {
              tc.result = tc.result ? tc.result + resultText : resultText;
            }
          } else if (event.type === 'thinking_start') {
            // 不在此预建思考块：等真正收到 thinking 文本再建，避免空壳
          } else if (event.type === 'thinking_end') {
            finishBlock();
          }
        },
        { signal, onApprovalRequired: (req) => approveHandler(req) },
      );

      // 流正常结束:让 UI 知道 live 消息即将被后端权威数据替代
      flushContent();
      finishBlock();
      pruneEmptyThinkingBlocks();
      if (changedPaths.size > 0) {
        callbacks.onFilesChanged?.(Array.from(changedPaths));
      }
    } catch (e: any) {
      webAgentLog.error(`streamMessage error: ${e.name} ${e.message}`, { name: e.name, message: e.message });
      if (e.name === 'AbortError') {
        if (liveMessage.value) liveMessage.value.content += '\n\n*[已取消]*';
      } else {
        if (liveMessage.value) {
          liveMessage.value.error = true;
          liveMessage.value.content = `Error: ${e.message}`;
        }
        callbacks.onError?.(e);
      }
    } finally {
      if (flushTimer) clearTimeout(flushTimer);
      flushContent();
      activeAbortController = null;
      finishBlock();
      pruneEmptyThinkingBlocks();
      isProcessing.value = false;
      // onDone 触发上层 refresh(从后端拉权威数据覆盖 live)
      // await 确保 refresh 完成后 streamMessage 才真正返回
      await callbacks.onDone?.();
    }
  }

  function cancelStream() {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
    }
    isProcessing.value = false;
  }

  function clearLive() {
    liveMessage.value = null;
  }

  function setMode(mode: AgentConfig['mode']) {
    config.value.mode = mode;
  }

  return {
    isProcessing,
    config,
    liveMessage,
    streamMessage,
    cancelStream,
    clearLive,
    setMode,
    setApproveHandler,
  };
}
