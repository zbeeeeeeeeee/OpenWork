/**
 * 工具间共享的路径工具。
 *
 * 设计原则:仅做"resolve + path-traversal 防护 + 大小写归一",
 * 不存任何状态(状态由 Agent.readFileState 持有)。
 */
import * as path from 'path';

/** win32 路径比较时统一小写,避免 C:\Proj 与 c:\proj 被当成不同路径。 */
function toComparable(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p;
}

/**
 * 把用户给定的路径解析为绝对路径,并确保不逃出 workspaceRoot。
 *
 * - root 先 path.resolve,再参与前缀比较(调用方可能传相对 root)
 * - 前缀比较带 path.sep,防止 /ws 匹配 /ws-evil
 * - win32 下大小写不敏感
 */
export function resolvePath(root: string, target: string): string {
  const absRoot = path.resolve(root);
  const abs = path.resolve(absRoot, target);
  const rootCmp = toComparable(absRoot);
  const absCmp = toComparable(abs);
  if (absCmp !== rootCmp && !absCmp.startsWith(rootCmp + path.sep)) {
    throw new Error(`Path traversal not allowed: ${target}`);
  }
  return abs;
}

/**
 * 把绝对路径规范化为 readFileState 的 key。
 * Windows 下不区分大小写,所以统一转小写;其余平台原样保留。
 */
export function normalizePathKey(absPath: string): string {
  return process.platform === 'win32' ? absPath.toLowerCase() : absPath;
}

/**
 * 把 resolvePath + normalizePathKey 一步搞定。
 * 任何需要写 readFileState / 查 readFileState 的工具都应走它,
 * 保证 key 一致。
 */
export function resolveKey(root: string, target: string): { absPath: string; key: string } {
  const absPath = resolvePath(root, target);
  return { absPath, key: normalizePathKey(absPath) };
}
