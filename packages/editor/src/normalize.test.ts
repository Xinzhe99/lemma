/**
 * 文档格式规范化测试（v3.2.0 ②）：normalizeDocument + countFormatIssues。
 */

import { describe, expect, it } from 'vitest';
import { normalizeDocument, countFormatIssues } from './normalize';

describe('normalizeDocument', () => {
  it('智能引号 → 直引号', () => {
    const input = 'He said \\textbf{\u201Chello\u201D} and it\u2019s fine';
    const { result } = normalizeDocument(input);
    expect(result).toBe('He said \\textbf{"hello"} and it\'s fine');
  });

  it('Unicode 破折号 → LaTeX 命令', () => {
    const { result } = normalizeDocument('range 1\u20135 and em\u2014dash');
    expect(result).toBe('range 1--5 and em---dash');
  });

  it('省略号 → \\\\ldots', () => {
    const { result } = normalizeDocument('and so on...');
    expect(result).toContain('\\ldots{}');
  });

  it('连续空格 → 单空格', () => {
    const { result } = normalizeDocument('hello    world  foo');
    expect(result).toBe('hello world foo');
  });

  it('行尾空白删除', () => {
    const { result } = normalizeDocument('line one   \nline two\t\n');
    expect(result).toBe('line one\nline two\n');
  });

  it('verbatim 环境内不修改', () => {
    const input = '\\begin{verbatim}\n  keep    spaces...  \u201Cquotes\u201D\n\\end{verbatim}\nafter  double';
    const { result } = normalizeDocument(input);
    expect(result).toContain('keep    spaces...  \u201Cquotes\u201D');
    expect(result).toContain('after double');
  });

  it('无问题的文档返回原文', () => {
    const input = 'This is clean LaTeX with $x^2$ and \\textbf{bold}.';
    const { result, changes } = normalizeDocument(input);
    expect(result).toBe(input);
    expect(changes).toBe(0);
  });
});

describe('countFormatIssues', () => {
  it('统计各类问题数量', () => {
    const text = 'He said \u201Chi\u201D...  and    more\u2014';
    const issues = countFormatIssues(text);
    expect(issues.smartQuotes).toBe(2);
    expect(issues.ellipsis).toBe(1);
    expect(issues.doubleSpaces).toBe(2);
    expect(issues.unicodeDashes).toBe(1);
  });

  it('空文档全零', () => {
    const issues = countFormatIssues('');
    expect(issues.smartQuotes).toBe(0);
    expect(issues.ellipsis).toBe(0);
  });
});
