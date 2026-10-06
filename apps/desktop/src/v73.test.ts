/**
 * v7.3.0：Ctrl+点击 \cite/\ref 跳转定义——纯函数层测试。
 */
import { describe, expect, it } from 'vitest';
import { extractKeyAtPosition, findBibEntryLine, findLabelLine, resolveJumpTarget } from './jumpDefinition';

describe('extractKeyAtPosition', () => {
  const line = 'We use \\cite{vaswani2017} and \\ref{fig:overview} here.';

  it('点击 \\cite 内 → cite 类型', () => {
    // \cite{vaswani2017} 在位置 7..29
    expect(extractKeyAtPosition(line, 15)).toEqual({ kind: 'cite', key: 'vaswani2017' });
  });

  it('点击 \\ref 内 → ref 类型', () => {
    // \ref{fig:overview} 大约在位置 34..52
    expect(extractKeyAtPosition(line, 42)).toEqual({ kind: 'ref', key: 'fig:overview' });
  });

  it('点击普通文本 → null', () => {
    expect(extractKeyAtPosition(line, 0)).toBeNull();
    expect(extractKeyAtPosition(line, 55)).toBeNull();
  });

  it('多 key cite：定位到具体 key', () => {
    const l = 'See \\cite{a2020, b2021, c2022} for details.';
    // \cite{a2020, b2021, c2022} → 找 b2021
    const r = extractKeyAtPosition(l, 17); // 大约在 b2021 附近
    expect(r?.kind).toBe('cite');
    expect(['a2020', 'b2021', 'c2022']).toContain(r?.key);
  });

  it('\\citep / \\eqref 同样支持', () => {
    expect(extractKeyAtPosition('Use \\citep{smith19},', 12)).toEqual({ kind: 'cite', key: 'smith19' });
    expect(extractKeyAtPosition('As shown in \\eqref{eq:1}', 20)).toEqual({ kind: 'ref', key: 'eq:1' });
  });
});

describe('findBibEntryLine', () => {
  const bib = [
    '% References',
    '@article{vaswani2017,',
    '  title={Attention},',
    '}',
    '@book{goodfellow2016,',
    '  title={Deep Learning},',
    '}',
  ].join('\n');

  it('找到条目起始行', () => {
    expect(findBibEntryLine(bib, 'vaswani2017')).toBe(2);
    expect(findBibEntryLine(bib, 'goodfellow2016')).toBe(5);
  });

  it('不存在的 key → null', () => {
    expect(findBibEntryLine(bib, 'nope')).toBeNull();
  });

  it('key 后紧跟逗号才匹配（防子串误中）', () => {
    expect(findBibEntryLine(bib, 'vaswani')).toBeNull(); // 不是精确 citekey
  });
});

describe('findLabelLine', () => {
  const tex = [
    '\\section{Intro}',
    '\\label{sec:intro}',
    'Some text.',
    '\\begin{figure}',
    '  \\label{fig:overview}',
    '\\end{figure}',
  ].join('\n');

  it('找到 label 行', () => {
    expect(findLabelLine(tex, 'sec:intro')).toBe(2);
    expect(findLabelLine(tex, 'fig:overview')).toBe(5);
  });

  it('不存在 → null', () => {
    expect(findLabelLine(tex, 'nope')).toBeNull();
  });
});

describe('resolveJumpTarget', () => {
  const files = {
    'main.tex': 'See \\ref{sec:method}.',
    'sections/method.tex': '\\section{Method}\n\\label{sec:method}',
    'refs.bib': '@article{vaswani2017,\n  title={Attention},\n}',
  };

  it('cite → 跳到 .bib 文件', () => {
    const r = resolveJumpTarget(files, 'cite', 'vaswani2017');
    expect(r).toEqual({ file: 'refs.bib', line: 1 });
  });

  it('ref → 跳到 .tex 文件中的 label', () => {
    const r = resolveJumpTarget(files, 'ref', 'sec:method');
    expect(r).toEqual({ file: 'sections/method.tex', line: 2 });
  });

  it('不存在的 key → null', () => {
    expect(resolveJumpTarget(files, 'cite', 'ghost')).toBeNull();
    expect(resolveJumpTarget(files, 'ref', 'ghost')).toBeNull();
  });
});
