/**
 * 学术风格分析（v1.3.0）：纯文本统计层——LaTeX 源码 → 结构化风格报告。
 *
 * 分析口径（务实取舍，全部本地零依赖）：
 *  - 预处理：去掉 % 注释（保留 \% 转义）、`\cite/\ref/\label/\eqref/\href` 等无正文
 *    语义的命令、剩余 `\命令` token、花括号；行内/展示数学替换为占位符（MATH），
 *    不参与词法但保持句子边界；
 *  - 分句：[.!?]+ 后接空白 + 大写/数字/行尾；学术缩写（e.g. / i.e. / et al. /
 *    Fig. / Eq. / Sec. / vs. / cf. / Dr. / Prof. / St.）不切分；
 *  - 指标：句数、平均/P95 句长（词）、长句（>LONG_SENTENCE_WORDS）清单、
 *    被动语态命中（be 动词 + 过去分词启发式）、第一人称、模糊限定词、
 *    段落统计（空行分段）、Flesch-Kincaid 年级（学术目标区间 12–18）；
 *  - 定位：句子回查源码行——取句首 20 个非空白字符在原文 indexOf（预处理只删
 *    不改，绝大多数句子可命中）；命中失败 line=undefined，仍展示句子本身。
 */

/** 长句阈值（词数）：超过即进「长句清单」 */
export const LONG_SENTENCE_WORDS = 35;
/** 长段落阈值（词数） */
export const LONG_PARAGRAPH_WORDS = 150;
/** FK 年级的目标区间（学术写作惯例） */
export const FK_TARGET_RANGE: readonly [number, number] = [12, 18];

/** 一条被动语态命中 */
export interface PassiveHit {
  text: string;
  line?: number;
}

/** 一条长句 */
export interface LongSentence {
  text: string;
  words: number;
  line?: number;
}

export interface StyleReport {
  sentences: number;
  words: number;
  avgSentenceWords: number;
  /** 最接近 P95 的实测句长（最近秩法；句数 <2 时为均值） */
  p95SentenceWords: number;
  longSentences: LongSentence[];
  passiveHits: PassiveHit[];
  passivePct: number;
  firstPersonCount: number;
  weaselCounts: { word: string; count: number }[];
  paragraphs: number;
  longParagraphs: { words: number; line?: number }[];
  /** Flesch-Kincaid 年级（启发式音节计数） */
  fkGrade: number;
}

// ---------------------------------------------------------------------------
// 预处理
// ---------------------------------------------------------------------------

/** 无正文语义的命令：整体（含参数）移除 */
const CONTENTLESS_CMD_RE =
  /\\(?:cite[pt]?\*?|ref|eqref|autoref|cref|label|url|href|footnotemark|thanks)\s*(?:\[[^\]]*\])?\{[^{}]*\}/g;
/** 剩余命令 token：`\cmd`（含可选 *）删除，参数花括号保留其中文本 */
const CMD_TOKEN_RE = /\\[A-Za-z@]+\*?/g;
/** 数学环境（行内 $...$ 与展示 $$...$$ / \[...\]）→ 占位（保持边界感） */
const INLINE_MATH_RE = /\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[^$\n]+\$/g;

/** 预处理：去注释/无义命令/命令 token/花括号，数学 → " MATH "；输出行数与原文一致（\n 保留） */
export function prepareText(tex: string): string {
  let out = tex.replace(/(^|[^\\])%[^\n]*/g, (_m, pre: string) => pre);
  out = out.replace(CONTENTLESS_CMD_RE, ' ');
  out = out.replace(INLINE_MATH_RE, ' MATH ');
  // 字面转义还原（\% \% → %；注释已删，不会产生假注释起点）
  out = out.replace(/\\([%&])/g, '$1');
  out = out.replace(CMD_TOKEN_RE, ' ');
  out = out.replace(/[{}]/g, '');
  return out;
}

/** 学术缩写：其后句点不切分 */
const ABBREV_RE =
  /(?:e\.g|i\.e|et al|Fig|Figs|Eq|Eqs|Sec|Secs|Ref|Refs|Tab|vs|cf|Dr|Prof|St|Mr|Ms|Jr|Inc|Ltd|No|Vol|pp|arXiv)\.$/i;

/** 分句（预处理后文本）：返回句子及其在预处理文本中的起始偏移 */
export function splitSentences(text: string): { text: string; start: number }[] {
  const out: { text: string; start: number }[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?') continue;
    // 吞掉连续结束符（?!）
    let j = i;
    while (j + 1 < text.length && /[.!?]/.test(text[j + 1] ?? '')) j++;
    const next = text[j + 1];
    const isEnd = next === undefined;
    const nextIsSentenceStart = next !== undefined && (next === '\n' || next === ' ' || next === '\t');
    if (!isEnd && !nextIsSentenceStart) {
      i = j;
      continue;
    }
    const head = text.slice(start, j + 1);
    // 行尾空白吞进上一句；句尾是学术缩写则不切分
    if (ABBREV_RE.test(head.trimEnd())) {
      i = j;
      continue;
    }
    const sentence = head.trim();
    if (sentence) out.push({ text: sentence, start });
    start = j + 1;
    i = j;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push({ text: tail, start });
  return out;
}

// ---------------------------------------------------------------------------
// 词法与指标
// ---------------------------------------------------------------------------

const WORD_RE = /[A-Za-z][A-Za-z'-]*/g;

function words(s: string): string[] {
  return s.match(WORD_RE) ?? [];
}

/** 音节启发式：英文按元音组计数，去尾 e，至少 1 */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouy]+/g) ?? ['a'];
  let n = groups.length;
  if (w.length > 2 && w.endsWith('e') && !/[aeiouy]e$/.test(w.slice(0, -1) + 'e')) n = Math.max(1, n - 1);
  return Math.max(1, n);
}

/** 被动语态启发式：be 动词 +（可选副词）+ 过去分词形（-ed/-en/-wn 等白名单混合） */
const BE_VERBS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
const IRREGULAR_PP = new Set([
  'given', 'shown', 'known', 'taken', 'written', 'driven', 'drawn', 'proven', 'built', 'made',
  'held', 'kept', 'left', 'lost', 'meant', 'met', 'paid', 'read', 'said', 'sent', 'set', 'sit',
  'sold', 'spent', 'told', 'brought', 'bought', 'caught', 'taught', 'thought', 'found', 'ground',
  'bound', 'wound', 'seen', 'done', 'gone', 'begun', 'chosen', 'frozen', 'spoken', 'broken', 'hidden',
]);

function isPastParticiple(w: string): boolean {
  const lower = w.toLowerCase();
  if (IRREGULAR_PP.has(lower)) return true;
  return lower.length > 4 && lower.endsWith('ed');
}

/** 被动命中（句子级去重：每句至多记一条，取首个命中片段） */
export function findPassiveHits(sentences: string[]): PassiveHit[] {
  const hits: PassiveHit[] = [];
  for (const s of sentences) {
    const toks = s.split(/\s+/);
    for (let i = 0; i + 1 < toks.length; i++) {
      const clean = (t: string): string => t.replace(/[^A-Za-z]/g, '');
      if (!BE_VERBS.has(clean(toks[i] ?? ''))) continue;
      let k = i + 1;
      // 可选副词（clearly, often, widely…ly）
      if (k + 1 < toks.length && /ly[.,;:!?]?$/.test(toks[k] ?? '') && isPastParticiple(clean(toks[k + 1] ?? ''))) k++;
      const pp = clean(toks[k] ?? '');
      if (pp && isPastParticiple(pp)) {
        const frag = toks.slice(Math.max(0, i - 2), Math.min(toks.length, k + 3)).join(' ');
        hits.push({ text: frag });
        break;
      }
    }
  }
  return hits;
}

/** 模糊限定词（weasel words）：学术写作者应显著或删除的弱化表达 */
export const WEASEL_WORDS: readonly string[] = [
  'very', 'quite', 'rather', 'basically', 'actually', 'really', 'simply', 'just',
  'several', 'some', 'few', 'most', 'many', 'various', 'significant',
  'it is worth noting that', 'in order to', 'a number of', 'the fact that',
];

function countWeasels(allWords: string[], text: string): { word: string; count: number }[] {
  const single = new Map<string, number>();
  for (const w of allWords) {
    const lower = w.toLowerCase();
    if (WEASEL_WORDS.includes(lower)) single.set(lower, (single.get(lower) ?? 0) + 1);
  }
  const lowerText = ` ${text.toLowerCase()} `;
  const out: { word: string; count: number }[] = [];
  for (const [word, count] of single) out.push({ word, count });
  for (const phrase of WEASEL_WORDS) {
    if (phrase.includes(' ')) {
      const n = lowerText.split(phrase).length - 1;
      if (n > 0) out.push({ word: phrase, count: n });
    }
  }
  return out.sort((a, b) => b.count - a.count);
}

/** 句子回查源码行：句首 20 个非空白字符在原文定位（失败返回 undefined） */
export function findSentenceLine(tex: string, sentence: string): number | undefined {
  const probe = sentence.replace(/\s+/g, ' ').trim().slice(0, 20);
  if (probe.length < 8) return undefined;
  const idx = tex.indexOf(probe);
  if (idx < 0) return undefined;
  let line = 1;
  for (let i = 0; i < idx; i++) if (tex[i] === '\n') line++;
  return line;
}

function lineOfOffset(tex: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < tex.length; i++) if (tex[i] === '\n') line++;
  return line;
}

// ---------------------------------------------------------------------------
// 主分析
// ---------------------------------------------------------------------------

/** 段落切分（空行分段），返回每段词数与首行行号 */
function paragraphsOf(text: string, tex: string): { words: number; line: number }[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => ({ p, words: words(p).length }))
    .filter((x) => x.words > 0)
    .map((x) => ({ words: x.words, line: lineOfOffset(tex, text.indexOf(x.p.slice(0, 24))) }));
}

/** 最近秩 P95：句数 <2 返回均值（样本过小不给极端值） */
function p95(values: number[], fallbackMean: number): number {
  if (values.length < 2) return fallbackMean;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[rank] ?? fallbackMean;
}

/**
 * 分析一篇 LaTeX 源码的风格（全文级；宿主一般传当前 .tex）。
 * 空文本 / 无有效句子返回 zeros 报告（sentences=0）。
 */
export function analyzeStyle(tex: string): StyleReport {
  const prepared = prepareText(tex);
  const sents = splitSentences(prepared);
  const sentenceTexts = sents.map((s) => s.text);
  const allWords = words(prepared);
  const wordCount = allWords.length;

  const longSentences: LongSentence[] = sents
    .map((s) => ({ text: s.text, words: words(s.text).length }))
    .filter((s) => s.words > LONG_SENTENCE_WORDS)
    .sort((a, b) => b.words - a.words)
    .slice(0, 12)
    .map((s) => ({ ...s, line: findSentenceLine(tex, s.text) }));

  const passiveHits = findPassiveHits(sentenceTexts)
    .slice(0, 12)
    .map((h) => ({ ...h, line: findSentenceLine(tex, h.text) }));

  const firstPersonCount = allWords.filter(
    (w) => /^(I|we|our|us|my|ours)$/i.test(w),
  ).length;

  const paraStats = paragraphsOf(prepared, tex);
  const longParagraphs = paraStats
    .filter((p) => p.words > LONG_PARAGRAPH_WORDS)
    .sort((a, b) => b.words - a.words)
    .slice(0, 6);

  const sentenceWordCounts = sentenceTexts.map((s) => words(s).length);
  const avg = sents.length > 0 ? wordCount / sents.length : 0;
  const syl = allWords.reduce((acc, w) => acc + syllables(w), 0);
  const fkGrade =
    sents.length > 0 && wordCount > 0
      ? 0.39 * avg + 11.8 * (syl / wordCount) - 15.59
      : 0;

  return {
    sentences: sents.length,
    words: wordCount,
    avgSentenceWords: Math.round(avg * 10) / 10,
    p95SentenceWords: Math.round(p95(sentenceWordCounts, avg)),
    longSentences,
    passiveHits,
    passivePct:
      sents.length > 0 ? Math.round((passiveHits.length / sents.length) * 1000) / 10 : 0,
    firstPersonCount,
    weaselCounts: countWeasels(allWords, prepared),
    paragraphs: paraStats.length,
    longParagraphs,
    fkGrade: Math.max(0, Math.round(fkGrade * 10) / 10),
  };
}
