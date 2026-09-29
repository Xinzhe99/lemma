import { describe, expect, it } from 'vitest';
import { parseLatexLog } from './logParser';

const cleanLog = [
  'This is pdfTeX, Version 3.141592653-2.6-1.40.25 (TeX Live 2023) (preloaded format=pdflatex)',
  ' restricted \\write18 enabled.',
  'entering extended mode',
  '(./main.tex',
  'Document Class: article 2022/07/02 v1.4n Standard LaTeX document class',
  '(./refs.bbl',
  '[1{/usr/local/texlive/2023/texmf-dist/fonts/map/pdftex/updmap/pdftex.map}] [2]',
  ')',
  './main.tex: 5 pages, 2 buffers',
  ')',
].join('\n');

const errorLog = [
  '(./main.tex (./sections/intro.tex',
  '! Undefined control sequence.',
  'l.42 \\frametitl',
  '              {e}',
  ')',
  '! LaTeX Error: File `algorithms.sty\' not found.',
  '',
  'See the LaTeX manual or LaTeX Companion for explanation.',
  'Type  H <return>  for immediate help.',
  ' ...',
  'l.7 \\usepackage',
  '               {algorithms}',
  ')',
  '! Missing $ inserted.',
  '<inserted text>',
  '$',
  'l.15 E = m c',
  '              ^2',
  ')',
].join('\n');

const warningLog = [
  '(./main.tex (./sections/method.tex',
  "LaTeX Warning: Citation `knuth84' on page 1 undefined on input line 12.",
  '',
  "LaTeX Warning: Reference `fig:overview' on page 2 undefined on input line 45.",
  '',
  'LaTeX Warning: There were undefined references.',
  '',
  "LaTeX Warning: Label `eq:model' multiply defined.",
  '',
  'Overfull \\hbox (28.45274pt too wide) in paragraph at lines 34--40',
  '[]\\T1/cmr/m/n/10 In this section we elaborate on the proposed method and its ',
  'properties in detail.',
  '',
  'Underfull \\hbox (badness 10000) in paragraph at lines 50--55',
  ')',
  ')',
].join('\n');

describe('parseLatexLog', () => {
  it('成功日志不产生任何诊断', () => {
    expect(parseLatexLog(cleanLog)).toEqual([]);
  });

  it('解析 ! 错误行、l.<num> 行号与括号栈文件归属', () => {
    const ds = parseLatexLog(errorLog);
    expect(ds).toHaveLength(3);
    expect(ds.every((d) => d.severity === 'error')).toBe(true);

    expect(ds[0].message).toBe('Undefined control sequence.');
    expect(ds[0].file).toBe('sections/intro.tex');
    expect(ds[0].line).toBe(42);

    expect(ds[1].message).toContain("File `algorithms.sty' not found.");
    expect(ds[1].file).toBe('main.tex');
    expect(ds[1].line).toBe(7);

    expect(ds[2].message).toBe('Missing $ inserted.');
    expect(ds[2].line).toBe(15);
    expect(ds[2].file).toBeUndefined();
  });

  it('解析 LaTeX 警告（引用/交叉引用/重复标签）与行号', () => {
    const ds = parseLatexLog(warningLog);
    expect(ds).toHaveLength(6);
    expect(ds.slice(0, 4).every((d) => d.severity === 'warning')).toBe(true);

    const [citation, reference, undefinedRefs, multiply] = ds;
    expect(citation.message).toContain('knuth84');
    expect(citation.line).toBe(12);
    expect(citation.file).toBe('sections/method.tex');

    expect(reference.message).toContain('fig:overview');
    expect(reference.line).toBe(45);

    expect(undefinedRefs.message).toBe('There were undefined references.');
    expect(undefinedRefs.line).toBeUndefined();

    expect(multiply.message).toContain('multiply defined');
  });

  it('Overfull/Underfull box：行号、pt 数值与严重级别', () => {
    const ds = parseLatexLog(warningLog);
    const overfull = ds[4];
    const underfull = ds[5];
    expect(overfull.severity).toBe('warning');
    expect(overfull.message).toContain('28.45274pt');
    expect(overfull.line).toBe(34);
    expect(underfull.severity).toBe('info');
    expect(underfull.message).toContain('badness 10000');
    expect(underfull.line).toBe(50);
  });

  it('解析 -file-line-error 风格的 file:line: message', () => {
    const ds = parseLatexLog(['./sections/intro.tex:12: Undefined control sequence.', 'l.12 \\foo'].join('\n'));
    expect(ds).toHaveLength(1);
    expect(ds[0].severity).toBe('error');
    expect(ds[0].file).toBe('sections/intro.tex');
    expect(ds[0].line).toBe(12);
    expect(ds[0].message).toBe('Undefined control sequence.');
  });

  it('重跑提示类警告可被识别（供 pipeline 使用）', () => {
    const ds = parseLatexLog('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.');
    expect(ds).toHaveLength(1);
    expect(ds[0].message).toContain('Rerun to get cross-references right.');
  });
});
