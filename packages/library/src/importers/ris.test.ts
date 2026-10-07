import { describe, expect, it } from 'vitest';
import { parseRis } from './ris';

const RIS = `TY  - CONF
TI  - Attention Is All You Need
AU  - Vaswani, Ashish
AF  - Noam Shazeer
PY  - 2017
JO  - NIPS
T2  - Advances in Neural Information Processing Systems
DO  - 10.5555/3294771.3294856
ID  - vaswani2017attention
AB  - The dominant sequence transduction models.
KW  - transformer; attention
ER  - 

TY  - JOUR
TI  - Weird Year Paper
PY  - not-a-year
ER  - 

TY  - JOUR
AU  - Nobody Inparticular
ER  - 
`;

describe('parseRis', () => {
  const { papers, errors } = parseRis(RIS);

  it('正常记录映射为 Paper', () => {
    expect(papers).toHaveLength(2);
    const paper = papers[0]!;
    expect(paper.title).toBe('Attention Is All You Need');
    expect(paper.citekey).toBe('vaswani2017attention');
    expect(paper.year).toBe(2017);
    expect(paper.doi).toBe('10.5555/3294771.3294856');
    expect(paper.venue?.type).toBe('conference');
    expect(paper.venue?.name).toBe('NIPS'); // JO 优先于 T2
    expect(paper.abstract).toBe('The dominant sequence transduction models.');
    expect(paper.tags).toEqual(['transformer', 'attention']);
    expect(paper.readStatus).toBe('to-read');
  });

  it('AU（逗号式）与 AF（全名式）作者都被解析', () => {
    expect(papers[0]!.authors).toEqual([
      { family: 'Vaswani', given: 'Ashish' },
      { family: 'Shazeer', given: 'Noam' },
    ]);
  });

  it('缺少 TI 的记录进 errors；非法年份降级为 undefined', () => {
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('TI');
    expect(papers[1]!.year).toBeUndefined();
  });

  it('文件结束时未闭合的记录也会被收尾', () => {
    const { papers: flushed } = parseRis('TY  - JOUR\nTI  - Truncated Record\n');
    expect(flushed).toHaveLength(1);
    expect(flushed[0]!.title).toBe('Truncated Record');
  });

  it('缺少 ER 的记录由下一个 TY 收尾，不静默丢条目', () => {
    const { papers: flushed, errors } = parseRis(
      [
        'TY  - JOUR',
        'TI  - First record',
        'ER  - ',
        'TY  - JOUR',
        'TI  - Second record without ER',
        'TY  - JOUR',
        'TI  - Third record',
        'ER  - ',
      ].join('\n'),
    );
    expect(flushed.map(p => p.title)).toEqual([
      'First record',
      'Second record without ER',
      'Third record',
    ]);
    expect(errors).toEqual([]);
  });

  it('无标签续行接在上一个标签之后（长标题/摘要折行不丢内容）', () => {
    const { papers: parsed } = parseRis(
      [
        'TY  - JOUR',
        'TI  - A very long title that continues',
        '      onto the next line',
        'AU  - Smith, John',
        'AB  - First line of abstract.',
        '      Second line of the same abstract.',
        'PY  - 2020',
        'ER  - ',
      ].join('\n'),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe('A very long title that continues onto the next line');
    expect(parsed[0]!.abstract).toBe(
      'First line of abstract. Second line of the same abstract.',
    );
    expect(parsed[0]!.authors).toEqual([{ family: 'Smith', given: 'John' }]);
  });

  it('标签首行为空的字段由续行补齐；ER 之后的散行不进任何字段', () => {
    const { papers: parsed } = parseRis(
      ['TY  - JOUR', 'TI  - ', '      Indented title', 'ER  - ', '      trailing junk'].join('\n'),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.title).toBe('Indented title');
    expect(parsed[0]!.abstract).toBeUndefined();
  });
});
