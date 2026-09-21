import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolvePath, normalizePathKey, resolveKey } from '../src/tools/_shared/path';

const isWin = process.platform === 'win32';

/** 构造测试用的 workspace 根目录（绝对路径）。 */
function wsRoot(...parts: string[]): string {
  return path.resolve(path.sep === '\\' ? 'C:\\openwork-ws-test' : '/openwork-ws-test', ...parts);
}

describe('resolvePath', () => {
  it('resolves a normal relative path under root', () => {
    const root = wsRoot();
    const abs = resolvePath(root, path.join('src', 'a.ts'));
    expect(abs).toBe(path.join(root, 'src', 'a.ts'));
  });

  it('allows the workspace root itself', () => {
    const root = wsRoot();
    expect(resolvePath(root, '.')).toBe(root);
    expect(resolvePath(root, root)).toBe(root);
  });

  it('rejects parent-directory traversal', () => {
    const root = wsRoot();
    expect(() => resolvePath(root, path.join('..', 'etc', 'passwd'))).toThrow(
      /Path traversal not allowed/,
    );
  });

  it('rejects nested traversal that escapes root', () => {
    const root = wsRoot();
    expect(() => resolvePath(root, path.join('src', '..', '..', 'secret'))).toThrow(
      /Path traversal not allowed/,
    );
  });

  it('rejects absolute path outside root', () => {
    const root = wsRoot();
    const outside = path.resolve(path.sep === '\\' ? 'C:\\Windows\\System32' : '/etc/passwd');
    expect(() => resolvePath(root, outside)).toThrow(/Path traversal not allowed/);
  });

  it('does not treat sibling prefix as inside root (/ws vs /ws-evil)', () => {
    const root = wsRoot('proj');
    const evil = wsRoot('proj-evil');
    // 伪 target:落在 root 同级前缀目录
    expect(() => resolvePath(root, path.relative(root, path.join(evil, 'x.txt')))).toThrow(
      /Path traversal not allowed/,
    );
    // 直接用绝对路径写到前缀兄弟目录也必须拒绝
    expect(() => resolvePath(root, path.join(evil, 'x.txt'))).toThrow(
      /Path traversal not allowed/,
    );
  });

  it('normalizes relative root before comparison', () => {
    // 调用方可能传相对 root;不应误判为穿越
    const root = process.cwd();
    const abs = resolvePath(root, 'package.json');
    expect(abs).toBe(path.resolve(root, 'package.json'));
  });

  it.runIf(isWin)('allows different drive-letter casing on Windows', () => {
    const root = 'C:\\openwork-ws-test';
    const target = 'c:\\openwork-ws-test\\src\\a.ts';
    expect(resolvePath(root, target)).toBe(path.resolve(target));
  });

  it.runIf(isWin)('allows relative path when root casing differs from resolved path', () => {
    const root = 'C:\\openwork-ws-test';
    const abs = resolvePath(root, 'src\\a.ts');
    expect(abs.toLowerCase()).toContain('openwork-ws-test');
    expect(() => resolvePath(root, '..\\..\\secret')).toThrow(/Path traversal not allowed/);
  });
});

describe('normalizePathKey', () => {
  it('lowercases only on win32', () => {
    const p = path.resolve(path.sep === '\\' ? 'C:\\Foo\\Bar.ts' : '/Foo/Bar.ts');
    const key = normalizePathKey(p);
    if (isWin) {
      expect(key).toBe(p.toLowerCase());
    } else {
      expect(key).toBe(p);
    }
  });

  it('is stable for the same logical path under different casing on win32', () => {
    if (!isWin) return;
    expect(normalizePathKey('C:\\A\\b.ts')).toBe(normalizePathKey('c:\\a\\B.TS'));
  });
});

describe('resolveKey', () => {
  it('returns absPath and a platform-normalized key', () => {
    const root = wsRoot();
    const { absPath, key } = resolveKey(root, path.join('src', 'a.ts'));
    expect(absPath).toBe(path.join(root, 'src', 'a.ts'));
    expect(key).toBe(normalizePathKey(absPath));
  });

  it.runIf(isWin)('produces the same key for different casing paths', () => {
    const root = 'C:\\openwork-ws-test';
    const a = resolveKey(root, 'Src\\A.ts');
    const b = resolveKey(root, 'src\\a.ts');
    expect(a.key).toBe(b.key);
  });

  it('propagates traversal errors', () => {
    const root = wsRoot();
    expect(() => resolveKey(root, path.join('..', 'out'))).toThrow(/Path traversal not allowed/);
  });
});
