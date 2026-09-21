import { readFileSync, writeFileSync, existsSync } from 'fs';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import { resolveKey } from '../_shared/path';
import { buildEditHunk } from '../_shared/file-change';
import {
  FILE_EDIT_TOOL_NAME,
  FILE_EDIT_TOOL_DESCRIPTION,
  FILE_EDIT_TOOL_USAGE,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to edit (resolved against workspace root)' },
    old: { type: 'string', description: 'Exact text to find. Provided via <old> child tag in tool body.' },
    new: { type: 'string', description: 'Replacement text. Provided via <new> child tag in tool body.' },
    replace_all: {
      type: 'string',
      description: 'Replace all occurrences of <old> instead of just the first. Default "false".',
      default: 'false',
    },
  },
  required: ['path', 'old', 'new'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Tool body uses child tags (<old>/<new>), see parser.ts body-kind handling. */
export const FILE_EDIT_BODY_KIND = 'children' as const;

export class FileEditTool implements ITool {
  readonly name = FILE_EDIT_TOOL_NAME;
  readonly description = FILE_EDIT_TOOL_DESCRIPTION;
  readonly usage = FILE_EDIT_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;
  readonly body = FILE_EDIT_BODY_KIND;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const startMs = Date.now();
    const target = params.path;
    const oldString = params.old ?? '';
    const newString = params.new ?? '';
    const replaceAll = params.replace_all === 'true' || params.replace_all === '1';

    if (oldString === newString) {
      return `Error: <old> and <new> are identical — nothing to change in ${target}.`;
    }

    let absPath: string;
    let pathKey: string;
    try {
      const r = resolveKey(context.workspaceRoot, target);
      absPath = r.absPath;
      pathKey = r.key;
    } catch (e: any) {
      return `Error editing ${target}: ${e.message}`;
    }

    // 前置校验:本会话内必须先 read_file 再 edit
    if (!context.readFileState?.has(pathKey)) {
      log.warn(`file_edit refused: file not read before edit`, { path: target });
      return `Error: you must call \`read_file\` on "${target}" before editing it. Read it first, then retry the edit.`;
    }

    if (!existsSync(absPath)) {
      return `Error: file not found: ${target}. Use file_write to create new files.`;
    }

    const original = readFileSync(absPath, 'utf-8');

    // 统计匹配次数
    let matchCount = 0;
    let from = 0;
    while (true) {
      const idx = original.indexOf(oldString, from);
      if (idx === -1) break;
      matchCount++;
      from = idx + oldString.length;
    }

    if (matchCount === 0) {
      log.warn(`file_edit: old_string not found`, { path: target });
      return `Error: the <old> text was not found in ${target}. Make sure to copy it verbatim (whitespace included).`;
    }

    if (matchCount > 1 && !replaceAll) {
      return `Error: found ${matchCount} matches of <old> in ${target}. Provide more surrounding context to make it unique, or set replace_all="true".`;
    }

    let updated: string;
    if (replaceAll) {
      // split/join 避免对替换文本中可能含特殊正则字符的转义
      updated = original.split(oldString).join(newString);
    } else {
      updated = original.replace(oldString, newString);
    }

    context.onFileBackup?.(target, original, true);
    writeFileSync(absPath, updated, 'utf-8');

    // 写完后刷新 readFileState:LLM 自己刚改完,当然知道当前内容,
    // 后续对同一文件的 edit/write 不应再被前置校验挡住。
    context.readFileState?.add(pathKey);

    const oldBytes = Buffer.byteLength(original, 'utf-8');
    const newBytes = Buffer.byteLength(updated, 'utf-8');
    const delta = newBytes - oldBytes;

    const firstIdx = original.indexOf(oldString);
    const hunk = firstIdx >= 0 ? buildEditHunk(original, oldString, newString, firstIdx) : undefined;
    context.onFileChange?.({
      kind: 'edit',
      path: target,
      oldSize: oldBytes,
      newSize: newBytes,
      hunks: hunk ? [hunk] : [],
      summary: `edit ${target} (${replaceAll ? matchCount : 1} replace)`,
    });

    log.info(`file_edit done: ${matchCount} occurrence(s) replaced, ${delta >= 0 ? '+' : ''}${delta} bytes, ${Date.now() - startMs}ms`, {
      path: target,
      matchCount,
      replaceAll,
      oldBytes,
      newBytes,
    });

    const replacedLabel = replaceAll ? `${matchCount} occurrences` : '1 occurrence';
    return `## File edited: ${target}\n- replaced: ${replacedLabel}\n- size: ${oldBytes} → ${newBytes} bytes (${delta >= 0 ? '+' : ''}${delta})`;
  }
}
