import { describe, expect, it } from 'vitest';
import { escapeCell, gridToTabular, parseTabular } from './tablegen';

describe('parseTabular', () => {
  it('基础解析：colspec、行内容，顶部/底部惯例 \\hline 不判为表头', () => {
    const code = [
      '\\begin{tabular}{|c|c|}',
      '\\hline',
      'a & b \\\\',
      'c & d \\\\',
      '\\hline',
      '\\end{tabular}',
    ].join('\n');
    expect(parseTabular(code)).toEqual({
      colspec: '|c|c|',
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      hasHeader: false,
    });
  });

  it('\\hline 出现在首行数据后（独立行）→ hasHeader=true', () => {
    const code = ['\\begin{tabular}{ll}', '名称 & 值 \\\\', '\\hline', 'a & 1 \\\\', '\\end{tabular}'].join('\n');
    expect(parseTabular(code)).toEqual({
      colspec: 'll',
      rows: [
        ['名称', '值'],
        ['a', '1'],
      ],
      hasHeader: true,
    });
  });

  it('行尾跟随 \\hline（a & b \\\\ \\hline）同样判定表头', () => {
    const code = '\\begin{tabular}{cc}\nx & y \\\\ \\hline\n1 & 2 \\\\\n\\end{tabular}';
    expect(parseTabular(code)).toMatchObject({ hasHeader: true, rows: [['x', 'y'], ['1', '2']] });
  });

  it('容忍行尾空格、空行与 % 注释行/行尾注释', () => {
    const code = [
      '\\begin{tabular}{cc}',
      '% 整行注释不影响解析',
      'a & b \\\\   % 行尾注释',
      '',
      '  c & d \\\\  ',
      '\\hline',
      '\\end{tabular}',
    ].join('\n');
    expect(parseTabular(code)).toMatchObject({
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
      hasHeader: false,
    });
  });

  it('单元格转义还原：\\& \\% \\# \\_ 还原为字面字符，且 \\& 不误切列', () => {
    const code = '\\begin{tabular}{cc}\n50\\% & a\\_b \\\\\nC\\# & x\\&y \\\\\n\\end{tabular}';
    expect(parseTabular(code)).toEqual({
      colspec: 'cc',
      rows: [
        ['50%', 'a_b'],
        ['C#', 'x&y'],
      ],
      hasHeader: false,
    });
  });

  it('缺失 \\end{tabular} → 中文 error', () => {
    const r = parseTabular('\\begin{tabular}{c}\na \\\\');
    expect('error' in r && r.error).toContain('\\end{tabular}');
  });

  it('无 tabular 环境 → 中文 error', () => {
    expect(parseTabular('正文里没有表格')).toHaveProperty('error');
  });

  it('嵌套环境（array/minipage 等）→ 中文 error', () => {
    const code = [
      '\\begin{tabular}{c}',
      '\\begin{minipage}{2cm}x\\end{minipage} \\\\',
      '\\end{tabular}',
    ].join('\n');
    const r = parseTabular(code);
    expect('error' in r && r.error).toContain('嵌套');
  });

  it('缺失列规格 {…} → 中文 error', () => {
    expect(parseTabular('\\begin{tabular} a \\\\ \\end{tabular}')).toHaveProperty('error');
  });

  it('末行缺少行尾 \\\\ 也容忍', () => {
    const code = '\\begin{tabular}{cc}\na & 1 \\\\\nb & 2\n\\end{tabular}';
    expect(parseTabular(code)).toMatchObject({
      rows: [
        ['a', '1'],
        ['b', '2'],
      ],
    });
  });

  it('代码含多个 tabular 块时解析第一个', () => {
    const code = [
      '\\begin{tabular}{c}',
      'first \\\\',
      '\\end{tabular}',
      '\\begin{tabular}{c}',
      'second \\\\',
      '\\end{tabular}',
    ].join('\n');
    expect(parseTabular(code)).toMatchObject({ colspec: 'c', rows: [['first']] });
  });

  it('同一行内写多个 \\\\ 也按多行解析（回归：此前整行并成一个单元格）', () => {
    expect(parseTabular('\\begin{tabular}{cc}a & b \\\\ c & d\\end{tabular}')).toMatchObject({
      colspec: 'cc',
      rows: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    });
    // \\[2pt] / \\* 变体同样作为行终止符
    expect(parseTabular('\\begin{tabular}{c}x \\\\[2pt] y \\\\* z\\end{tabular}')).toMatchObject({
      rows: [['x'], ['y'], ['z']],
    });
    // 单元格内的转义 \% 不误判为终止符
    expect(parseTabular('\\begin{tabular}{c}50\\% \\\\ a\\_b\\end{tabular}')).toMatchObject({
      rows: [['50%'], ['a_b']],
    });
  });
});

describe('escapeCell', () => {
  it('转义 & % # _ 四字符', () => {
    expect(escapeCell('a&b%c#d_e')).toBe('a\\&b\\%c\\#d\\_e');
  });

  it('普通文本与既有反斜杠命令保持不变', () => {
    expect(escapeCell('准确率')).toBe('准确率');
    expect(escapeCell('\\textbf{x}')).toBe('\\textbf{x}');
  });
});

describe('gridToTabular', () => {
  it('生成含头尾 \\hline 的完整 tabular，单元格经 escapeCell', () => {
    expect(gridToTabular('|c|c|', [['a', 'b&c'], ['50%', 'x_y']])).toBe(
      [
        '\\begin{tabular}{|c|c|}',
        '\\hline',
        'a & b\\&c \\\\',
        '50\\% & x\\_y \\\\',
        '\\hline',
        '\\end{tabular}',
      ].join('\n'),
    );
  });

  it('空网格仍生成合法骨架', () => {
    expect(gridToTabular('c', [])).toBe('\\begin{tabular}{c}\n\\hline\n\\hline\n\\end{tabular}');
  });

  it('round-trip：gridToTabular → parseTabular 还原一致（含 & % # _ 与中文）', () => {
    const rows = [
      ['方法', '准确率', '备注'],
      ['BERT', '82.5%', '基准'],
      ['Ours', '90&95', 'a_b#c%d'],
    ];
    expect(parseTabular(gridToTabular('|c|c|c|', rows))).toEqual({
      colspec: '|c|c|c|',
      rows,
      hasHeader: false,
    });
  });

  it('round-trip：已有表格 parse → grid → parse 结果稳定', () => {
    const src = [
      '\\begin{tabular}{lll}',
      '名称 & 值 & 说明 \\\\',
      '\\hline',
      'a & 1 & x \\\\ % 备注',
      '\\end{tabular}',
    ].join('\n');
    const first = parseTabular(src);
    expect(first).toMatchObject({ hasHeader: true });
    if (!('error' in first)) {
      expect(parseTabular(gridToTabular(first.colspec, first.rows))).toMatchObject({
        colspec: first.colspec,
        rows: first.rows,
      });
    }
  });
});
