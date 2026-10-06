/**
 * v6.0.0：PDF 全文搜索纯函数 + 修改对照文档生成器。
 */
import { describe, expect, it } from 'vitest';
import { searchPdfPages } from '@lemma/library';
import { buildChangesTex, escapeLatex } from './changesDoc';

describe('searchPdfPages', () => {
  const pages = [
    { page: 1, text: 'Introduction to the method.' },
    { page: 2, text: 'The METHOD section describes the method.' },
    { page: 3, text: 'Conclusion.' },
  ];

  it('大小写不敏感、跨页命中并带页码', () => {
    const hits = searchPdfPages(pages, 'method');
    expect(hits.map((h) => h.page)).toEqual([1, 2, 2]);
    expect(hits[1]!.snippet.toLowerCase()).toContain('method');
  });

  it('空查询/纯空白 → 无命中', () => {
    expect(searchPdfPages(pages, '')).toEqual([]);
    expect(searchPdfPages(pages, '   ')).toEqual([]);
  });

  it('无命中返回空；摘录带省略号与上下文', () => {
    expect(searchPdfPages(pages, 'nonexistent')).toEqual([]);
    const hits = searchPdfPages(
      [{ page: 9, text: 'x'.repeat(80) + ' keyword ' + 'y'.repeat(80) }],
      'keyword',
    );
    expect(hits[0]!.snippet.startsWith('…')).toBe(true);
    expect(hits[0]!.snippet.endsWith('…')).toBe(true);
    expect(hits[0]!.snippet).toContain('keyword');
  });

  it('命中上限保护', () => {
    const page = { page: 1, text: 'a '.repeat(500) };
    const hits = searchPdfPages([page], 'a', 50);
    expect(hits.length).toBeLessThanOrEqual(50);
  });
});

describe('escapeLatex', () => {
  it('特殊字符全部转义', () => {
    const out = escapeLatex('100% & $x$ {y} _z^w~');
    expect(out).toContain('100\\%');
    expect(out).toContain('\\&');
    expect(out).toContain('\\$');
    expect(out).toContain('\\{y\\}');
    expect(out).toContain('\\_z');
    expect(out).toContain('\\textasciicircum{}w');
    expect(out).toContain('\\textasciitilde{}');
    expect(escapeLatex('\\section')).toContain('\\textbackslash{}');
  });
});

describe('buildChangesTex', () => {
  const DIFF = [
    'diff --git a/main.tex b/main.tex',
    'index 111..222 100644',
    '--- a/main.tex',
    '+++ b/main.tex',
    '@@ -10,2 +10,3 @@',
    ' context line',
    '-old sentence with 50% error',
    '+new sentence & better',
    'diff --git a/refs.bib b/refs.bib',
    '@@ -1,1 +1,2 @@',
    '+@article{new2024,',
  ].join('\n');

  it('解析 diff：文件数/行数统计正确，全文转义', () => {
    const r = buildChangesTex(DIFF, '测试对照');
    expect(r.fileCount).toBe(2);
    expect(r.lineCount).toBe(3);
    expect(r.tex).toContain('\\section*');
    expect(r.tex).toContain('main.tex');
    expect(r.tex).toContain('refs.bib');
    // 特殊字符被转义（不会破坏编译）
    expect(r.tex).toContain('50\\%');
    expect(r.tex).toContain('\\&');
    // 红蓝标注
    expect(r.tex).toContain('\\textcolor{red}');
    expect(r.tex).toContain('\\textcolor{blue}');
    // 上下文行不输出
    expect(r.tex).not.toContain('context line');
  });

  it('空 diff → 「没有变更」', () => {
    const r = buildChangesTex('', '空');
    expect(r.fileCount).toBe(0);
    expect(r.tex).toContain('没有变更');
  });

  it('包含 ulem（删除线）与 xcolor 宏包', () => {
    const r = buildChangesTex(DIFF);
    expect(r.tex).toContain('{ulem}');
    expect(r.tex).toContain('{xcolor}');
  });
});
