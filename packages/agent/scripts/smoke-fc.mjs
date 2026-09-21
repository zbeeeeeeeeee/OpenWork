#!/usr/bin/env node
/**
 * Phase 1 FC 真机冒烟（本地 / Electron 联调用）。
 *
 * 用法（Windows PowerShell 示例）：
 *   $env:LLM_API_URL="https://api.deepseek.com/v1"
 *   $env:LLM_API_KEY="sk-..."
 *   $env:LLM_MODEL="deepseek-chat"
 *   $env:LOG_FILE="1"
 *   node packages/agent/scripts/smoke-fc.mjs
 *
 * 可选：SMOKE_ROOT 指定工作区（默认临时目录，结束删除）。
 * 流程：写 seed.txt → Agent（toolProtocol=auto）读 + 写 result.txt → 校验。
 */
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AgentRuntime } = require('../dist/index.js');

const model = process.env.LLM_MODEL || 'deepseek-chat';
const apiUrl = process.env.LLM_API_URL;
const apiKey = process.env.LLM_API_KEY;

if (!apiKey) {
  console.error('缺少 LLM_API_KEY。请设置后重试。');
  process.exit(1);
}

const root = process.env.SMOKE_ROOT || mkdtempSync(join(tmpdir(), 'openwork-fc-smoke-'));
const isTemp = !process.env.SMOKE_ROOT;
const seedAbs = join(root, 'seed.txt');
writeFileSync(seedAbs, 'hello-fc-smoke\n', 'utf-8');

const runtime = new AgentRuntime({
  mode: 'build',
  provider: { apiUrl, apiKey, model },
  workspaceRoot: root,
  enableBash: false,
  toolProtocol: 'auto',
  // 冒烟脚本无交互确认，须允许写文件
  permissionMode: 'full-auto',
});

console.log(`[smoke] root=${root}`);
console.log(`[smoke] model=${model} api=${apiUrl || '(env default)'}`);

try {
  await runtime.initialize();
  const result = await runtime.chatStream(
    '请用工具完成：1) 用 read_file 读取 seed.txt；2) 用 file_write 创建 result.txt，内容为种子文件全文加一行 DONE。不要输出其它无关工具调用。',
    {
      // build 模式走 SessionMemory.projectToLLMMessages，需要 IDESnapshot
      openFilePaths: [],
      fileTree: [],
    },
  );

  const resultAbs = join(root, 'result.txt');
  const okFile = existsSync(resultAbs);
  const resultContent = okFile ? readFileSync(resultAbs, 'utf-8') : '';

  console.log('\n--- turns ---', result.turns);
  console.log('--- toolCalls ---', result.toolCalls.map((t) => t.type).join(', '));
  console.log('--- content tail ---\n' + (result.content || '').slice(-400));

  if (!existsSync(seedAbs)) throw new Error('seed.txt missing');
  if (!okFile) throw new Error('result.txt was not written by agent');
  const usedTools = result.toolCalls.map((t) => t.type);
  if (!usedTools.includes('read_file') && !usedTools.includes('file_write')) {
    console.warn('[smoke] 未观察到 read_file/file_write，请检查协议/模型能力');
  }
  if (!resultContent.includes('DONE') && !resultContent.includes('hello-fc-smoke')) {
    console.warn('[smoke] result.txt 内容异常：\n' + resultContent.slice(0, 200));
  }

  console.log('\n[smoke] PASS');
} catch (e) {
  console.error('\n[smoke] FAIL', e && e.message ? e.message : e);
  process.exitCode = 1;
} finally {
  await runtime.dispose();
  if (isTemp) {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
