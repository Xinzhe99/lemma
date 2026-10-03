import { describe, expect, it } from 'vitest';
import type { Paper } from '@lemma/shared';
import { applyFilter, parseFilter } from './filter';

const papers: Paper[] = [
  {
    id: 'p1',
    citekey: 'p1',
    title: 'Diffusion Models for Image Synthesis',
    abstract: 'We study diffusion processes for generation.',
    authors: [{ family: 'Ho', given: 'Jonathan' }],
    year: 2024,
    venue: { type: 'conference', name: 'CVPR 2024' },
    tags: ['generative'],
    collections: [],
    readStatus: 'to-read',
    rating: 5,
    addedAt: 1,
  },
  {
    id: 'p2',
    citekey: 'p2',
    title: 'Adam: A Method for Stochastic Optimization',
    abstract: 'An adaptive optimizer.',
    authors: [{ family: 'Kingma', given: 'Diederik' }],
    year: 2015,
    venue: { type: 'conference', name: 'ICLR' },
    tags: ['optimization'],
    collections: [],
    readStatus: 'done',
    rating: 3,
    addedAt: 2,
  },
  {
    id: 'p3',
    citekey: 'p3',
    title: '正在读的中文综述',
    abstract: '关于注意力机制。',
    authors: [{ family: '张' }],
    tags: ['survey'],
    collections: [],
    readStatus: 'reading',
    addedAt: 3,
  },
];

const ids = (result: Paper[]): string[] => result.map(p => p.id);

describe('parseFilter', () => {
  it('解析年份比较与区间', () => {
    expect(parseFilter('year:>2023').nodes).toEqual([{ type: 'year', op: '>', value: 2023 }]);
    expect(parseFilter('year:>=2020').nodes).toEqual([{ type: 'year', op: '>=', value: 2020 }]);
    expect(parseFilter('year:2023').nodes).toEqual([{ type: 'year', op: '=', value: 2023 }]);
    expect(parseFilter('year:2020-2024').nodes).toEqual([
      { type: 'yearRange', from: 2020, to: 2024 },
    ]);
  });

  it('解析 venue/status/tag/rating 与短语、裸词', () => {
    const { nodes } = parseFilter('venue:CVPR status:unread tag:generative rating:>=4 "diffusion model" attention');
    expect(nodes.map(n => n.type)).toEqual([
      'venue',
      'status',
      'tag',
      'rating',
      'phrase',
      'keyword',
    ]);
    expect(nodes[2]).toEqual({ type: 'tag', value: 'generative' });
    expect(nodes[3]).toEqual({ type: 'rating', op: '>=', value: 4 });
    expect(nodes[4]).toEqual({ type: 'phrase', value: 'diffusion model' });
    expect(nodes[5]).toEqual({ type: 'keyword', value: 'attention' });
  });

  it('语法错误宽松降级为 invalid', () => {
    const { nodes } = parseFilter('year:abc rating:x status:bogus venue: tag: "');
    expect(nodes.every(n => n.type === 'invalid')).toBe(true);
  });
});

describe('applyFilter', () => {
  it('年份过滤：比较与区间', () => {
    expect(ids(applyFilter(papers, 'year:>2023'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'year:2015'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'year:2010-2020'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'year:2020-2024'))).toEqual(['p1']);
  });

  it('venue 子串（忽略大小写）', () => {
    expect(ids(applyFilter(papers, 'venue:cvpr'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'venue:LR'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'venue:NeurIPS'))).toEqual([]);
  });

  it('阅读状态（unread/reading/done）', () => {
    expect(ids(applyFilter(papers, 'status:unread'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'status:reading'))).toEqual(['p3']);
    expect(ids(applyFilter(papers, 'status:done'))).toEqual(['p2']);
  });

  it('标签与评分', () => {
    expect(ids(applyFilter(papers, 'tag:generative'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'tag:GENERATIVE'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'rating:>=4'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'rating:<5'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'rating:>1'))).toEqual(['p1', 'p2']);
  });

  it('带引号短语匹配 title/abstract', () => {
    expect(ids(applyFilter(papers, '"diffusion model"'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, '"for generation"'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, '"not exist phrase"'))).toEqual([]);
  });

  it('裸词关键词 AND（覆盖标题、作者、场所、标签）', () => {
    expect(ids(applyFilter(papers, 'kingma'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'iclr'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'optimization'))).toEqual(['p2']);
    expect(ids(applyFilter(papers, 'diffusion cvpr'))).toEqual(['p1']);
    expect(ids(applyFilter(papers, 'diffusion attention'))).toEqual([]);
  });

  it('坏词被忽略，不产生过滤效果', () => {
    expect(ids(applyFilter(papers, 'year:abc'))).toEqual(['p1', 'p2', 'p3']);
    expect(ids(applyFilter(papers, 'year:abc diffusion'))).toEqual(['p1']);
  });

  it('空查询返回全部', () => {
    expect(applyFilter(papers, '')).toHaveLength(3);
    expect(applyFilter(papers, '   ')).toHaveLength(3);
  });
});
