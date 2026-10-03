import { describe, expect, it } from 'vitest';
import type { TextChunk } from '@lemma/shared';
import { HashEmbeddingProvider } from './embeddings';
import { cosine, HybridRetriever } from './retriever';

const RELEVANT =
  'The transformer attention mechanism computes scaled dot product attention over the token sequence.';
const IRRELEVANT =
  'Cooking pasta requires boiling water, adding salt, and stirring the sauce for ten minutes.';

function chunk(i: number, text: string): TextChunk {
  return { id: `c${i}`, paperId: `p${i}`, text };
}

async function buildRetriever() {
  const retriever = new HybridRetriever();
  const embedder = new HashEmbeddingProvider();
  const chunks = [chunk(0, IRRELEVANT), chunk(1, RELEVANT), chunk(2, 'Gardening tips for growing tomatoes at home.')];
  const vectors = await embedder.embed(chunks.map((c) => c.text));
  retriever.addChunks(chunks, vectors);
  return { retriever, embedder };
}

describe('cosine', () => {
  it('平行 1、正交 0、相反 -1、零向量 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1, 6);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0, 6);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1, 6);
    expect(cosine([0, 0], [1, 2])).toBe(0);
  });
});

describe('HybridRetriever', () => {
  it('混合检索（向量+文本）top1 命中相关块', async () => {
    const { retriever, embedder } = await buildRetriever();
    const [qv] = await embedder.embed(['How does the attention mechanism work?']);
    const hits = retriever.search({ queryVector: qv, queryText: 'How does the attention mechanism work?', k: 3 });
    expect(hits[0].text).toBe(RELEVANT);
    for (const h of hits) expect(h.score).toBeGreaterThanOrEqual(0);
    expect(hits.length).toBe(3);
  });

  it('仅文本（无向量）退化为 BM25 单路', async () => {
    const { retriever } = await buildRetriever();
    const hits = retriever.search({ queryText: 'attention mechanism dot product', k: 2 });
    expect(hits[0].text).toBe(RELEVANT);
  });

  it('仅向量（queryText 为空）退化为余弦单路', async () => {
    const { retriever, embedder } = await buildRetriever();
    const [qv] = await embedder.embed(['attention mechanism attention']);
    const hits = retriever.search({ queryVector: qv, queryText: '', k: 3 });
    expect(hits[0].text).toBe(RELEVANT);
  });

  it('双路皆缺与 k 截断', async () => {
    const { retriever } = await buildRetriever();
    expect(retriever.search({ queryText: '' })).toEqual([]);
    expect(retriever.search({ queryText: 'attention', k: 1 })).toHaveLength(1);
    expect(retriever.size).toBe(3);
  });

  it('未挂向量的块在混合检索下仍可被文本侧召回', () => {
    const r = new HybridRetriever();
    r.addChunk(chunk(0, 'quantum entanglement experiments were repeated'), undefined);
    const hits = r.search({ queryText: 'entanglement experiments' });
    expect(hits[0].id).toBe('c0');
  });
});
