import type { FileChangeHunk } from '../../types/tool';

/** 单 hunk 文本最大长度（字符），超出截断 */
export const HUNK_TEXT_MAX = 4000;

export function truncateHunkText(text: string, max = HUNK_TEXT_MAX): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}

/** 计算文本中某字符偏移所在行号（1-based） */
export function lineNumberOfOffset(text: string, offset: number): number {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let lines = 1;
  for (let i = 0; i < clamped; i++) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  return lines;
}

export function countLines(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length;
}

/**
 * 根据 old/new 文本生成单个简化 hunk（file_edit 场景）。
 * 找不到 old 时返回 undefined。
 */
export function buildEditHunk(
  original: string,
  oldString: string,
  newString: string,
  matchIndex: number,
): FileChangeHunk {
  const oldStart = lineNumberOfOffset(original, matchIndex);
  const oldLines = countLines(oldString);
  const newLines = countLines(newString);
  return {
    oldStart,
    oldLines,
    newStart: oldStart,
    newLines,
    oldText: truncateHunkText(oldString),
    newText: truncateHunkText(newString),
  };
}

/** file_write 整文件 hunk：仅保留摘要级文本 */
export function buildWriteHunk(content: string): FileChangeHunk {
  return {
    oldStart: 1,
    oldLines: 0,
    newStart: 1,
    newLines: countLines(content),
    newText: truncateHunkText(content, 800),
  };
}
