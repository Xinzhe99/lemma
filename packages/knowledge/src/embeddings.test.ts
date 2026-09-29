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
