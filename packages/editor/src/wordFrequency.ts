/**
 * 词汇频率分析（v2.5.0 ②）：检测学术写作中的词汇过度使用。
 *
 * 分析口径：
 *  - 提取全部拉丁词（复用 tokenize 口径：小写化 + 连字符保留）；
 *  - 排除停用词（the/a/of/in 等功能词不统计——高频是正常的）；
 *  - 统计词频，按频次降序；
 *  - 额外检测高频短语（连续 2-3 词出现 ≥3 次的表达，如 "in order to"）。
 *
 * 输出供风格报告面板渲染：topWords + repeatedPhrases。
 */

/** 内联 tokenize（与 knowledge 包同口径：小写化，拉丁连续词，汉字单字） */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-z0-9]+(?:'[a-z]+)?|\p{Script=Han}/gu;
  for (const m of text.toLowerCase().matchAll(re)) tokens.push(m[0]);
  return tokens;
}

// ---------------------------------------------------------------------------
// 停用词（学术英语功能词——高频出现是正常的，不构成"过度使用"告警）
// ---------------------------------------------------------------------------

export const STOPWORDS: ReadonlySet<string> = new Set([
  // 冠词/代词
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'we', 'our', 'us',
  'they', 'their', 'them', 'he', 'she', 'his', 'her', 'you', 'your', 'i', 'my', 'me',
  'which', 'who', 'whom', 'whose', 'what', 'where', 'when', 'why', 'how', 'all', 'both',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 's', 't', 'can', 'will', 'just', 'don',
  'should', 'now', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
  'had', 'having', 'do', 'does', 'did', 'doing', 'would', 'could', 'ought', 'might',
  'must', 'shall', 'may',
  // 介词/连词
  'of', 'in', 'to', 'for', 'with', 'on', 'by', 'at', 'from', 'up', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between', 'out', 'off',
  'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'and', 'but',
  'or', 'if', 'because', 'as', 'until', 'while', 'also', 'however', 'therefore',
  'moreover', 'furthermore', 'thus', 'hence', 'whereas', 'although', 'though',
  // 常见学术连接词（高频正常）
  'in', 'order', 'terms', 'respect', 'addition', 'contrast', 'particular',
  'general', 'conclusion', 'summary', 'results', 'propose', 'show', 'based',
  'using', 'used', 'use', 'paper', 'section', 'table', 'figure', 'equation',
  // LaTeX 命令残留
  'begin', 'end', 'cite', 'ref', 'label', 'item', 'caption', 'textbf', 'textit',
  'emph', 'frac', 'left', 'right', 'mathrm', 'mathbf', 'text',
]);

export interface WordFreqItem {
  word: string;
  count: number;
}

export interface PhraseFreqItem {
  phrase: string;
  count: number;
}

export interface WordFrequencyReport {
  /** 非停用词总数（去重前） */
  totalWords: number;
  /** 去重后非停用词数（词汇丰富度指标） */
  uniqueWords: number;
  /** 高频内容词（频次 ≥ minCount，降序，上限 15） */
  topWords: WordFreqItem[];
  /** 重复短语（连续 2-3 词出现 ≥ minPhraseCount 次） */
  repeatedPhrases: PhraseFreqItem[];
}

/** 词频分析：text → 频次降序的非停用词列表 + 重复短语检测 */
export function analyzeWordFrequency(
  text: string,
  options?: { minCount?: number; minPhraseCount?: number; topN?: number },
): WordFrequencyReport {
  const minCount = options?.minCount ?? 3;
  const minPhraseCount = options?.minPhraseCount ?? 3;
  const topN = options?.topN ?? 15;

  const tokens = tokenize(text);
  const contentWords = tokens.filter((t) => t.length > 2 && !STOPWORDS.has(t));

  // 词频统计
  const freq = new Map<string, number>();
  for (const w of contentWords) freq.set(w, (freq.get(w) ?? 0) + 1);

  const topWords: WordFreqItem[] = [...freq.entries()]
    .filter(([, c]) => c >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }));

  // 重复短语检测（bigram + trigram）
  const phrases = new Map<string, number>();
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i <= contentWords.length - n; i++) {
      const phrase = contentWords.slice(i, i + n).join(' ');
      phrases.set(phrase, (phrases.get(phrase) ?? 0) + 1);
    }
  }
  // 只保留达到阈值的，且不是更长短语的子串（去重："deep learning" 是 "deep learning model" 的子串时只保留更长的）
  const repeatedPhrases: PhraseFreqItem[] = [...phrases.entries()]
    .filter(([p, c]) => c >= minPhraseCount)
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .filter(([p], i, arr) => !arr.slice(0, i).some(([longer]) => longer.includes(p)))
    .slice(0, 10)
    .map(([phrase, count]) => ({ phrase, count }));

  return {
    totalWords: contentWords.length,
    uniqueWords: freq.size,
    topWords,
    repeatedPhrases,
  };
}
