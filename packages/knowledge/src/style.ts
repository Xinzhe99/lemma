/**
 * 风格档案（设计 4.7）：句长分布、被动语态比例、hedging 密度，附中文观察。
 * 启发式实现，供 soft constraint 注入润色与起草流程。
 */
import type { StyleProfile } from '@scholarforge/shared';
import { tokenize } from './util';

/** 句点前若为这些缩写词，则不视为句子边界 */
const ABBREVIATIONS = new Set([
  'e.g', 'i.e', 'et al', 'etc', 'vs', 'cf', 'fig', 'figs', 'eq', 'eqs', 'sec', 'secs',
  'no', 'nos', 'ref', 'refs', 'tab', 'dr', 'prof', 'mr', 'mrs', 'ms', 'st', 'approx',
  'al', 'inc', 'ltd', 'dept', 'univ', 'acad', 'proc', 'ieee', 'acm',
]);

const CJK_TERMINATORS = new Set(['。', '！', '？']);

/** 常见过去分词（学术被动语态启发式词表） */
const PARTICIPLES = [
  'used', 'based', 'described', 'shown', 'proposed', 'derived', 'observed', 'measured',
  'obtained', 'considered', 'defined', 'given', 'introduced', 'trained', 'evaluated',
  'computed', 'estimated', 'performed', 'conducted', 'compared', 'analyzed', 'analysed',
  'selected', 'applied', 'implemented', 'reported', 'found', 'taken', 'known', 'seen',
  'called', 'labeled', 'labelled', 'designed', 'developed', 'achieved', 'adopted',
  'chosen', 'written', 'drawn', 'held', 'built', 'sent', 'made', 'done', 'driven',
  'kept', 'left', 'provided', 'presented', 'published', 'accepted', 'replaced',
  'referred', 'regarded', 'treated', 'viewed', 'noted', 'mentioned', 'ignored', 'added',
  'removed', 'fixed', 'placed', 'stored', 'encoded', 'decoded', 'initialized',
  'normalised', 'normalized', 'regularized', 'penalized', 'weighted', 'clustered',
  'projected', 'embedded', 'sampled', 'collected', 'recorded', 'extracted', 'parsed',
  'annotated', 'aligned', 'mapped', 'converted', 'transformed', 'reduced', 'merged',
  'split', 'grouped', 'sorted', 'filtered', 'detected', 'recognized', 'predicted',
  'classified', 'scored', 'ranked', 'matched', 'fitted', 'tuned', 'validated', 'tested',
  'verified', 'confirmed', 'demonstrated', 'revealed', 'indicated', 'suggested',
  'assumed', 'supposed', 'expected', 'required', 'needed', 'allowed', 'enabled',
  'caused', 'produced', 'generated', 'created', 'formed', 'composed', 'characterized',
  'modelled', 'modeled', 'simulated', 'approximated',
];

const PASSIVE_RE = new RegExp(
  `\\b(?:am|is|are|was|were|be|been|being)\\b(?:\\s+\\w+){0,2}?\\s+\\b(?:${PARTICIPLES.join('|')})\\b`,
  'i',
);

/** hedging 词表（含屈折变化） */
const HEDGES = new Set([
  'may', 'might', 'could', 'would', 'suggest', 'suggests', 'suggested', 'approximately',
  'potential', 'potentially', 'likely', 'possibly', 'possible', 'perhaps', 'maybe',
  'probably', 'probable', 'assume', 'assumes', 'assumed', 'argue', 'argues', 'argued',
  'appear', 'appears', 'appeared', 'seem', 'seems', 'seemed', 'tend', 'tends', 'roughly',
  'relatively', 'generally', 'somewhat', 'often', 'occasionally', 'arguably',
  'presumably', 'hypothetically',
]);

/** 句子切分：句号/问叹号 + 空白；忽略缩写句点（e.g. / i.e. / et al. 等）与小数点 */
export function splitTextSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const isLatinEnd = ch === '.' || ch === '!' || ch === '?';
    const isCjkEnd = CJK_TERMINATORS.has(ch);
    if (!isLatinEnd && !isCjkEnd) continue;

    if (ch === '.') {
      const next = text[i + 1];
      if (next && /[0-9]/.test(next)) continue; // 小数点
      const wordBefore = /[A-Za-z.]+$/.exec(text.slice(0, i))?.[0]?.toLowerCase() ?? '';
      if (ABBREVIATIONS.has(wordBefore)) continue; // 缩写句点
    }
    if (isLatinEnd) {
      // 拉丁终止符后须跟空白或文末（避免 "U.S" 一类）
      const next = text[i + 1];
      if (next && !/\s/.test(next)) continue;
    }
    out.push(text.slice(start, i + 1).trim());
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out.filter((s) => s.length > 0);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}

export function analyzeStyle(text: string): StyleProfile {
  const sentences = splitTextSentences(text);
  const wordCounts = sentences.map((s) => tokenize(s).length);
  const totalWords = wordCounts.reduce((a, b) => a + b, 0);

  const sentenceLenMean = totalWords > 0 ? totalWords / sentences.length : 0;
  const sentenceLenP90 = percentile([...wordCounts].sort((a, b) => a - b), 0.9);

  const passiveCount = sentences.filter((s) => PASSIVE_RE.test(s)).length;
  const passiveRatio = sentences.length > 0 ? passiveCount / sentences.length : 0;

  let hedgeCount = 0;
  for (const tok of tokenize(text)) {
    if (HEDGES.has(tok)) hedgeCount++;
  }
  const hedgingDensity = totalWords > 0 ? (hedgeCount / totalWords) * 1000 : 0;

  const notes: string[] = [];
  if (sentences.length === 0) {
    notes.push('未检测到有效句子，无法分析风格。');
  } else {
    if (sentenceLenMean > 25) {
      notes.push(`平均句长偏长（${sentenceLenMean.toFixed(1)} 词），建议拆分长句。`);
    }
    if (sentenceLenP90 > 35) {
      notes.push(`句长分布存在过长尾部（P90 为 ${sentenceLenP90.toFixed(0)} 词），建议检查超长句。`);
    }
    if (passiveRatio > 0.3) {
      notes.push(`被动语态比例较高（${(passiveRatio * 100).toFixed(0)}%），可考虑将部分句子改为主动语态。`);
    }
    if (hedgingDensity > 12) {
      notes.push(`hedging 语气偏重（每千词 ${hedgingDensity.toFixed(1)} 次），断言强度可适当提高。`);
    }
    if (notes.length === 0) {
      notes.push('各项风格指标处于常见学术写作范围内。');
    }
  }

  return { sentenceLenMean, sentenceLenP90, passiveRatio, hedgingDensity, notes };
}
