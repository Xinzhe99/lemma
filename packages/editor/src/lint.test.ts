import { describe, expect, it } from 'vitest';
import { lintLatex } from './lint';

/** 取某行全部 issue 的消息 */
function messagesOf(issues: ReturnType<typeof lintLatex>, line?: number): string[] {
  return issues.filter((i) => line === undefined || i.line === line).map((i) => i.message);
}

describe('lintLatex：\\begin/\\end 环境配对', () => {
  it('配对完整（含跨行环境）不产生 issue', () => {
    const text = [
      '\\documentclass{article}',
      '\\begin{document}',
      '\\begin{equation}',
      'E = mc^2',
      '\\end{equation}',
      '\\end{document}',
    ].join('\n');
    expect(lintLatex(text)).toEqual([]);
  });

  it('多余 \\end（无对应 \\begin）在其所在行报 error', () => {
    const issues = lintLatex('\\begin{document}\n正文\n\\end{itemize}\n\\end{document}');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, severity: 'error' });
    expect(issues[0]!.message).toContain('\\end{itemize}');
  });

  it('文档结束时仍开放的 \\begin 报 error（含嵌套序号）', () => {
    const text = ['\\begin{document}', '\\begin{itemize}', '  \\item \\begin{enumerate}', '  \\end{enumerate}', '正文'].join('\n');
    const issues = lintLatex(text);
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ line: 1, severity: 'error' });
    expect(issues[0]!.message).toContain('第 1 层');
    expect(issues[1]).toMatchObject({ line: 2, severity: 'error' });
    expect(issues[1]!.message).toContain('第 2 层');
    expect(issues[1]!.message).toContain('\\end{itemize}');
  });

  it('嵌套序错乱：内层被外层 \\end 提前结束，报内层未闭合', () => {
    const text = ['\\begin{a}', '\\begin{b}', 'x', '\\end{a}'].join('\n');
    const issues = lintLatex(text);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 2, severity: 'error' });
    expect(issues[0]!.message).toContain('第 2 层');
    expect(issues[0]!.message).toContain('\\end{a}');
  });

  it('正确嵌套（多层同名环境）不误报', () => {
    const text = '\\begin{a}\n\\begin{a}\n\\end{a}\n\\end{a}\n\\begin{a}\n\\end{a}';
    expect(lintLatex(text)).toEqual([]);
  });

  it('注释中的 begin/end 与注释行内的花括号被忽略', () => {
    const text = [
      '% \\begin{ghost}',
      '\\begin{document}',
      '代码 % \\end{document} 与 % 注释} 不计数',
      '100\\% 的行 } 不该报？', // \% 转义后，} 是多余 —— 此行验证转义处理
      '\\end{document}',
      '% \\end{ghost} + 未闭合 {abc',
    ].join('\n');
    const issues = lintLatex(text);
    // 第 1/6 行是注释整行忽略；第 3 行注释段忽略后平衡；第 4 行 \% 转义后有一个多余 }；
    // 第 6 行整行注释忽略（{abc 在注释里）。document 环境正常闭合。
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 4, severity: 'warning' });
    expect(issues[0]!.message).toContain('多余的 }');
  });
});

describe('lintLatex：行内花括号', () => {
  it('转义 \\{ \\} 不计入平衡', () => {
    expect(lintLatex('\\{ 仅字面花括号 \\}')).toEqual([]);
    expect(lintLatex('\\\\{ 前面是换行命令，这个 { 计数')).toHaveLength(1);
  });

  it('缺少 } 报 warning 并给出数量', () => {
    const issues = lintLatex('\\textbf{未闭合');
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 1, severity: 'warning' });
    expect(issues[0]!.message).toContain('缺少 1 个 }');
  });

  it('多余的 } 报 warning；同 line 既缺又多合并为一条', () => {
    expect(messagesOf(lintLatex('a} b'))[0]).toContain('多余的 }（1 个）');
    const both = lintLatex('}x{');
    expect(both).toHaveLength(1);
    expect(both[0]!.message).toContain('多 1 个 }、缺 1 个 }');
  });
});

describe('lintLatex：\\ref/\\eqref 与 \\cite', () => {
  const labels = new Set(['sec:intro', 'eq:loss']);

  it('悬空 \\ref 对照 opts.labels 报 warning（行号正确）', () => {
    const text = '见 \\ref{sec:intro}。\n再看 \\eqref{eq:missing}。';
    const issues = lintLatex(text, { labels });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 2, severity: 'warning' });
    expect(issues[0]!.message).toContain('\\eqref{eq:missing}');
  });

  it('label 存在时不报；同一行重复悬空引用去重', () => {
    expect(lintLatex('\\ref{sec:intro} 与 \\eqref{eq:loss}', { labels })).toEqual([]);
    expect(lintLatex('\\ref{a} \\ref{a}', { labels })).toHaveLength(1);
  });

  it('未传 opts.labels 时退回正文自收集 label（不自报悬空）', () => {
    expect(lintLatex('\\section{A}\\label{a}\\ref{a}')).toEqual([]);
  });

  it('\\cite{K} 的 K 不在 opts.citekeys 报 warning；多键混合只报未知键', () => {
    const citekeys = new Set(['vaswani2017']);
    const issues = lintLatex('\\cite{vaswani2017} 与 \\cite{ghost, vaswani2017}', { citekeys });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 1, severity: 'warning' });
    expect(issues[0]!.message).toContain('\\cite{ghost}');
  });

  it('cite 命令家族（citep/cref 等）与可选参数均被检查', () => {
    const issues = lintLatex('\\citep[p.~5]{nope} \\cref{nope2}', { citekeys: new Set() });
    expect(issues).toHaveLength(2);
    expect(messagesOf(issues).join(' ')).toContain('nope');
  });

  it('未传 opts.citekeys 时退回正文自收集 key（不自报未知）', () => {
    expect(lintLatex('\\cite{anything}')).toEqual([]);
  });
});

describe('lintLatex：TODO 标记与空行', () => {
  it('TODO/FIXME 报 hint（注释行内也能发现）', () => {
    const issues = lintLatex('% TODO: 补实验\n正文 FIXME 也要报');
    expect(issues).toHaveLength(2);
    expect(issues[0]).toMatchObject({ line: 1, severity: 'hint' });
    expect(issues[0]!.message).toContain('TODO');
    expect(issues[1]).toMatchObject({ line: 2, severity: 'hint' });
  });

  it('连续两个空行不报，三个及以上在首个空行报一次 hint', () => {
    const two = lintLatex('a\n\n\nb');
    expect(two).toEqual([]);
    const three = lintLatex('a\n\n\n\nb');
    expect(three).toHaveLength(1);
    expect(three[0]).toMatchObject({ line: 2, severity: 'hint' });
  });
});

describe('lintLatex：整体行为', () => {
  it('多 issue 按行号升序稳定输出', () => {
    const text = [
      '\\begin{document}',
      '\\cite{ghost}',
      '% TODO x',
      '\\end{figure}',
      '\\end{document}',
    ].join('\n');
    const issues = lintLatex(text, { citekeys: new Set() });
    expect(issues.map((i) => i.line)).toEqual([2, 3, 4]);
    expect(issues.map((i) => i.severity)).toEqual(['warning', 'hint', 'error']);
  });

  it('空文本与纯注释文本返回空数组', () => {
    expect(lintLatex('')).toEqual([]);
    expect(lintLatex('% 全是注释 \\begin{doc} }\n% 第二行')).toEqual([]);
  });

  it('综合样例：未配对环境与悬空 ref 同现，行号对应（验收场景）', () => {
    const text = [
      '\\begin{document}',
      '\\begin{align}',
      'x = 1',
      '\\end{document}', // align 未闭合（第 1 层…实为第 2 层）且被提前结束
      '见 \\ref{nope}',
    ].join('\n');
    const issues = lintLatex(text, { labels: new Set(['ok']), citekeys: new Set() });
    const lines = issues.map((i) => i.line);
    expect(lines).toContain(2); // align 未闭合报在 begin 行
    expect(lines).toContain(5); // 悬空 ref 报在引用行
    expect(issues.find((i) => i.line === 2)!.severity).toBe('error');
    expect(issues.find((i) => i.line === 5)!.message).toContain('\\ref{nope}');
  });
});
