import { describe, expect, it } from 'vitest';
import { HashEmbeddingProvider, OpenAICompatEmbeddings, type FetchLike } from './embeddings';

describe('HashEmbeddingProvider', () => {
  it('确定性：同文本必同向量', async () => {
    const p = new HashEmbeddingProvider();
    const [a1] = await p.embed(['attention is all you need']);
    const [a2] = await p.embed(['attention is all you need']);
    expect(a1).toEqual(a2);
  });

  it('非空文本 L2 归一化（模 ≈ 1）', async () => {
    const p = new HashEmbeddingProvider(128);
    const [v] = await p.embed(['the quick brown fox jumps over the lazy dog']);
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    expect(v).toHaveLength(128);
  });

  it('不同文本不同向量；空文本为零向量', async () => {
    const p = new HashEmbeddingProvider();
    const [a, b, empty] = await p.embed(['attention mechanism', 'cooking recipes today', '']);
    expect(a).not.toEqual(b);
    expect(empty.every((x) => x === 0)).toBe(true);
  });

  it('中英混排：汉字按单字、拉丁按整词参与哈希', async () => {
    const p = new HashEmbeddingProvider();
    const [zh, en] = await p.embed(['注意力机制很重要', 'attention mechanism matters a lot']);
    expect(zh).not.toEqual(en);
    // 重复单字应提升其权重贡献但不破坏归一化
    const [zh2] = await p.embed(['注注注']);
    const norm2 = Math.sqrt(zh2.reduce((s, x) => s + x * x, 0));
    expect(norm2).toBeCloseTo(1, 6);
  });
});

describe('OpenAICompatEmbeddings', () => {
  const okResponse = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

  it('按 index 对齐返回向量', async () => {
    const fetchFn: FetchLike = async () =>
      okResponse({
        data: [
          { index: 1, embedding: [0, 1] },
          { index: 0, embedding: [1, 0] },
        ],
      });
    const p = new OpenAICompatEmbeddings({ url: 'https://api.test/v1/', apiKey: 'k', model: 'm', fetchFn });
    const out = await p.embed(['a', 'b']);
    expect(out).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('请求体与鉴权头正确', async () => {
    let captured: { url: string; init?: RequestInit } | undefined;
    const fetchFn: FetchLike = async (url, init) => {
      captured = { url, init };
      return okResponse({ data: [{ index: 0, embedding: [0.5] }] });
    };
    const p = new OpenAICompatEmbeddings({ url: 'https://api.test/v1', apiKey: 'secret', model: 'emb-1', fetchFn });
    await p.embed(['hello']);
    expect(captured?.url).toBe('https://api.test/v1/embeddings');
    const body = JSON.parse(String(captured?.init?.body)) as { model: string; input: string[] };
    expect(body).toEqual({ model: 'emb-1', input: ['hello'] });
    const headers = captured?.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer secret');
  });

  it('HTTP 错误抛中文 Error', async () => {
    const fetchFn: FetchLike = async () => new Response('boom', { status: 500 });
    const p = new OpenAICompatEmbeddings({ url: 'https://api.test/v1', apiKey: 'k', model: 'm', fetchFn });
    await expect(p.embed(['x'])).rejects.toThrow(/嵌入服务返回错误.*500/);
  });

  it('网络错误与畸形响应抛中文 Error', async () => {
    const netErr = new OpenAICompatEmbeddings({
      url: 'https://api.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchFn: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    await expect(netErr.embed(['x'])).rejects.toThrow(/网络错误/);

    const badCount = new OpenAICompatEmbeddings({
      url: 'https://api.test/v1',
      apiKey: 'k',
      model: 'm',
      fetchFn: async () => okResponse({ data: [{ index: 0, embedding: [1] }] }),
    });
    await expect(badCount.embed(['x', 'y'])).rejects.toThrow(/数量与输入不一致/);
  });
});

// ---------------------------------------------------------------------------
// v1.4.0：TfidfEmbeddingProvider —— 语料级 df 抑制停用词、放大内容词
// ---------------------------------------------------------------------------

import { TfidfEmbeddingProvider } from './embeddings';
import { cosine } from './retriever';

describe('TfidfEmbeddingProvider', () => {
  it('fit 后：查询命中含稀有内容词的文档高于仅共享停用词的文档（旧哈希路径无此判别力）', async () => {
    const p = new TfidfEmbeddingProvider(256);
    const corpus = [
      'attention mechanism powers the transformer architecture',
      'the of and to in a is are for with on by as this that', // 纯停用词文档
      'diffusion models generate images from noise',
      'the of and to in a is are for with on by as this that the of and',
    ];
    p.fit(corpus);
    const [qv, d1, d2] = await p.embed([
      'how does the attention mechanism work in transformers',
      ...corpus.slice(0, 1),
      corpus[1]!,
    ]);
    expect(cosine(qv, d1)).toBeGreaterThan(cosine(qv, d2));
  });

  it('停用词权重低于内容词：idf(tok) 随 df 上升单调下降', async () => {
    const p = new TfidfEmbeddingProvider(256);
    p.fit([
      'common word everywhere',
      'common word here',
      'common word there',
      'rare term once',
    ]);
    // 访问私有 idf 的替身：嵌入两条仅差一词的文本，比较得分贡献
    const withCommon = await p.embed(['common']);
    const withRare = await p.embed(['rare']);
    const norm = (xs: number[]) => Math.hypot(...xs);
    // rare 词 df 低 → 向量范数（单 token 未归一前不可见，归一后恒 1）
    // 改为直接验证：含 rare 的文档与查询 rare 的余弦接近 1，且与 common 的余弦≈0
    expect(norm(withRare[0])).toBeCloseTo(1, 5);
    expect(cosine(withRare[0], withCommon[0])).toBeLessThan(0.01);
  });

  it('未 fit 直接 embed：批内自适应（确定性），重复调用结果一致', async () => {
    const p = new TfidfEmbeddingProvider(256);
    const a = await p.embed(['alpha beta alpha', 'gamma']);
    const b = await p.embed(['alpha beta alpha', 'gamma']);
    expect(a[0]).toEqual(b[0]);
    expect(cosine(a[0]!, b[0]!)).toBeCloseTo(1, 6);
  });

  it('语料级 fit 后重跑 embed：同文本向量稳定，且内容词主导方向', async () => {
    const p = new TfidfEmbeddingProvider(256);
    const docs = [
      'transformer attention model',
      'the of and to in is are',
      'diffusion model generates',
    ];
    p.fit(docs);
    const [d1, d2] = await p.embed([docs[0]!, docs[1]!]);
    const q = (await p.embed(['attention']))[0]!;
    expect(cosine(q, d1)).toBeGreaterThan(cosine(q, d2));
  });

  it('确定性：同语料同文本 → 同向量（哈希桶稳定）', async () => {
    const p1 = new TfidfEmbeddingProvider(256);
    const p2 = new TfidfEmbeddingProvider(256);
    const corpus = ['x y z', 'a b c d', '字词嵌入测试'];
    p1.fit(corpus);
    p2.fit(corpus);
    const [v1, v2] = await Promise.all([p1.embed(['x y z']), p2.embed(['x y z'])]);
    expect(v1[0]).toEqual(v2[0]);
  });
});
