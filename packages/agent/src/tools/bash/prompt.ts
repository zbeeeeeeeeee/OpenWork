/** BashTool 提示词与常量 */

export const BASH_TOOL_NAME = 'bash';

export const BASH_TOOL_DESCRIPTION =
  'Execute a shell command in the project directory. On Windows this is PowerShell (not Unix bash). Prefer list_dir/read_file for exploring files. Returns stdout and stderr.';

export const BASH_TOOL_USAGE = '<bash command="..." [timeout="120000"] [description="..."/>';

export const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes
export const MAX_TIMEOUT_MS = 600_000;       // 10 minutes
export const MAX_OUTPUT_LENGTH = 120_000;    // characters before truncation

export const BASH_TOOL_PROMPT = `Execute a shell command in the project directory.

Usage:
- Use this tool for running tests, build commands, git operations, or inspecting the environment.
- For listing directories or reading files, prefer list_dir / read_file — not bash.
- The command runs in the workspace root with a configurable timeout (default ${DEFAULT_TIMEOUT_MS}ms, max ${MAX_TIMEOUT_MS}ms).
- Output longer than ${MAX_OUTPUT_LENGTH} characters is truncated with a marker.
- On Windows the shell is PowerShell (UTF-8 enforced). Unix commands like ls -la / find / head often fail — do not retry them.`;
