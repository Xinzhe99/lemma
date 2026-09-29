import { describe, expect, it } from 'vitest';
import { buildBm25, tokenize } from './bm25';

describe('tokenize', () => {
  it('小写化 + 连续拉丁词 + 汉字单字', () => {
    expect(tokenize('Hello WORLD')).toEqual(['hello', 'world']);
    expect(tokenize('深度学习 Attention 机制')).toEqual(['深', '度', '学', '习', 'attention', '机', '制']);
    expect(tokenize('BERT-2018, v2!')).toEqual(['bert', '2018', 'v2']);
    expect(tokenize('')).toEqual([]);
  });
});

describe('buildBm25', () => {
  const index = buildBm25([
    {
      id: 'attention-paper',
      text: 'Attention mechanisms in neural networks transformer self-attention deep learning 深度学习 注意力机制',
    },
    {
      id: 'gardening',
      text: 'Gardening tips for growing roses in spring seasonal flower care and watering schedule',
    },
    {
      id: 'transformer-paper',
      text: 'The transformer architecture relies on attention. Attention is all you need.',
    },
  ]);

  it('相关文档得分排序，无关文档不出现', () => {
    const results = index.search('attention transformer');
    const ids = results.map(r => r.id);
    expect(ids).toContain('attention-paper');
    expect(ids).toContain('transformer-paper');
    expect(ids).not.toContain('gardening');
    // transformer 一词只出现在两篇论文中，IDF 高；两篇均应得正分
    expect(results[0]!.score).toBeGreaterThan(results[results.length - 1]!.score);
  });

  it('中文按单字命中', () => {
    const results = index.search('注意力');
    expect(results.map(r => r.id)).toEqual(['attention-paper']);
    expect(results[0]!.score).toBeGreaterThan(0);
  });

  it('topK 截断与空查询', () => {
    expect(index.search('attention', 2)).toHaveLength(2);
    expect(index.search('')).toEqual([]);
    expect(index.search('zoo aquarium')).toEqual([]);
  });

  it('词频与文档长度影响得分（TF 高者排名靠前）', () => {
    const tfIndex = buildBm25([
      { id: 'once', text: 'quantum computing intro' },
      { id: 'thrice', text: 'quantum quantum quantum computing applied survey' },
    ]);
    const results = tfIndex.search('quantum');
    expect(results[0]!.id).toBe('thrice');
  });
});
