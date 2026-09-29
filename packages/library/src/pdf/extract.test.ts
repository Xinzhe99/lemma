import { describe, expect, it } from 'vitest';
import { extractSections } from './extract';

describe('extractSections', () => {
  it('阿拉伯数字编号风格："1 Introduction" / "2.1 Ablations"，并跨页记录 pageStart', () => {
    const sections = extractSections([
      {
        page: 1,
        text: [
          'Some Paper Title',
          'The Authors',
          '',
          'Abstract',
          'We propose a new model.',
          '',
          '1 Introduction',
          'Deep learning is popular.',
          '',
          '2 Method',
          'We use convolutions.',
          '',
          '2.1 Ablations',
          'We ablate layers.',
        ].join('\n'),
      },
      {
        page: 2,
        text: ['3 Results', 'Numbers go up.', '', 'References', '[1] Some reference.'].join('\n'),
      },
    ]);

    expect(sections.map(s => s.heading)).toEqual([
      'Abstract',
      'Introduction',
      'Method',
      'Ablations',
      'Results',
      'References',
    ]);
    expect(sections.map(s => s.level)).toEqual([1, 1, 1, 2, 1, 1]);
    expect(sections[0]!.text).toBe('We propose a new model.');
    expect(sections.find(s => s.heading === 'Results')?.pageStart).toBe(2);
    expect(sections.every(s => s.id && s.text.length > 0)).toBe(true);
  });

  it('IEEE 风格："Abstract—正文…" 与 "I. INTRODUCTION" 罗马数字全大写标题', () => {
    const sections = extractSections([
      {
        page: 1,
        text: [
          'Abstract—Avoiding the mistakes of the past.',
          'I. INTRODUCTION',
          'Deep nets work well.',
          'II. RELATED WORK',
          'Much has been done.',
          'III. METHOD',
          'We propose X.',
        ].join('\n'),
      },
    ]);

    expect(sections.map(s => s.heading)).toEqual(['Abstract', 'INTRODUCTION', 'RELATED WORK', 'METHOD']);
    expect(sections[0]!.text).toBe('Avoiding the mistakes of the past.');
    expect(sections.every(s => s.level === 1)).toBe(true);
    expect(sections[1]!.text).toBe('Deep nets work well.');
  });

  it('无任何标题匹配时按页分块兜底', () => {
    const sections = extractSections([
      { page: 1, text: 'no headings here\njust body text' },
      { page: 2, text: 'more body\nstill body' },
    ]);
    expect(sections.map(s => s.heading)).toEqual(['第 1 页', '第 2 页']);
    expect(sections.map(s => s.pageStart)).toEqual([1, 2]);
    expect(sections[0]!.text).toBe('no headings here\njust body text');
  });

  it('重复出现的同名全大写行（页眉）不会拆分正文', () => {
    const sections = extractSections([
      {
        page: 1,
        text: 'PROCEEDINGS OF CVPR 2024\n1 Introduction\nBody one.',
      },
      {
        page: 2,
        text: 'PROCEEDINGS OF CVPR 2024\nBody one continues on the next page.',
      },
      {
        page: 3,
        text: '2 Method\nBody two.',
      },
    ]);
    expect(sections.map(s => s.heading)).toEqual(['Introduction', 'Method']);
    expect(sections[0]!.text).toBe('Body one.\nBody one continues on the next page.');
  });

  it('空输入返回空数组', () => {
    expect(extractSections([])).toEqual([]);
    expect(extractSections([{ page: 1, text: '   \n  ' }])).toEqual([]);
  });
});
