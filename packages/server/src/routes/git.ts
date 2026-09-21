import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import { createLogger, LOG_CATEGORY } from '@openwork/agent';

const log = createLogger(LOG_CATEGORY.FILE_OPS);

function runGit(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      windowsHide: true,
      // 不经过 shell，避免注入
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
      if (stdout.length > 2_000_000) {
        stdout = stdout.slice(0, 2_000_000) + '\n…[truncated]';
      }
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function resolveCwd(req: Request): string {
  const root = (req.query.root as string) || (req.body as { root?: string })?.root || process.cwd();
  return path.resolve(root);
}

/** 解析 git status --porcelain=v1 -uall */
function parseStatusPorcelain(stdout: string): Array<{ path: string; index: string; worktree: string }> {
  const lines = stdout.split('\n').filter((l) => l.length >= 3);
  return lines.map((line) => {
    // XY path  或  XY old -> new
    const index = line[0] || ' ';
    const worktree = line[1] || ' ';
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow >= 0) p = p.slice(arrow + 4);
    p = p.replace(/^"|"$/g, '');
    return { path: p, index, worktree };
  });
}

export function createGitRouter(): Router {
  const router = Router();

  /** 是否 git 仓库 */
  router.get('/is-repo', async (req, res) => {
    const cwd = resolveCwd(req);
    try {
      const r = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      res.json({ isRepo: r.code === 0 && r.stdout.trim() === 'true' });
    } catch (e: any) {
      res.json({ isRepo: false, error: e.message });
    }
  });

  /** 分支 + 变更列表 */
  router.get('/status', async (req, res) => {
    const cwd = resolveCwd(req);
    try {
      const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      if (inside.code !== 0) {
        res.json({ isRepo: false, branch: null, entries: [] });
        return;
      }
      const branch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
      const status = await runGit(cwd, ['status', '--porcelain=v1', '-uall']);
      const entries = parseStatusPorcelain(status.stdout);
      res.json({
        isRepo: true,
        branch: branch.stdout.trim() || null,
        entries,
      });
    } catch (e: any) {
      log.warn(`git status failed: ${e.message}`, { error: e.message });
      res.status(500).json({ isRepo: false, error: e.message, entries: [] });
    }
  });

  /** 单文件或全部 diff（unified） */
  router.get('/diff', async (req, res) => {
    const cwd = resolveCwd(req);
    const file = (req.query.file as string) || undefined;
    const staged = req.query.staged === 'true';
    try {
      const args = ['diff', '--no-color'];
      if (staged) args.push('--cached');
      // 超长 diff 截断在客户端；服务端 cap 行数
      if (file) args.push('--', file);
      const r = await runGit(cwd, args);
      let out = r.stdout;
      const maxLines = 2000;
      const lines = out.split('\n');
      let truncated = false;
      if (lines.length > maxLines) {
        out = lines.slice(0, maxLines).join('\n') + '\n…[diff truncated]';
        truncated = true;
      }
      res.json({ diff: out, truncated, code: r.code, stderr: r.stderr });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  /** 提交全部变更（add -A + commit） */
  router.post('/commit', async (req, res) => {
    const cwd = resolveCwd(req);
    const message = (req.body as { message?: string })?.message?.trim();
    if (!message) {
      res.status(400).json({ error: 'message required' });
      return;
    }
    try {
      const add = await runGit(cwd, ['add', '-A']);
      if (add.code !== 0) {
        res.status(500).json({ error: add.stderr || 'git add failed' });
        return;
      }
      const commit = await runGit(cwd, ['commit', '-m', message]);
      if (commit.code !== 0) {
        res.status(500).json({ error: commit.stderr || commit.stdout || 'git commit failed' });
        return;
      }
      res.json({ success: true, stdout: commit.stdout });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  return router;
}
