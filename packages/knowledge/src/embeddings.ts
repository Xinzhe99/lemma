/**
 * 嵌入提供者抽象。
 * HashEmbeddingProvider：确定性哈希嵌入——离线可用、可测试的诚实 stub：
 * 同文本必同向量，但无语义泛化能力（近义无关），且词词同权（停用词淹没内容词）；
 * TfidfEmbeddingProvider：TF-IDF 加权的哈希嵌入——语料级 df 抑制高频停用词、
 * 放大稀有内容词，是本地离线路径的默认质量档；
 * 生产路径请接 OpenAICompatEmbeddings 或自实现 provider。
 */
import { fnv1a, tokenize } from './util';

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
  /** 语料拟合（可选）：检索型 provider 在批量索引前调用以收集 df 等统计 */
  fit?(texts: string[]): void;
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

/**
 * TF-IDF 加权哈希嵌入（本地离线默认档）：
 *  - fit(texts)：收集语料级 df（文档频率）。检索质量的关键——停用词（the/of/…）
 *    在全库几乎每篇都有 → idf≈0 → 不再淹没内容词；稀有术语 idf 高 → 主导相似度；
 *  - embed：词权重 = tf × idf，经带符号哈希投入 dim 维桶后 L2 归一（与 Hash 相同的
 *    桶分配，保证确定性）；
 *  - 未 fit 直接 embed：退化为批内自适应 fit（批内 df），索引方应在全库收集后调用
 *    fit 一次以获得语料级权重；
 *  - 仍是词袋模型：同义改写不共享权重（语义泛化仍需真嵌入 API）。
 */
export class TfidfEmbeddingProvider implements EmbeddingProvider {
  readonly dim: number;
  private df = new Map<string, number>();
  private corpusN = 0;

  constructor(dim = 256) {
    this.dim = Math.max(1, Math.floor(dim));
  }

  /** 语料拟合：整体重建 df 表（重复调用以最后一次为准） */
  fit(texts: string[]): void {
    this.df = new Map();
    this.corpusN = texts.length;
    for (const text of texts) {
      const seen = new Set<string>();
      for (const tok of tokenize(text)) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        this.df.set(tok, (this.df.get(tok) ?? 0) + 1);
      }
    }
  }

  /** 平滑 idf：语料外词 df=0 → 最高权重；常见词 → 趋近 0 但保持正 */
  private idf(tok: string): number {
    const n = this.df.get(tok) ?? 0;
    return Math.log((this.corpusN + 1) / (n + 1)) + 1;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (this.corpusN === 0 && texts.length > 0) this.fit(texts);
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
      v[bucket] += sign * count * this.idf(tok);
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
