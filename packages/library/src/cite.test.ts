import { describe, expect, it } from 'vitest';
import type { Paper, PaperAuthor } from '@lemma/shared';
import { CITATION_STYLES, formatCitation, parseCitationSegments } from './cite';

function authors(n: number): PaperAuthor[] {
  return Array.from({ length: n }, (_, i) => ({ family: `Family${i + 1}`, given: `Given M${i + 1}` }));
}

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'vaswani2017attention',
    title: 'Attention Is All You Need',
    authors: [
      { family: 'Vaswani', given: 'Ashish' },
      { family: 'Shazeer', given: 'Noam' },
      { family: 'Parmar', given: 'Niki' },
    ],
    year: 2017,
    venue: { type: 'conference', name: 'NeurIPS' },
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 0,
    ...overrides,
  };
}

describe('formatCitation 作者截断 et al. 规则', () => {
  it('≤6 位作者三种样式全部列出（连接词不同）', () => {
    const paper = makePaper({ authors: authors(6) });
    const ieee = formatCitation(paper, 'IEEE');
    const apa = formatCitation(paper, 'APA');
    const ama = formatCitation(paper, 'AMA');
    expect(ieee).toContain('G. M. Family1');
    expect(ieee).toContain('and G. M. Family6');
    expect(ieee).not.toContain('et al.');
    expect(apa).toContain('Family1, G. M.');
    expect(apa).toContain('& Family6, G. M.');
    expect(apa).not.toContain('et al.');
    expect(ama).toContain('Family1 GM');
    expect(ama).toContain('Family6 GM');
    expect(ama).not.toContain('et al.');
  });

  it('IEEE >6 位只列第 1 位 + et al.', () => {
    const paper = makePaper({ authors: authors(7) });
    const out = formatCitation(paper, 'IEEE');
    expect(out).toContain('G. M. Family1 et al.');
    expect(out).not.toContain('Family2');
  });

  it('AMA >6 位列前 3 位 + et al.（缩写连写不带点）', () => {
    const paper = makePaper({ authors: authors(7) });
    const out = formatCitation(paper, 'AMA');
    expect(out).toContain('Family1 GM, Family2 GM, Family3 GM, et al.');
    expect(out).not.toContain('Family4');
  });

  it('APA ≤20 位全部列出，>20 位前 19 位 + ... + 末位', () => {
    const twenty = formatCitation(makePaper({ authors: authors(20) }), 'APA');
    expect(twenty).toContain('& Family20, G. M.');
    expect(twenty).not.toContain('...');

    const twentyOne = formatCitation(makePaper({ authors: authors(21) }), 'APA');
    expect(twentyOne).toContain('Family19, G. M., ... Family21, G. M.');
    expect(twentyOne).not.toContain('Family20');
    expect(twentyOne).not.toContain('& Family21');
  });

  it('无 given 名时退化为纯 family', () => {
    const paper = makePaper({ authors: [{ family: 'OpenAI' }] });
    expect(formatCitation(paper, 'IEEE')).toContain('OpenAI, "Attention Is All You Need,"');
    expect(formatCitation(paper, 'APA')).toContain('OpenAI (2017). Attention');
    expect(formatCitation(paper, 'AMA')).toContain('OpenAI. Attention');
  });
});

describe('formatCitation 期刊斜体与年份位置差异', () => {
  const journalPaper = makePaper({
    authors: [{ family: 'Doe', given: 'Jane' }],
    venue: { type: 'journal', name: 'Nature Physics', volume: '17', issue: '2', pages: '123-145' },
    year: 2021,
    doi: '10.1234/abc.2021.567',
  });

  it('IEEE：标题加引号、期刊名斜体、年份在末尾', () => {
    const out = formatCitation(journalPaper, 'IEEE');
    expect(out).toBe('J. Doe, "Attention Is All You Need," *Nature Physics*, vol. 17, no. 2, pp. 123-145, 2021.');
    expect(out.endsWith('2021.')).toBe(true);
  });

  it('APA：年份紧跟作者括注、期刊名+卷号一起斜体（期号不斜体）', () => {
    const out = formatCitation(journalPaper, 'APA');
    expect(out.startsWith('Doe, J. (2021). Attention Is All You Need.')).toBe(true);
    expect(out).toContain('*Nature Physics, 17*(2), 123-145.');
    expect(out).toContain('https://doi.org/10.1234/abc.2021.567.');
  });

  it('AMA：仅期刊名斜体、卷(期):页码; 年份', () => {
    const out = formatCitation(journalPaper, 'AMA');
    expect(out.startsWith('Doe J. Attention Is All You Need. *Nature Physics*.')).toBe(true);
    expect(out).toContain('17(2):123-145; 2021.');
    expect(out).toContain('doi:10.1234/abc.2021.567.');
    expect(out).not.toContain('*Nature Physics, 17');
  });

  it('会议与预印本：会议名斜体；arXiv 预印本按 *arXiv* 呈现', () => {
    expect(formatCitation(makePaper(), 'IEEE')).toContain('in *NeurIPS*, 2017.');
    const preprint = makePaper({
      venue: undefined,
      arxivId: '2303.08774',
      year: 2023,
    });
    expect(formatCitation(preprint, 'IEEE')).toContain('arXiv:2303.08774, 2023.');
    expect(formatCitation(preprint, 'APA')).toContain('*arXiv*');
    expect(formatCitation(preprint, 'AMA')).toContain('*arXiv*; 2023.');
  });

  it('缺年份：APA 用 (n.d.)，IEEE/AMA 省略年份', () => {
    const noYear = makePaper({ year: undefined });
    expect(formatCitation(noYear, 'APA')).toContain('(n.d.).');
    expect(formatCitation(noYear, 'IEEE')).not.toContain('n.d.');
    expect(formatCitation(noYear, 'IEEE').endsWith('in *NeurIPS*.')).toBe(true);
    expect(formatCitation(noYear, 'AMA')).not.toContain('n.d.');
  });

  it('三种样式输出互不相同（切换可见文本变化）', () => {
    const outs = CITATION_STYLES.map((s) => formatCitation(journalPaper, s));
    expect(new Set(outs).size).toBe(3);
  });
});

describe('parseCitationSegments', () => {
  it('按 *…* 标记拆分斜体段', () => {
    const segs = parseCitationSegments('A. Doe, "T," *Journal*, 2020.');
    expect(segs).toEqual([
      { text: 'A. Doe, "T," ', italic: false },
      { text: 'Journal', italic: true },
      { text: ', 2020.', italic: false },
    ]);
  });

  it('无标记/未配对星号按普通文本返回', () => {
    expect(parseCitationSegments('Plain text')).toEqual([{ text: 'Plain text', italic: false }]);
    expect(parseCitationSegments('a * b')).toEqual([{ text: 'a * b', italic: false }]);
  });
});
