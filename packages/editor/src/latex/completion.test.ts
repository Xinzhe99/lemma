import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import {
  LATEX_SNIPPETS,
  fuzzyMatch,
  latexCompletionSource,
  latexSnippetCompletions,
  latexSupport,
  type CitationEntry,
} from './completion';

const CITATIONS: CitationEntry[] = [
  { citekey: 'vaswani2017', title: 'Attention Is All You Need', year: 2017 },
  { citekey: 'devlin2019', title: 'BERT: Pre-training of Deep Bidirectional Transformers', year: 2019 },
  { citekey: 'noyear2020', title: '某无年份条目' },
];

/** 在给定文档/光标处构造补全上下文 */
function ctxOf(doc: string, pos = doc.length): CompletionContext {
  return new CompletionContext(EditorState.create({ doc }), pos, false);
}

/** 同步执行补全源（本包的 source 永不返回 Promise） */
function run(source: ReturnType<typeof latexCompletionSource>, doc: string, pos?: number): CompletionResult | null {
  return source(ctxOf(doc, pos)) as CompletionResult | null;
}

describe('LATEX_SNIPPETS', () => {
  const REQUIRED = [
    'figure',
    'table',
    'equation',
    'align',
    'itemize',
    'enumerate',
    'theorem',
    'definition',
    'abstract',
  ];

  it('数量不少于 12，覆盖规格要求的环境', () => {
    expect(LATEX_SNIPPETS.length).toBeGreaterThanOrEqual(12);
    const labels = LATEX_SNIPPETS.map((s) => s.label);
    for (const r of REQUIRED) expect(labels).toContain(r);
  });

  it('每个 snippet 都带光标占位符，环境类 snippet 的 begin/end 配对', () => {
    for (const s of LATEX_SNIPPETS) {
      expect(s.template).toMatch(/\$\{\d/);
      expect(s.detail.length).toBeGreaterThan(0);
      if (s.template.includes('\\begin{')) {
        const opened = [...s.template.matchAll(/\\begin\{([^}]+)\}/g)].map((m) => m[1]);
        for (const env of opened) expect(s.template).toContain(`\\end{${env}}`);
      }
    }
  });
});

describe('fuzzyMatch', () => {
  it('空查询恒真，子串/子序列命中', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
    expect(fuzzyMatch('sec', 'section')).toBe(true);
    expect(fuzzyMatch('ssec', 'subsection')).toBe(true);
  });

  it('大小写不敏感', () => {
    expect(fuzzyMatch('SEC', 'Section')).toBe(true);
    expect(fuzzyMatch('Fig', 'figure')).toBe(true);
  });

  it('不匹配返回 false', () => {
    expect(fuzzyMatch('secx', 'section')).toBe(false);
    expect(fuzzyMatch('zzz', 'section')).toBe(false);
    expect(fuzzyMatch('子序列顺序不能反', 'a')).toBe(false);
  });
});

describe('latexSnippetCompletions', () => {
  it('按 \word 触发，前缀命中优先', () => {
    const result = latexSnippetCompletions(ctxOf('\\sec'));
    expect(result).not.toBeNull();
    expect(result!.from).toBe(0);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('section');
    expect(labels).toContain('subsection');
    expect(labels).not.toContain('figure');
    expect(labels.indexOf('section')).toBeLessThan(labels.indexOf('subsection'));
  });

  it('单个反斜杠触发全部 snippet', () => {
    const result = latexSnippetCompletions(ctxOf('\\'));
    expect(result!.options.length).toBe(LATEX_SNIPPETS.length);
  });

  it('花括号内不再触发 snippet 补全', () => {
    expect(latexSnippetCompletions(ctxOf('\\cite{sec'))).toBeNull();
  });
});

describe('latexCompletionSource', () => {
  it('\\cite 内补全 citekey，detail 为标题+年份', () => {
    const source = latexCompletionSource({ getCitations: () => CITATIONS });
    const result = run(source, '\\cite{vas');
    expect(result).not.toBeNull();
    expect(result!.from).toBe('\\cite{'.length);
    expect(result!.options.map((o) => o.label)).toEqual(['vaswani2017']);
    expect(result!.options[0]!.detail).toBe('Attention Is All You Need (2017)');
  });

  it('多 key 参数中按最后一个 key 过滤', () => {
    const source = latexCompletionSource({ getCitations: () => CITATIONS });
    const result = run(source, '\\cite{vaswani2017, de');
    expect(result!.from).toBe('\\cite{vaswani2017, '.length);
    expect(result!.options.map((o) => o.label)).toEqual(['devlin2019']);
  });

  it('无年份条目 detail 不带尾随空括号', () => {
    const source = latexCompletionSource({ getCitations: () => CITATIONS });
    const result = run(source, '\\citep{noy');
    expect(result!.options[0]!.detail).toBe('某无年份条目');
  });

  it('空查询列出全部条目', () => {
    const source = latexCompletionSource({ getCitations: () => CITATIONS });
    const result = run(source, '\\cite{');
    expect(result!.options.map((o) => o.label)).toEqual([
      'vaswani2017',
      'devlin2019',
      'noyear2020',
    ]);
  });

  it('\\ref 内补全来自文档的 label', () => {
    const doc = '\\label{eq:loss}\n见 \\ref{eq:l';
    const result = run(latexCompletionSource(), doc);
    expect(result).not.toBeNull();
    expect(result!.options.map((o) => o.label)).toEqual(['eq:loss']);
    expect(result!.options[0]!.detail).toContain('第 1 行');
  });

  it('\\ref 不触发引用补全，只出 label 候选', () => {
    const doc = '\\label{a}\n\\ref{';
    const withCites = latexCompletionSource({ getCitations: () => CITATIONS });
    const result = run(withCites, doc);
    expect(result!.options.map((o) => o.label)).toEqual(['a']);
  });

  it('注释中的 label 不进入 \\ref 候选', () => {
    const doc = '% \\label{ghost}\n\\autoref{';
    const result = run(latexCompletionSource(), doc);
    expect(result!.options).toEqual([]);
  });
});

describe('latexSupport', () => {
  it('返回非空扩展数组，可装配进 EditorState', () => {
    const exts = latexSupport({ getCitations: () => CITATIONS });
    expect(exts.length).toBeGreaterThan(0);
    expect(() =>
      EditorState.create({ doc: '\\section{t}', extensions: latexSupport() }),
    ).not.toThrow();
  });
});
