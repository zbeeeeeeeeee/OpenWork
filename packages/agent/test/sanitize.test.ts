import { describe, it, expect } from 'vitest';
import { stripToolMarkup, sanitizeThinking, sanitizeDisplayContent, COMMON_TOOL_NAMES } from '../src/sanitize';

describe('sanitize / stripToolMarkup', () => {
  it('keeps natural language', () => {
    expect(sanitizeThinking('我来先了解一下项目结构。')).toBe('我来先了解一下项目结构。');
  });

  it('strips self-closing tool XML tags from thinking', () => {
    const raw = [
      '我来先了解一下项目的目录结构，找到实验一的相关内容。',
      '',
      '<list_dir path="G:\\project\\root"/>',
    ].join('\n');
    const out = sanitizeThinking(raw);
    expect(out).toContain('我来先了解一下项目的目录结构');
    expect(out).not.toContain('<list_dir');
  });

  it('strips DSML invoke blocks (fullwidth bars)', () => {
    const raw = [
      '实验一就是跑马灯实验，我来看看它的具体内容。',
      '',
      '<｜｜DSML｜｜ calls>',
      '<｜｜DSML｜｜ invoke name="bash">',
      '<｜｜DSML｜｜ parameter name="command" string="true">ls -1 "G:\\x"</｜｜DSML｜｜ parameter>',
      '</｜｜DSML｜｜ invoke>',
      '</｜｜DSML｜｜ calls>',
    ].join('\n');
    const out = sanitizeThinking(raw);
    expect(out).toContain('实验一就是跑马灯实验');
    expect(out).not.toContain('DSML');
    expect(out).not.toContain('<invoke');
  });

  it('strips malformed DSML invoke tags', () => {
    const raw = [
      '继续查看。',
      '<｜｜DSML｜｜ calls>',
      '<｜｜DSML｜｜ invoke name="list_dir path="G:\\实验1 跑马灯实验"/>',
    ].join('\n');
    const out = sanitizeThinking(raw);
    expect(out).toContain('继续查看');
    expect(out).not.toContain('DSML');
  });

  it('strips body-form tool tags', () => {
    const raw = '准备写入。\n<file_write path="a.txt">hello\nworld</file_write>\n完成。';
    const out = stripToolMarkup(raw);
    expect(out).toContain('准备写入');
    expect(out).toContain('完成');
    expect(out).not.toContain('file_write');
    expect(out).not.toContain('hello');
  });

  it('strips **[Tool:]** result blocks from display content', () => {
    const raw = [
      '好的，已列出目录。',
      '',
      '**[Tool: list_dir]**',
      'Directory: /x',
      '📁 a/',
      '',
      '实验一对应跑马灯。',
    ].join('\n');
    const out = sanitizeDisplayContent(raw);
    expect(out).toContain('好的，已列出目录');
    expect(out).toContain('实验一对应跑马灯');
    expect(out).not.toContain('[Tool:');
    expect(out).not.toContain('Directory:');
  });

  it('accepts extra tool names', () => {
    const out = stripToolMarkup('看这里\n<my_custom_tool path="x"/>\n结束', ['my_custom_tool']);
    expect(out).toContain('看这里');
    expect(out).toContain('结束');
    expect(out).not.toContain('my_custom_tool');
  });

  it('does not strip unrelated HTML-like text', () => {
    const out = sanitizeDisplayContent('Use <div> and <span> in HTML.');
    expect(out).toContain('<div>');
    expect(out).toContain('<span>');
  });

  it('exports common tool names', () => {
    expect(COMMON_TOOL_NAMES).toContain('list_dir');
    expect(COMMON_TOOL_NAMES).toContain('bash');
  });

  it('strips incomplete trailing tool tags during streaming', () => {
    expect(sanitizeThinking('我来看看。\n<list_dir path="G:\\实验1')).toContain('我来看看');
    expect(sanitizeThinking('我来看看。\n<list_dir path="G:\\实验1')).not.toContain('<list_dir');
    expect(sanitizeThinking('继续。\n<｜｜DSML｜｜ invoke name="bash')).not.toContain('DSML');
    expect(sanitizeThinking('继续。\n<invoke name="list_dir')).not.toContain('<invoke');
  });

  it('strips incomplete tag then complete tag after more stream chunks', () => {
    const part1 = '先列目录。\n<list_dir path="';
    const part2 = 'G:\\x"/>';
    expect(sanitizeThinking(part1 + part2)).toBe('先列目录。');
  });
});
