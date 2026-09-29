/**
 * 嵌入提供者抽象。
 * HashEmbeddingProvider：确定性哈希嵌入——离线可用、可测试的诚实 stub：
 * 同文本必同向量，但无语义泛化能力（近义无关）；
 * 生产路径请接 OpenAICompatEmbeddings 或自实现 provider。
 */
import { fnv1a, tokenize } from './util';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;

  constructor(dim = 256) {
    this.dim = Math.max(1, Math.floor(dim));
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    const tf = new Map<string, number>();
    for (const tok of tokenize(text)) tf.set(tok, (tf.get(tok) ?? 0) + 1);
    for (const [tok, count] of tf) {
      const h = fnv1a(tok);
      const bucket = h % this.dim;
      const sign = (h >>> 16) & 1 ? -1 : 1;
      // 每次出现贡献 1/sqrt(tf)，累计即 sqrt(tf)，抑制高频词
      v[bucket] += sign * Math.sqrt(count);
    }
    let norm = 0;
    for (const x of v) norm += x * x;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < v.length; i++) v[i] /= norm;
    }
    return v;
  }
}

/** 可注入的 fetch 形状（便于测试与平台层替换） */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatEmbeddingsOptions {
  /** 服务基地址，如 https://api.example.com/v1 */
  url: string;
  apiKey: string;
  model: string;
  fetchFn?: FetchLike;
}

export class OpenAICompatEmbeddings implements EmbeddingProvider {
  private readonly opts: OpenAICompatEmbeddingsOptions;

  constructor(opts: OpenAICompatEmbeddingsOptions) {
    this.opts = opts;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const endpoint = `${this.opts.url.replace(/\/+$/, '')}/embeddings`;
    let res: Response;
    try {
      const doFetch: FetchLike = this.opts.fetchFn ?? ((input, init) => fetch(input, init));
      res = await doFetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({ model: this.opts.model, input: texts }),
      });
    } catch (e) {
      throw new Error(`嵌入服务请求失败（网络错误）：${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) {
      throw new Error(`嵌入服务返回错误（HTTP ${res.status}）`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new Error('嵌入服务返回的内容不是合法 JSON');
    }
    const data = (json as { data?: Array<{ index?: number; embedding?: number[] }> }).data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error('嵌入服务返回的向量数量与输入不一致');
    }
    const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    return sorted.map((d) => {
      if (!Array.isArray(d.embedding) || d.embedding.some((x) => typeof x !== 'number')) {
        throw new Error('嵌入服务返回的向量格式不合法');
      }
      return d.embedding;
    });
  }
}
