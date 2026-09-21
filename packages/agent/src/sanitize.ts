/**
 * 展示侧清洗：去掉模型思考/回复里混入的工具协议噪声。
 * DeepSeek 等模型的 reasoning_content 有时会吐出 XML / DSML 工具标签，
 * 流式 content 里也可能夹带工具调用标记；这些不应展示给用户。
 */

/** 常见工具标签名（XML 协议 + 历史别名 + MCP 常见名） */
export const COMMON_TOOL_NAMES = [
  'list_dir',
  'read_file',
  'file_write',
  'file_edit',
  'write_file',
  'edit_file',
  'bash',
  'grep',
  'glob',
  'search_files',
  'search_code',
  'delegate',
  'todo',
] as const;

const DSML_BLOCK_RE = /<｜+DSML｜+[\s\S]*?<\/｜+DSML｜+[^>]*>/gi;
const DSML_BLOCK_HALF_RE = /<\|+DSML\|+[\s\S]*?<\/\|+DSML\|+[^>]*>/gi;
const DSML_TAG_RE = /<\/?[｜|]+DSML[｜|]+[^>]*>/gi;
const WRAPPER_TAG_RE = /<\/?(?:invoke|calls|parameter)\b[^>]*>/gi;
const TOOL_HEADER_RE = /^\*\*\[Tool:[^\]]*\]\*\*/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 判断某行是否像工具输出（用于识别 **[Tool:]** 块边界） */
function looksLikeToolOutput(line: string): boolean {
  if (TOOL_HEADER_RE.test(line)) return true;
  if (/^[📁📄📂✓✅❌]/.test(line)) return true;
  if (/^(Directory:|Error:|exit=|stdout|stderr|total |drwx|-rw|Unknown tool)/i.test(line)) return true;
  if (/^[A-Za-z]:[\\/]/.test(line)) return true;
  return false;
}

/**
 * 去掉注入的 **[Tool: name]** 结果块，保留前后自然语言。
 * 按行扫描：进入工具块后跳过，直到空行且下一段非空内容不再像工具输出。
 */
export function stripToolResultBlocks(text: string): string {
  if (!text || !text.includes('**[Tool:')) return text || '';
  const lines = text.split('\n');
  const out: string[] = [];
  let skip = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (TOOL_HEADER_RE.test(line)) {
      skip = true;
      continue;
    }
    if (skip) {
      if (line.trim() === '') {
        let j = i + 1;
        while (j < lines.length && lines[j]!.trim() === '') j++;
        if (j >= lines.length) {
          skip = false;
          continue;
        }
        if (looksLikeToolOutput(lines[j]!)) continue;
        skip = false;
        out.push(line);
        continue;
      }
      continue;
    }
    out.push(line);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * 去掉工具协议噪声，保留自然语言。
 * @param text 原始 thinking / content
 * @param toolNames 额外工具名；缺省使用 COMMON_TOOL_NAMES
 */
export function stripToolMarkup(text: string, toolNames: readonly string[] = COMMON_TOOL_NAMES): string {
  if (!text) return '';
  let s = text;

  // DSML / 特殊协议块（全角｜与半角| 都兼容）
  s = s.replace(DSML_BLOCK_RE, '');
  s = s.replace(DSML_BLOCK_HALF_RE, '');
  s = s.replace(DSML_TAG_RE, '');

  // invoke / calls / parameter 包装标签
  s = s.replace(WRAPPER_TAG_RE, '');

  // 已知工具的 body 形与自闭合形
  for (const name of toolNames) {
    const escaped = escapeRegExp(name);
    s = s.replace(new RegExp(`<${escaped}\\b[^>]*>[\\s\\S]*?<\\/${escaped}\\s*>`, 'gi'), '');
    s = s.replace(new RegExp(`<${escaped}\\b[^>]*\\/?>`, 'gi'), '');
  }

  // 运行时注入的工具结果块（展示层不需要；工具卡片已单独展示）
  s = stripToolResultBlocks(s);

  // 流式过程中可能出现「未闭合」的协议标签尾巴，一并去掉
  s = stripIncompleteMarkupTail(s, toolNames);

  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();
  return s;
}

/** 去掉字符串末尾未闭合的工具/DSML 标签碎片（流式分片常见） */
function stripIncompleteMarkupTail(text: string, toolNames: readonly string[]): string {
  let s = text;
  // 未闭合 DSML（含后面半截 invoke/parameter 内容）
  s = s.replace(/<\/?[｜|]*DSML[｜|][^>]*$/i, '');
  // 未闭合 invoke / calls / parameter
  s = s.replace(/<\/?(?:invoke|calls|parameter)\b[^>]*$/i, '');
  // 未闭合的已知工具标签，如 `<list_dir path="..."` 或 `<list_dir /`
  if (toolNames.length > 0) {
    const names = toolNames.map(escapeRegExp).join('|');
    s = s.replace(new RegExp(`<(${names})\\b[^>]*$`, 'i'), '');
  }
  return s.replace(/[ \t]+$/g, '');
}

/** 清洗 thinking：去掉协议标签，保留自然语言推理 */
export function sanitizeThinking(text: string, toolNames?: readonly string[]): string {
  return stripToolMarkup(text, toolNames);
}

/** 清洗给用户看的回复正文：去掉工具标签与 **[Tool:]** 结果块 */
export function sanitizeDisplayContent(text: string, toolNames?: readonly string[]): string {
  return stripToolMarkup(text, toolNames);
}
