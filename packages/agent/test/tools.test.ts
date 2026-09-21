import { describe, it, expect } from 'vitest';
import { createDefaultTools } from '../src/tools/index';

describe('createDefaultTools', () => {
  it('registers 7 tools by default', () => {
    const tools = createDefaultTools();
    expect(tools.map(t => t.name)).toEqual([
      'list_dir',
      'read_file',
      'search_code',
      'file_edit',
      'file_write',
      'bash',
      'delegate',
    ]);
  });

  it('excludes bash tool when enableBash is false', () => {
    const tools = createDefaultTools({ enableBash: false });
    expect(tools.some(t => t.name === 'bash')).toBe(false);
    expect(tools.map(t => t.name)).toEqual([
      'list_dir',
      'read_file',
      'search_code',
      'file_edit',
      'file_write',
      'delegate',
    ]);
  });

  it('keeps bash enabled by default', () => {
    expect(createDefaultTools({}).some(t => t.name === 'bash')).toBe(true);
  });
});
