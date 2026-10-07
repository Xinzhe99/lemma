/**
 * 剪贴板表格 → LaTeX tabular 测试（v3.1.0 ①）。
 * 回归重点：产物必须能在未加载 booktabs 的文档里直接编译（只用 \hline）。
 */
import { describe, expect, it } from 'vitest';
import { clipboardToTable, parseClipboardTable, toLatexTabular } from './clipboardTable';

describe('parseClipboardTable', () => {
  it('TSV（Excel 复制）：制表符分隔、跨行列数补齐', () => {
    const rows = parseClipboardTable('a\tb\tc\n1\t2\n');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', ''],
    ]);
  });

  it('CSV / 分号分隔 / 引号包裹', () => {
    expect(parseClipboardTable('"a","b"\n"1","2"')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseClipboardTable('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('单行 / 无分隔符 → null（不生成只有一行的表）', () => {
    expect(parseClipboardTable('a\tb')).toBeNull();
    expect(parseClipboardTable('just one line')).toBeNull();
  });
});

describe('toLatexTabular', () => {
  const rows = [
    ['Method', 'Acc'],
    ['Ours', '95%_x'],
  ];

  it('产物只用 \\hline，不含 booktabs 命令（回归：此前用 \\toprule 导致未加载 booktabs 的文档编译失败）', () => {
    const latex = toLatexTabular(rows);
    expect(latex).not.toMatch(/\\(?:top|mid|bottom)rule/);
    expect(latex).toContain('\\hline');
    expect(latex).toContain('\\begin{tabular}{cc}');
    expect(latex).toContain('\\textbf{Method} & \\textbf{Acc} \\\\');
    expect(latex).toContain('Ours & 95\\%\\_x \\\\');
  });

  it('caption / label 转义与拼接', () => {
    const latex = toLatexTabular(rows, { caption: 'A & B', label: 'tab:x' });
    expect(latex).toContain('\\caption{A \\& B}');
    expect(latex).toContain('\\label{tab:x}');
  });

  it('空网格返回空串', () => {
    expect(toLatexTabular([])).toBe('');
  });
});

describe('clipboardToTable', () => {
  it('剪贴板文本直通生成表格；不可解析返回 null', () => {
    const latex = clipboardToTable('a\tb\n1\t2');
    expect(latex).toContain('\\begin{table}[htbp]');
    expect(latex).toContain('\\end{table}');
    expect(clipboardToTable('nope')).toBeNull();
  });
});
