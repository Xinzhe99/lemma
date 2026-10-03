import { describe, expect, it } from 'vitest';
import type { Annotation, Paper, Venue } from '@lemma/shared';
import { parseBibtex } from './importers/bibtex';
import { annotationsToMarkdown, escapeBibtex, papersToBibtex, paperToBibtex } from './export';

function makePaper(overrides: Partial<Paper>): Paper {
  return {
    id: 'p1',
    citekey: 'vaswani2017',
    title: 'Attention Is All You Need',
    authors: [],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 0,
    ...overrides,
  };
}

const venue = (type: Venue['type'], name?: string, extra: Partial<Venue> = {}): Venue => ({
  type,
  name,
  ...extra,
});

describe('escapeBibtex', () => {
  it('转义 & % # _ 四类特殊字符', () => {
    expect(escapeBibtex('AT&T 100% C# snake_case')).toBe('AT\\&T 100\\% C\\# snake\\_case');
  });

  it('无特殊字符时原样返回', () => {
    expect(escapeBibtex('plain title')).toBe('plain title');
  });
});

describe('papersToBibtex：条目选型', () => {
  it('journal → @article，journal/volume/number/pages 字段齐全', () => {
    const bib = paperToBibtex(
      makePaper({
        authors: [
          { family: 'Vaswani', given: 'Ashish' },
          { family: 'Shazeer', given: 'Noam' },
        ],
        year: 2017,
        venue: venue('journal', 'Neural Networks', { volume: '138', issue: '2', pages: '1--11' }),
        doi: '10.5555/1',
      }),
    );
    expect(bib).toMatch(/^@article\{vaswani2017,/);
    expect(bib).toContain('  author = {Vaswani, Ashish and Shazeer, Noam},');
    expect(bib).toContain('  title = {Attention Is All You Need},');
    expect(bib).toContain('  year = {2017},');
    expect(bib).toContain('  journal = {Neural Networks},');
    expect(bib).toContain('  volume = {138},');
    expect(bib).toContain('  number = {2},');
    expect(bib).toContain('  pages = {1--11},');
    expect(bib).toContain('  doi = {10.5555/1},');
  });

  it('conference/workshop → @inproceedings 用 booktitle', () => {
    const conf = paperToBibtex(makePaper({ venue: venue('conference', 'NeurIPS 2023') }));
    const ws = paperToBibtex(makePaper({ venue: venue('workshop', 'WoRMS') }));
    expect(conf).toMatch(/^@inproceedings\{/);
    expect(conf).toContain('  booktitle = {NeurIPS 2023},');
    expect(ws).toMatch(/^@inproceedings\{/);
  });

  it('preprint/unknown → @misc；arxivId 产出 eprint + archivePrefix', () => {
    const bib = paperToBibtex(
      makePaper({
        citekey: 'devlin2019',
        venue: venue('preprint'),
        arxivId: '1810.04805',
      }),
    );
    expect(bib).toMatch(/^@misc\{devlin2019,/);
    expect(bib).toContain('  eprint = {1810.04805},');
    expect(bib).toContain('  archivePrefix = {arXiv},');
    expect(bib).not.toContain('journal');
  });

  it('thesis → @phdthesis（school）、book → @book（publisher）', () => {
    const thesis = paperToBibtex(makePaper({ venue: venue('thesis', 'MIT') }));
    expect(thesis).toMatch(/^@phdthesis\{/);
    expect(thesis).toContain('  school = {MIT},');
    const book = paperToBibtex(makePaper({ venue: venue('book', 'Cambridge University Press') }));
    expect(book).toMatch(/^@book\{/);
    expect(book).toContain('  publisher = {Cambridge University Press},');
  });
});

describe('papersToBibtex：作者与转义', () => {
  it('作者按 "Family, Given and ..." 拼接；无 given 只写 Family', () => {
    const bib = paperToBibtex(
      makePaper({
        authors: [{ family: 'Vaswani', given: 'Ashish' }, { family: 'OpenAI' }],
      }),
    );
    expect(bib).toContain('author = {Vaswani, Ashish and OpenAI},');
  });

  it('title/venue/作者中的 & % # _ 被转义', () => {
    const bib = paperToBibtex(
      makePaper({
        authors: [{ family: 'O&Brian', given: 'Pat_100%' }],
        title: 'Q&A: 50% Off #1_Method',
        venue: venue('journal', 'J. of R&D #2_notes'),
      }),
    );
    expect(bib).toContain('title = {Q\\&A: 50\\% Off \\#1\\_Method},');
    expect(bib).toContain('journal = {J. of R\\&D \\#2\\_notes},');
    expect(bib).toContain('author = {O\\&Brian, Pat\\_100\\%},');
  });
});

describe('papersToBibtex：整体输出', () => {
  it('空库返回空字符串', () => {
    expect(papersToBibtex([])).toBe('');
  });

  it('多条目以空行分隔，文件以单个换行结尾；条目可被 parseBibtex 往返解析', () => {
    const papers = [
      makePaper({
        authors: [{ family: 'Vaswani', given: 'Ashish' }],
        year: 2017,
        venue: venue('journal', 'Nature'),
      }),
      makePaper({
        id: 'p2',
        citekey: 'brown2020',
        title: 'Language Models are Few-Shot Learners',
        authors: [{ family: 'Brown', given: 'Tom B.' }],
        year: 2020,
        venue: venue('conference', 'NeurIPS'),
      }),
    ];
    const bib = papersToBibtex(papers);
    expect(bib.endsWith('\n')).toBe(true);
    expect(bib.match(/\n\n/g)).toHaveLength(1); // 恰一个条目间空行
    const roundTrip = parseBibtex(bib);
    expect(roundTrip.errors).toEqual([]);
    expect(roundTrip.papers.map((p) => p.citekey)).toEqual(['vaswani2017', 'brown2020']);
    expect(roundTrip.papers[0]!.title).toBe('Attention Is All You Need');
    expect(roundTrip.papers[0]!.authors[0]).toEqual({ family: 'Vaswani', given: 'Ashish' });
    expect(roundTrip.papers[0]!.venue?.name).toBe('Nature');
    expect(roundTrip.papers[0]!.year).toBe(2017);
    expect(roundTrip.papers[1]!.venue?.type).toBe('conference');
  });

  it('缺 venue/year 的最小条目仍生成合法 BibTeX；citekey 为空时回退 id', () => {
    const bib = paperToBibtex(makePaper({ citekey: '', id: 'fallback-id' }));
    expect(bib).toMatch(/^@misc\{fallback-id,/);
    expect(bib).toContain('title = {Attention Is All You Need},');
  });
});

describe('annotationsToMarkdown', () => {
  const ann = (overrides: Partial<Annotation>): Annotation => ({
    id: 'a1',
    paperId: 'p1',
    page: 1,
    kind: 'highlight',
    createdAt: 0,
    ...overrides,
  });

  it('空列表返回空字符串', () => {
    expect(annotationsToMarkdown([])).toBe('');
  });

  it('按页码升序分组（## 第 N 页），乱序输入自动归组', () => {
    const md = annotationsToMarkdown([
      ann({ id: 'a2', page: 3, text: '第三页批注' }),
      ann({ id: 'a1', page: 1, quotedText: '第一页原文' }),
      ann({ id: 'a3', page: 3, text: '第三页第二条' }),
    ]);
    const headIndex = (h: string) => md.indexOf(h);
    expect(md.startsWith('# ') || md.includes('\n# ')).toBe(false); // 未传 paperTitle 不有一级标题
    expect(headIndex('## 第 1 页')).toBeLessThan(md.indexOf('第一页原文'));
    expect(headIndex('## 第 3 页')).toBeLessThan(md.indexOf('第三页批注'));
    expect(md.indexOf('第三页批注')).toBeLessThan(md.indexOf('第三页第二条'));
    expect(md.match(/## 第 3 页/g)).toHaveLength(1); // 同页只出现一个分组标题
  });

  it('语义色标签与备注输出；引文为块引用（多行 > 前缀）', () => {
    const md = annotationsToMarkdown([
      ann({
        page: 2,
        semantic: 'method',
        quotedText: '第一行\n第二行',
        text: '这里是备注',
      }),
    ]);
    expect(md).toContain('## 第 2 页');
    expect(md).toContain('> 第一行\n> 第二行');
    expect(md).toContain('- 语义：方法');
    expect(md).toContain('- 备注：这里是备注');
  });

  it('四种语义标签齐全；纯批注（无引文）也能输出', () => {
    const md = annotationsToMarkdown([
      ann({ page: 1, semantic: 'finding' }),
      ann({ page: 1, semantic: 'question' }),
      ann({ page: 1, semantic: 'citation' }),
      ann({ page: 2, kind: 'note', text: '批注正文' }),
      ann({ page: 2, kind: 'area' }),
    ]);
    for (const label of ['语义：发现', '语义：质疑', '语义：引用', '备注：批注正文']) {
      expect(md).toContain(label);
    }
    expect(md).toContain('（第 2 页的区域标注）'); // 无引文无备注无语义的兜底
  });

  it('paperTitle 输出一级标题；多行备注折叠为单行', () => {
    const md = annotationsToMarkdown([ann({ page: 1, text: 'a\n\nb' })], '深度学习综述');
    expect(md.startsWith('# 深度学习综述\n')).toBe(true);
    expect(md).toContain('- 备注：a b');
    expect(md.endsWith('\n')).toBe(true);
  });
});
