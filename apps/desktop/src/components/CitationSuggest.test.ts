// @vitest-environment jsdom
/**
 * 智能引用推荐纯函数测试（v1.7.0 ②）：dedupeSuggestions——
 * 同 citekey 去重（取最高分）、标题/作者/年份投影、相关度降序、上限 5。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { dedupeSuggestions, type SuggestedPaper } from './CitationSuggest';
import { useLibraryStore } from '../state/libraryStore';
import type { CitedRetrievedChunk } from '../state/libraryStore';
import type { Paper } from '@lemma/shared';

beforeEach(() => {
  useLibraryStore.setState({
    papers: [
      { id: 'p1', citekey: 'vaswani2017', title: 'Attention Is All You Need', authors: [{ family: 'Vaswani' }, { family: 'Shazeer' }], year: 2017, tags: [], collections: [], readStatus: 'done', addedAt: 1 } as Paper,
      { id: 'p2', citekey: 'ho2020', title: 'Denoising Diffusion', authors: [{ family: 'Ho' }], year: 2020, tags: [], collections: [], readStatus: 'to-read', addedAt: 2 } as Paper,
    ],
  });
});

function chunk(citekey: string, score: number, text = 'relevant snippet about attention'): CitedRetrievedChunk {
  return {
    id: `c-${citekey}-${score}`,
    paperId: citekey,
    text,
    citekey,
    score,
  } as CitedRetrievedChunk;
}

describe('dedupeSuggestions', () => {
  it('同 citekey 去重取最高分；按分数降序', () => {
    const out = dedupeSuggestions([
      chunk('vaswani2017', 0.5),
      chunk('ho2020', 0.8),
      chunk('vaswani2017', 0.7), // 更高分应覆盖
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.citekey).toBe('ho2020');
    expect(out[0]!.score).toBe(0.8);
    expect(out[1]!.score).toBe(0.7);
  });

  it('文献卡字段投影（标题/首作者 et al./年份/片段）', () => {
    const out = dedupeSuggestions([chunk('vaswani2017', 0.9)]);
    expect(out[0]).toMatchObject({
      citekey: 'vaswani2017',
      title: 'Attention Is All You Need',
      firstAuthor: 'Vaswani et al.',
      year: '2017',
    });
    expect(out[0]!.snippet).toContain('attention');
  });

  it('无 citekey 或库里无此键的 chunk 跳过', () => {
    const out = dedupeSuggestions([
      { ...chunk('ghost', 0.9), citekey: undefined },
      chunk('unknown-key', 0.8),
    ]);
    expect(out).toHaveLength(0);
  });

  it('超过 5 篇截断', () => {
    const many: CitedRetrievedChunk[] = [];
    for (let i = 0; i < 8; i++) {
      many.push(chunk(`key${i}`, 0.1 + i * 0.1));
    }
    // 补库
    const lib = useLibraryStore.getState().papers;
    for (let i = 0; i < 8; i++) {
      lib.push({ id: `x${i}`, citekey: `key${i}`, title: `T${i}`, authors: [{ family: `A${i}` }], tags: [], collections: [], readStatus: 'to-read', addedAt: i } as Paper);
    }
    useLibraryStore.setState({ papers: lib });
    expect(dedupeSuggestions(many)).toHaveLength(5);
  });
});
