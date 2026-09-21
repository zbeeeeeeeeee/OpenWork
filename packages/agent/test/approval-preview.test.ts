import { describe, it, expect } from 'vitest';
import { buildApprovalPreview } from '../src/permission';

describe('buildApprovalPreview', () => {
  it('returns truncated previews for file_write params', () => {
    const long = 'x'.repeat(1000);
    const p = buildApprovalPreview({ path: 'a.txt', content: long });
    expect(p.path).toBe('a.txt');
    expect(p.contentPreview!.length).toBeLessThanOrEqual(520);
    expect(p.contentPreview).toContain('1000 chars');
    expect(p.contentLength).toBe(1000);
  });

  it('returns undefined for missing fields', () => {
    const p = buildApprovalPreview({});
    expect(p.path).toBeUndefined();
    expect(p.commandPreview).toBeUndefined();
    expect(p.contentPreview).toBeUndefined();
  });

  it('truncates command and old/new', () => {
    const long = 'y'.repeat(500);
    const p = buildApprovalPreview({
      path: 'b.ts',
      command: long,
      old: long,
      new: 'short',
    });
    expect(p.commandPreview!.length).toBeLessThanOrEqual(220);
    expect(p.oldPreview!.length).toBeLessThanOrEqual(320);
    expect(p.newPreview).toBe('short');
  });
});
