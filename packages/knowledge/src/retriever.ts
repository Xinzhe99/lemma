/**
 * 混合检索：向量余弦（0.6）+ 自实现 BM25（0.4，归一化到 [0,1]）。
 * 缺某一路时自动退化为另一路。
 */
import type { RetrievedChunk, TextChunk } from '@scholarforge/shared';
import { tokenize } from './util';

export const VECTOR_WEIGHT = 0.6;
export const TEXT_WEIGHT = 0.4;
export const BM25_K1 = 1.5;
export const BM25_B = 0.75;

/** 余弦相似度；任一向量为零向量时返回 0 */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  for (let i = n; i < a.length; i++) na += a[i] * a[i];
  for (let i = n; i < b.length; i++) nb += b[i] * b[i];
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

interface IndexedChunk {
  chunk: TextChunk;
  vector?: number[];
  tokens: string[];
  tf: Map<string, number>;
  len: number;
}

export interface SearchParams {
  queryVector?: number[];
  queryText: string;
  k?: number;
}

export class HybridRetriever {
  private readonly docs: IndexedChunk[] = [];

  addChunk(chunk: TextChunk, vector?: number[]): void {
    const tokens = tokenize(chunk.text);
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    this.docs.push({ chunk, vector, tokens, tf, len: tokens.length });
  }

  addChunks(chunks: TextChunk[], vectors?: number[][]): void {
    chunks.forEach((c, i) => this.addChunk(c, vectors?.[i]));
  }

  get size(): number {
    return this.docs.length;
  }

  search({ queryVector, queryText, k = 5 }: SearchParams): RetrievedChunk[] {
    const hasVectorSide = queryVector !== undefined && this.docs.some((d) => d.vector !== undefined);
    const queryTokens = tokenize(queryText);
    const hasTextSide = queryTokens.length > 0;
    if (!hasVectorSide && !hasTextSide) return [];

    const bm25Raw = hasTextSide ? this.bm25Scores(queryTokens) : null;
    const bm25Max = bm25Raw ? Math.max(...bm25Raw.filter((s) => s > 0), 0) : 0;

    const scored = this.docs.map((d, i) => {
      let score = 0;
      if (hasVectorSide && hasTextSide) {
        const cos = d.vector ? Math.max(0, cosine(queryVector as number[], d.vector)) : 0;
        const bm = bm25Raw && bm25Max > 0 ? (bm25Raw[i] ?? 0) / bm25Max : 0;
        score = VECTOR_WEIGHT * cos + TEXT_WEIGHT * bm;
      } else if (hasVectorSide) {
        score = d.vector ? Math.max(0, cosine(queryVector as number[], d.vector)) : 0;
      } else {
        score = bm25Raw && bm25Max > 0 ? (bm25Raw[i] ?? 0) / bm25Max : 0;
      }
      return { ...d.chunk, score };
    });

    scored.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const out: RetrievedChunk[] = [];
    for (const s of scored) {
      if (out.length >= k) break;
      if (seen.has(s.id)) continue; // 同 id 块只保留最高分
      seen.add(s.id);
      out.push(s);
    }
    return out;
  }

  /** BM25 原始得分，逐 doc 对齐 docs 下标 */
  private bm25Scores(queryTokens: string[]): number[] {
    const N = this.docs.length;
    if (N === 0) return [];
    const avgdl = this.docs.reduce((s, d) => s + d.len, 0) / N || 1;
    const df = new Map<string, number>();
    for (const t of new Set(queryTokens)) {
      let n = 0;
      for (const d of this.docs) if (d.tf.has(t)) n++;
      df.set(t, n);
    }
    return this.docs.map((d) => {
      if (d.len === 0) return 0;
      let score = 0;
      for (const t of new Set(queryTokens)) {
        const f = d.tf.get(t);
        if (!f) continue;
        const dfT = df.get(t) ?? 0;
        const idf = Math.log(1 + (N - dfT + 0.5) / (dfT + 0.5));
        score +=
          (idf * f * (BM25_K1 + 1)) / (f + BM25_K1 * (1 - BM25_B + (BM25_B * d.len) / avgdl));
      }
      return score;
    });
  }
}
