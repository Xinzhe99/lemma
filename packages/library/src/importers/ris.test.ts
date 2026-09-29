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
});
