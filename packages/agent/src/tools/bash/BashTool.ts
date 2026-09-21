import { exec } from 'child_process';
import type { ITool, ToolInputSchema, ToolExecutionContext, ToolAnnotations } from '../../types/tool';
import { createLogger } from '../../logger';
import { LOG_CATEGORY } from '../../log-categories';
import {
  BASH_TOOL_NAME,
  BASH_TOOL_DESCRIPTION,
  BASH_TOOL_USAGE,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  MAX_OUTPUT_LENGTH,
} from './prompt';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

/** Windows PowerShell 强制 UTF-8，避免中文路径/输出乱码 */
function wrapPowerShellUtf8(command: string): string {
  return (
    "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "$OutputEncoding=[System.Text.Encoding]::UTF8; " +
    "chcp 65001 | Out-Null; " +
    command
  );
}

/** 判断是否像「在 PowerShell 上跑了 Unix 命令」而失败 */
function looksLikeUnixCommandOnPowerShell(command: string, stderr: string): boolean {
  if (process.platform !== 'win32') return false;
  if (!stderr) return false;
  const unixy = /(^|\s)(ls(\s+-la?)?|find\s|head\s|pwd|cat\s|grep\s|which\s|export\s)/i.test(command);
  const failHint =
    /ParameterBindingException|CommandNotFoundException|is not recognized|FIND:|The term .* is not recognized/i.test(
      stderr,
    );
  return unixy && failHint;
}

const inputSchema: ToolInputSchema = {
  type: 'object',
  properties: {
    command: { type: 'string', description: 'The command to execute' },
    timeout: {
      type: 'string',
      description: `Optional timeout in milliseconds (max ${MAX_TIMEOUT_MS}, default ${DEFAULT_TIMEOUT_MS})`,
    },
    description: { type: 'string', description: 'Description of what this command does (for logging)' },
  },
  required: ['command'],
};

const annotations: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export class BashTool implements ITool {
  readonly name = BASH_TOOL_NAME;
  readonly description = BASH_TOOL_DESCRIPTION;
  readonly usage = BASH_TOOL_USAGE;
  readonly inputSchema = inputSchema;
  readonly annotations = annotations;

  async execute(params: Record<string, string>, context: ToolExecutionContext): Promise<string> {
    const command = (params.command || '').trim();
    if (!command) return 'Error: No command provided';

    const timeout = this.resolveTimeout(params.timeout);
    const description = params.description || '';
    const startMs = Date.now();
    const cmdPreview = command.length > 100 ? command.slice(0, 100) + '...' : command;
    const isWin = process.platform === 'win32';
    // Windows PowerShell 默认按系统代码页(中文机常为 GBK)输出，中文路径/文件名会变乱码
    const wrapped = isWin ? wrapPowerShellUtf8(command) : command;

    return new Promise<string>(resolve => {
      const child = exec(wrapped, {
        cwd: context.workspaceRoot,
        timeout,
        maxBuffer: 10 * 1024 * 1024,  // 10 MB stdout+stderr
        windowsHide: true,
        shell: isWin ? 'powershell.exe' : '/bin/bash',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      }, (error, stdout, stderr) => {
        const elapsed = Date.now() - startMs;
        if (child.killed) {
          log.warn(`bash timed out after ${elapsed}ms`, { command: cmdPreview, timeout });
          resolve(this.formatResult(command, description, '', 'Command timed out after timeout', true));
          return;
        }

        const exitCode = error?.code ?? 0;
        log.info(`bash done: exit=${exitCode}, stdout=${stdout.length} chars, stderr=${stderr.length} chars, ${elapsed}ms`, { command: cmdPreview, exitCode, stdoutLen: stdout.length, stderrLen: stderr.length });
        resolve(this.formatResult(command, description, stdout, stderr));
      });

      child.on('error', err => {
        log.warn(`bash error: ${err.message}`, { command: cmdPreview });
        resolve(`## Bash Error\nCommand: \`${command}\`\n\n${err.message}`);
      });
    });
  }

  private resolveTimeout(raw: string | undefined): number {
    if (!raw) return DEFAULT_TIMEOUT_MS;
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(parsed, MAX_TIMEOUT_MS);
  }

  private formatResult(
    command: string,
    description: string,
    stdout: string,
    stderr: string,
    timedOut = false,
  ): string {
    const header = description
      ? `## Bash: ${description}\nCommand: \`${command}\``
      : `## Bash\nCommand: \`${command}\``;

    if (timedOut) {
      return `${header}\n\n**⚠ Command timed out**\n\n${this.truncate(stderr, 'stderr')}`;
    }

    const parts: string[] = [header];

    if (stdout) {
      parts.push(`### stdout\n\`\`\`\n${this.truncate(stdout, 'stdout')}\n\`\`\``);
    }
    if (stderr) {
      parts.push(`### stderr\n\`\`\`\n${this.truncate(stderr, 'stderr')}\n\`\`\``);
    }
    if (!stdout && !stderr) {
      parts.push('*(no output)*');
    }

    // Windows PowerShell 下常见 Unix 命令失败 —— 明确提示改用文件工具，避免模型无限重试
    if (looksLikeUnixCommandOnPowerShell(command, stderr)) {
      parts.push(
        '> **Hint**: This environment uses **Windows PowerShell**. ' +
        'Unix commands (`ls -la`, `find`, `head`, `pwd`) often fail here. ' +
        'Prefer `list_dir` / `read_file` / `search_code` to explore files. ' +
        'Do not retry the same failing command.',
      );
    }

    return parts.join('\n\n');
  }

  private truncate(content: string, label: string): string {
    if (content.length <= MAX_OUTPUT_LENGTH) return content;
    const omitted = content.length - MAX_OUTPUT_LENGTH;
    return content.slice(0, MAX_OUTPUT_LENGTH) +
      `\n\n... [${omitted} more characters of ${label} truncated] ...`;
  }
}
