import OpenAI from 'openai';
import type {
  ILLMProvider,
  LLMChatMessage,
  ChatWithToolsResult,
  LLMCallOptions,
} from '../types/provider';
import type { OpenAIFunctionDefinition } from '../types/tool';
import { ToolCallAccumulator } from './accumulate-tool-calls';
import type { AgentConfig, AgentContext } from '../types/agent';
import { createLogger } from '../logger';
import { LOG_CATEGORY } from '../log-categories';

const log = createLogger(LOG_CATEGORY.LLM);

interface ResolvedLLMConfig {
  apiUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

/** 解析 LLM 配置：显式参数 → 环境变量 → 默认值 */
export function resolveLLMConfig(config?: Partial<AgentConfig>): ResolvedLLMConfig {
  const isNode = typeof process !== 'undefined' && !!process.env;
  return {
    apiUrl:
      config?.apiUrl ||
      (isNode && process.env?.LLM_API_URL) ||
      'https://api.openai.com/v1',
    apiKey:
      config?.apiKey ||
      (isNode && process.env?.LLM_API_KEY) ||
      '',
    model:
      config?.model ||
      (isNode && process.env?.LLM_MODEL) ||
      'gpt-4o',
    temperature: config?.temperature ?? 0.3,
    maxTokens: config?.maxTokens ?? 4096,
  };
}

/** 组装 LLM 消息数组：system prompt + context + history + user message */
export function buildMessages(
  config: AgentConfig,
  message: string,
  context: AgentContext
): { role: string; content: string }[] {
  const systemPrompt = config.systemPrompt || 'You are an AI code editor assistant.';
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
  ];

  const contextParts: string[] = [];

  if (context.openFiles && context.openFiles.length > 0) {
    contextParts.push('## Currently Open Files');
    for (const f of context.openFiles) {
      contextParts.push(`\n### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``);
    }
  }

  if (context.fileTree && context.fileTree.length > 0) {
    contextParts.push('\n## Project File Tree\n' + context.fileTree.join('\n'));
  }

  if (context.cursorPosition) {
    contextParts.push(`\n## Cursor Position: ${context.cursorPosition.file}:${context.cursorPosition.line}:${context.cursorPosition.column}`);
  }

  if (context.selection && context.selection.text) {
    contextParts.push(`\n## Selected Text (${context.selection.file}, lines ${context.selection.startLine}-${context.selection.endLine}):\n\`\`\`\n${context.selection.text}\n\`\`\``);
  }

  for (const m of context.conversationHistory || []) {
    messages.push({ role: m.role, content: m.content });
  }

  if (contextParts.length > 0) {
    messages.push({ role: 'system', content: contextParts.join('\n') });
  }

  messages.push({ role: 'user', content: message });

  return messages;
}

/** 创建基于 openai SDK 的 ILLMProvider */
export function createOpenAILLMProvider(config?: Partial<AgentConfig>): ILLMProvider {
  const resolved = resolveLLMConfig(config);

  // 空 key 时用占位符，避免 OpenAI SDK 在构造期直接抛错导致会话无法建立
  const client = new OpenAI({
    baseURL: resolved.apiUrl,
    apiKey: resolved.apiKey || 'missing-api-key',
  });

  function requireApiKey(): void {
    if (!resolved.apiKey) {
      throw new Error(
        '未配置 LLM API Key。请在「设置 → AI 模型」中选择/添加提供商并填入 API Key，或设置环境变量 LLM_API_KEY。',
      );
    }
  }

  const msgCount = (msgs: { role: string; content: string }[]): number => msgs.length;
  const totalChars = (msgs: { role: string; content: string }[]): number =>
    msgs.reduce((sum, m) => sum + (m.content?.length || 0), 0);

  return {
    async chat(messages, options) {
      requireApiKey();
      const startMs = Date.now();
      log.info(`chat start: model=${resolved.model}, messages=${msgCount(messages)}, inputChars=${totalChars(messages)}`, {
        model: resolved.model,
        messages: msgCount(messages),
        inputChars: totalChars(messages),
      });
      try {
        const response = await client.chat.completions.create(
          {
            model: resolved.model,
            messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: resolved.temperature,
            max_tokens: resolved.maxTokens,
            stream: false,
          },
          { signal: options?.signal },
        );
        const content = (response.choices[0]?.message?.content as string) || '';
        const usage = response.usage;
        const finishReason = response.choices[0]?.finish_reason ?? 'unknown';
        log.info(`chat done: ${content.length} chars, ${Date.now() - startMs}ms`, {
          model: resolved.model,
          contentLen: content.length,
          finishReason,
          usage: usage ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens } : undefined,
        });
        return content;
      } catch (e: any) {
        log.error(`chat failed: ${e.message}`, { model: resolved.model, error: e.message, status: e.status });
        throw e;
      }
    },

    async chatWithTools(
      messages: LLMChatMessage[],
      tools: OpenAIFunctionDefinition[],
      options?: LLMCallOptions,
    ): Promise<ChatWithToolsResult> {
      requireApiKey();
      const startMs = Date.now();
      log.info(
        `chatWithTools start: model=${resolved.model}, messages=${messages.length}, tools=${tools.length}`,
        {
          protocol: 'fc',
          model: resolved.model,
          messages: messages.length,
          tools: tools.length,
          inputChars: messages.reduce((s, m) => s + (m.content?.length || 0), 0),
        },
      );
      try {
        const response = await client.chat.completions.create(
          {
            model: resolved.model,
            messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: resolved.temperature,
            max_tokens: resolved.maxTokens,
            tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            tool_choice: 'auto',
            stream: false,
          },
          { signal: options?.signal },
        );

        const choice = response.choices[0];
        const message = choice?.message;
        const content = (message?.content as string) || '';
        const rawCalls = message?.tool_calls ?? [];
        const toolCalls = rawCalls.flatMap((c) => {
          const fn = (c as { function?: { name?: string; arguments?: string } }).function;
          if (!fn) return [];
          return [
            {
              id: c.id,
              name: fn.name || '',
              arguments: fn.arguments || '',
            },
          ];
        });
        const finishReason = (choice?.finish_reason || 'unknown') as ChatWithToolsResult['finishReason'];
        const usage = response.usage;

        log.info(
          `chatWithTools done: content=${content.length} chars, toolCalls=${toolCalls.length}, finish=${finishReason}, ${Date.now() - startMs}ms`,
          {
            protocol: 'fc',
            model: resolved.model,
            contentLen: content.length,
            toolNames: toolCalls.map((t) => t.name),
            finishReason,
            usage: usage
              ? {
                  prompt: usage.prompt_tokens,
                  completion: usage.completion_tokens,
                  total: usage.total_tokens,
                }
              : undefined,
          },
        );

        return { content, toolCalls, finishReason };
      } catch (e: any) {
        log.error(`chatWithTools failed: ${e.message}`, {
          protocol: 'fc',
          model: resolved.model,
          error: e.message,
          status: e.status,
        });
        throw e;
      }
    },

    async chatStreamWithTools(
      messages: LLMChatMessage[],
      tools: OpenAIFunctionDefinition[],
      onChunk: (type: 'thinking' | 'content', text: string) => void,
      options?: LLMCallOptions,
    ): Promise<ChatWithToolsResult> {
      requireApiKey();
      const startMs = Date.now();
      log.info(
        `chatStreamWithTools start: model=${resolved.model}, messages=${messages.length}, tools=${tools.length}`,
        {
          protocol: 'fc',
          model: resolved.model,
          messages: messages.length,
          tools: tools.length,
        },
      );
      try {
        const stream = await client.chat.completions.create(
          {
            model: resolved.model,
            messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: resolved.temperature,
            max_tokens: resolved.maxTokens,
            tools: tools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[],
            tool_choice: 'auto',
            stream: true,
          },
          { signal: options?.signal },
        );

        const acc = new ToolCallAccumulator();
        let fullContent = '';
        let finishReason: string | undefined;

        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = (choice?.delta ?? {}) as {
            reasoning_content?: unknown;
            content?: unknown;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
          if (delta.reasoning_content) {
            onChunk('thinking', String(delta.reasoning_content));
          }
          if (delta.content) {
            fullContent += String(delta.content);
            onChunk('content', String(delta.content));
          }
          if (delta.tool_calls) {
            acc.apply({ tool_calls: delta.tool_calls });
          }
        }

        const toolCalls = acc.snapshot();
        const normalized: ChatWithToolsResult['finishReason'] =
          toolCalls.length > 0
            ? 'tool_calls'
            : finishReason === 'stop' || finishReason === 'length'
              ? finishReason
              : 'stop';

        log.info(
          `chatStreamWithTools done: content=${fullContent.length}, toolCalls=${toolCalls.length}, finish=${normalized}, ${Date.now() - startMs}ms`,
          {
            protocol: 'fc',
            model: resolved.model,
            contentLen: fullContent.length,
            toolNames: toolCalls.map((t) => t.name),
            finishReason: normalized,
          },
        );

        return { content: fullContent, toolCalls, finishReason: normalized };
      } catch (e: any) {
        log.error(`chatStreamWithTools failed: ${e.message}`, {
          protocol: 'fc',
          model: resolved.model,
          error: e.message,
          status: e.status,
        });
        throw e;
      }
    },

    async chatStream(messages, onChunk, options) {
      requireApiKey();
      const startMs = Date.now();
      log.info(`chatStream start: model=${resolved.model}, messages=${msgCount(messages)}, inputChars=${totalChars(messages)}`, {
        model: resolved.model,
        messages: msgCount(messages),
        inputChars: totalChars(messages),
      });
      try {
        const stream = await client.chat.completions.create(
          {
            model: resolved.model,
            messages: messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
            temperature: resolved.temperature,
            max_tokens: resolved.maxTokens,
            stream: true,
          },
          { signal: options?.signal },
        );

        let fullContent = '';
        let finishReason: string | undefined;
        for await (const chunk of stream) {
          const choice = chunk.choices?.[0];
          if (choice?.finish_reason) finishReason = choice.finish_reason;
          const delta = (choice?.delta as Record<string, unknown>) ?? {};
          if (delta.reasoning_content) {
            onChunk('thinking', String(delta.reasoning_content));
          }
          if (delta.content) {
            fullContent += String(delta.content);
            onChunk('content', String(delta.content));
          }
        }
        log.info(`chatStream done: ${fullContent.length} chars, ${Date.now() - startMs}ms`, {
          model: resolved.model,
          contentLen: fullContent.length,
          finishReason: finishReason || 'unknown',
        });
        return fullContent;
      } catch (e: any) {
        log.error(`chatStream failed: ${e.message}`, { model: resolved.model, error: e.message, status: e.status });
        throw e;
      }
    },
  };
}
