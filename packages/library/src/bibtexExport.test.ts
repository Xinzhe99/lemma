import { describe, expect, it } from 'vitest';
import type { Paper } from '@lemma/shared';
import { parseBibtex } from './importers/bibtex';
import { toBibtex } from './bibtexExport';

/**
 * toBibtex（v2.6.0 导出路径，命令面板「导出引用文献」用）：
 * 条目选型 / 场所字段 / 转义 / citedKeys 过滤 / 往返可解析。
 */

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'vaswani2017',
    title: 'Attention Is All You Need',
    authors: [{ family: 'Vaswani', given: 'Ashish' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 0,
    ...overrides,
  };
}

describe('toBibtex：条目选型与场所字段', () => {
  it('journal → @article（journal/volume/number/pages）；会议 → @inproceedings（booktitle）', () => {
    const bib = toBibtex([
      makePaper({
        year: 2017,
        venue: { type: 'journal', name: 'Neural Networks', volume: '138', issue: '2', pages: '1--11' },
      }),
      makePaper({
        citekey: 'he2016',
        venue: { type: 'conference', name: 'CVPR' },
      }),
    ]);
    expect(bib).toContain('@article{vaswani2017,');
    expect(bib).toContain('  journal = {Neural Networks},');
    expect(bib).toContain('  volume = {138},');
    expect(bib).toContain('  number = {2},');
    expect(bib).toMatch(/ {2}pages = \{1--11\},?/);
    expect(bib).toContain('@inproceedings{he2016,');
    expect(bib).toMatch(/ {2}booktitle = \{CVPR\},?/);
  });

  it('book → @book 用 publisher，thesis → @phdthesis 用 school（场所名不丢）', () => {
    const book = toBibtex([
      makePaper({ venue: { type: 'book', name: 'Cambridge University Press' } }),
    ]);
    expect(book).toContain('@book{vaswani2017,');
    expect(book).toMatch(/ {2}publisher = \{Cambridge University Press\},?/);
    const thesis = toBibtex([makePaper({ venue: { type: 'thesis', name: 'MIT' } })]);
    expect(thesis).toContain('@phdthesis{vaswani2017,');
    expect(thesis).toMatch(/ {2}school = \{MIT\},?/);
  });

  it('author/keywords 中的 & % # _ 转义（作者名不转义会让 LaTeX 报错）', () => {
    const bib = toBibtex([
      makePaper({
        authors: [{ family: 'Smith & Jones', given: 'A.' }],
        tags: ['R&D', 'C#'],
      }),
    ]);
    expect(bib).toContain('  author = {Smith \\& Jones, A.},');
    expect(bib).toMatch(/ {2}keywords = \{R\\&D, C\\#\},?/);
  });

  it('某条目大括号不平衡时其余条目仍可完整往返（不吞条目）', () => {
    const bib = toBibtex([
      makePaper({ citekey: 'bad', title: 'Deep {Learning' }),
      makePaper({ citekey: 'good', title: 'Second Paper', year: 2020 }),
    ]);
    const roundTrip = parseBibtex(bib);
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.papers.map((p) => p.citekey)).toEqual(['bad', 'good']);
    expect(roundTrip.papers[0]!.title).toBe('Deep Learning');
    expect(roundTrip.papers[1]!.title).toBe('Second Paper');
  });
});

describe('toBibtex：citedKeys 过滤与整体输出', () => {
  it('传入非空 citedKeys 时只导出被引条目', () => {
    const papers = [makePaper({ citekey: 'k1' }), makePaper({ citekey: 'k2', title: 'T2' })];
    const bib = toBibtex(papers, { citedKeys: new Set(['k2']) });
    expect(bib).toContain('@article{k2,');
    expect(bib).not.toContain('@article{k1,');
    expect(bib).toContain('1 entries');
  });

  it('空文献列表输出仅含注释头（无条目）', () => {
    const bib = toBibtex([]);
    expect(bib).toContain('0 entries');
    expect(bib).not.toContain('@');
  });
});
