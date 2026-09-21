import { i18n } from '../locales';

declare const __SERVER_PORT__: number;

const DEFAULT_BASE_URL: string = typeof __SERVER_PORT__ !== 'undefined'
  ? `http://localhost:${__SERVER_PORT__}`
  : '';

export interface GitStatusEntry {
  path: string;
  index: string;
  worktree: string;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  entries: GitStatusEntry[];
  error?: string;
}

export function createGitService(baseUrl = DEFAULT_BASE_URL) {
  function encodeRoot(root?: string): string {
    return root ? `?root=${encodeURIComponent(root)}` : '';
  }

  return {
    async status(root?: string): Promise<GitStatusResult> {
      const res = await fetch(`${baseUrl}/api/git/status${encodeRoot(root)}`);
      if (!res.ok) {
        const text = await res.text();
        return { isRepo: false, branch: null, entries: [], error: text };
      }
      return res.json();
    },

    async diff(root: string | undefined, file?: string): Promise<string> {
      const q = new URLSearchParams();
      if (root) q.set('root', root);
      if (file) q.set('file', file);
      const qs = q.toString() ? `?${q.toString()}` : '';
      const res = await fetch(`${baseUrl}/api/git/diff${qs}`);
      if (!res.ok) {
        return `${i18n.global.t('errors.apiError')} ${res.status}`;
      }
      const data = await res.json() as { diff?: string };
      return data.diff || '';
    },

    async commit(root: string | undefined, message: string): Promise<{ ok: boolean; error?: string }> {
      const res = await fetch(`${baseUrl}/api/git/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ root, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: String(res.status) }));
        return { ok: false, error: data.error || res.statusText };
      }
      return { ok: true };
    },
  };
}
