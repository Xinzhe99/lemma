/**
 * 自实现 BM25（k1=1.5，b=0.75）。
 * 分词：小写化后连续拉丁字母/数字为一个词，汉字按单字切分。
 */

export interface Bm25Doc {
  id: string;
  text: string;
}

export interface Bm25Scored {
  id: string;
  score: number;
}

export interface Bm25Index {
  /** 返回得分大于 0 的文档，按得分降序；topK 限制返回条数。 */
  search(query: string, topK?: number): Bm25Scored[];
}

const K1 = 1.5;
const B = 0.75;

/** 中英混合分词：小写化 + 连续拉丁词 + 汉字单字。 */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+|[\u4e00-\u9fff]/g) ?? [];
}

function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const token of tokens) tf.set(token, (tf.get(token) ?? 0) + 1);
  return tf;
}

/** 构建 BM25 索引。 */
export function buildBm25(docs: Bm25Doc[]): Bm25Index {
  const docTokens = docs.map(doc => ({ id: doc.id, tokens: tokenize(doc.text) }));
  const lengths = new Map<string, number>();
  const tfs = new Map<string, Map<string, number>>();
  for (const doc of docTokens) {
    lengths.set(doc.id, doc.tokens.length);
    tfs.set(doc.id, termFrequencies(doc.tokens));
  }

  const totalDocs = docTokens.length;
  const avgLength =
    totalDocs === 0 ? 0 : docTokens.reduce((sum, doc) => sum + doc.tokens.length, 0) / totalDocs;

  const docFrequency = new Map<string, number>();
  for (const doc of docTokens) {
    for (const term of new Set(doc.tokens)) {
      docFrequency.set(term, (docFrequency.get(term) ?? 0) + 1);
    }
  }

  const idf = (term: string): number => {
    const df = docFrequency.get(term) ?? 0;
    return Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
  };

  return {
    search(query: string, topK?: number): Bm25Scored[] {
      const queryTerms = [...new Set(tokenize(query))];
      if (queryTerms.length === 0 || totalDocs === 0) return [];
      const scored: Bm25Scored[] = [];
      for (const doc of docTokens) {
        const tf = tfs.get(doc.id) ?? new Map<string, number>();
        const length = lengths.get(doc.id) ?? 0;
        let score = 0;
        for (const term of queryTerms) {
          const frequency = tf.get(term) ?? 0;
          if (frequency === 0) continue;
          const normalization =
            (frequency * (K1 + 1)) /
            (frequency + K1 * (1 - B + B * (length / (avgLength || 1))));
          score += idf(term) * normalization;
        }
        if (score > 0) scored.push({ id: doc.id, score });
      }
      scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      return topK !== undefined ? scored.slice(0, topK) : scored;
    },
  };
}
