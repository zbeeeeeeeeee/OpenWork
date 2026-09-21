import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs';
import * as path from 'path';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import { resolveKey } from '../_shared/path';
import { buildWriteHunk } from '../_shared/file-change';
import {
  FILE_WRITE_TOOL_NAME,
  FILE_WRITE_TOOL_DESCRIPTION,
  FILE_WRITE_TOOL_USAGE,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to write (resolved against workspace root)' },
    content: {
      type: 'string',
      description: 'Full file content. Passed as the tag body, not as an attribute.',
    },
  },
  required: ['path', 'content'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
};

export class FileWriteTool implements ITool {
  readonly name = FILE_WRITE_TOOL_NAME;
  readonly description = FILE_WRITE_TOOL_DESCRIPTION;
  readonly usage = FILE_WRITE_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;
  /** Tool body carries the full file content; see parser.ts body-kind handling. */
  readonly body = 'content' as const;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const startMs = Date.now();
    const target = params.path;
    // body 内容由 parser 注入到 params.content,这里保证它是字符串(空串也是合法)
    const content = params.content ?? '';

    let absPath: string;
    let pathKey: string;
    try {
      const r = resolveKey(context.workspaceRoot, target);
      absPath = r.absPath;
      pathKey = r.key;
    } catch (e: any) {
      return `Error writing ${target}: ${e.message}`;
    }

    const existed = existsSync(absPath);

    // 前置校验:覆盖已存在文件必须先 read_file。
    // 新建文件不需要 read(没有内容可读)。
    if (existed && !context.readFileState?.has(pathKey)) {
      log.warn(`file_write refused: existing file not read before overwrite`, { path: target });
      return `Error: "${target}" already exists — you must call \`read_file\` on it before overwriting with file_write. Read it first, then retry. (For brand-new files, file_write works without a prior read.)`;
    }

    try {
      // 确保父目录存在
      const parent = path.dirname(absPath);
      if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
      }

      if (existed) {
        const prev = readFileSync(absPath, 'utf-8');
        context.onFileBackup?.(target, prev, true);
      } else {
        context.onFileBackup?.(target, null, false);
      }

      writeFileSync(absPath, content, 'utf-8');

      // 写完后登记到 readFileState:LLM 自己刚写的内容当然"知道",
      // 后续对同一文件的 edit/write 不应再被前置校验挡住。
      context.readFileState?.add(pathKey);

      const newBytes = Buffer.byteLength(content, 'utf-8');
      const newLines = content === '' ? 0 : content.split('\n').length;
      const kind = existed ? 'overwritten' : 'created';

      context.onFileChange?.({
        kind: existed ? 'write' : 'create',
        path: target,
        newSize: newBytes,
        hunks: [buildWriteHunk(content)],
        summary: `${kind} ${target}`,
      });

      log.info(`file_write ${kind}: ${newBytes} bytes, ${newLines} lines, ${Date.now() - startMs}ms`, {
        path: target,
        kind,
        newBytes,
        newLines,
      });

      return `## File ${kind}: ${target}\n- size: ${newBytes} bytes\n- lines: ${newLines}`;
    } catch (e: any) {
      log.warn(`file_write failed: ${e.message}`, { path: target, error: e.message });
      return `Error writing ${target}: ${e.message}`;
    }
  }
}
