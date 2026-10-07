/**
 * 术语表抽取与一致性检查（设计 4.7）。
 * 识别 "Full Capitalized Term (FCT)" 定义模式；全文首个定义为准、去重。
 */
import type { GlossaryTerm } from '@lemma/shared';
import { escapeRegExp, fnv1a } from './util';

export interface GlossaryIssue {
  severity: 'error' | 'hint';
  /** 中文描述 */
  message: string;
  abbr?: string;
}

// 大写开头的词（允许连字符复合，如 State-of-the-Art）
const CAP_WORD = '[A-Z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*';
// 全称中允许出现的小写连接词
const CONNECTORS = 'and|or|of|for|the|a|an|in|to|on|at|by|with|from|via|versus|vs';
// 全称 = 至少两个大写词，中间可夹连接词
const FULL_TERM = `${CAP_WORD}(?:\\s+(?:${CONNECTORS})?\\s*${CAP_WORD})+`;
// 缩写 = 2-12 个字母/数字/连字符
const ABBR_CORE = '[A-Za-z][A-Za-z0-9-]{1,11}';
const DEF_RE = new RegExp(`(${FULL_TERM})\\s*\\((${ABBR_CORE})\\)`, 'g');

const LEADING_ARTICLE = /^(?:A|An|The)\s+(?=[A-Z])/;

interface Definition {
  term: string;
  abbr: string;
  /** 定义整体的起始下标 */
  index: number;
  /** 定义整体的结束下标（括号之后） */
  end: number;
}

/** 取全称中各词首字母（按大写词与连字符大写段计，连接词不计） */
function initialsOf(term: string): string[] {
  const initials: string[] = [];
  for (const word of term.split(/\s+/)) {
    for (const seg of word.split('-')) {
      if (/^[A-Z]/.test(seg)) initials.push(seg[0].toLowerCase());
    }
  }
  return initials;
}

/** abbr 的字母是否按顺序出现于全称首字母序列（宽松子序列，兼容 GNNs/GPUs 等复数缩写） */
function abbrMatchesInitials(abbr: string, term: string): boolean {
  const letters = abbr.replace(/[^A-Za-z]/g, '').replace(/([a-z])s$/i, '$1').toLowerCase();
  if (letters.length === 0) return false;
  const initials = initialsOf(term);
  if (letters.length > initials.length) return false;
  let i = 0;
  for (const init of initials) {
    if (init === letters[i]) i++;
  }
  return i === letters.length;
}

/** 从全文中找出所有 "Full Term (ABBR)" 定义（未做首定义去重） */
function findDefinitions(text: string): Definition[] {
  const defs: Definition[] = [];
  for (const m of text.matchAll(DEF_RE)) {
    let term = (m[1] ?? '').replace(/\s+/g, ' ').trim();
    term = term.replace(LEADING_ARTICLE, ''); // 去掉句首冠词 A/An/The
    const abbr = m[2] ?? '';
    const index = m.index ?? 0;
    if (!/\s/.test(term)) continue; // 全称须为多词
    if (!abbrMatchesInitials(abbr, term)) continue;
    defs.push({ term, abbr, index, end: index + m[0].length });
  }
  return defs;
}

/** 取定义后的说明片段作为 definition */
function definitionSnippet(text: string, from: number): string | undefined {
  const rest = text
    .slice(from)
    .replace(/^\s*(?:is|are|refers to|denotes|means|stands for)\s+/i, '')
    .trimStart();
  const m = rest.match(/^[^.。\n]{10,160}/);
  return m ? m[0].trim() : undefined;
}

/** 抽取术语表：全文首个定义为准，按缩写去重 */
export function extractGlossary(text: string): GlossaryTerm[] {
  const seen = new Set<string>();
  const out: GlossaryTerm[] = [];
  for (const def of findDefinitions(text)) {
    const key = def.abbr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `glo-${fnv1a(`${key}:${def.term.toLowerCase()}`).toString(36)}`,
      term: def.term,
      abbr: def.abbr,
      definition: definitionSnippet(text, def.end),
    });
  }
  return out;
}

/** 缩写作为独立词出现的位置（排除其 "(ABBR)" 定义括号内的那次） */
function abbrUsages(text: string, abbr: string): number[] {
  const re = new RegExp(`(^|[^A-Za-z0-9_-])(${escapeRegExp(abbr)})(?![A-Za-z0-9_-])`, 'g');
  const positions: number[] = [];
  for (const m of text.matchAll(re)) {
    const start = (m.index ?? 0) + m[1].length;
    const prevChar = text[start - 1];
    const nextChar = text[start + abbr.length];
    if (prevChar === '(' && nextChar === ')') continue; // 定义括号本身
    positions.push(start);
  }
  return positions;
}

/** ③ 中以全称构造正则的长度上限：连续大写词的长串会被 DEF_RE 误当作「全称」，
 *  万级字符的 term 会让 RegExp 编译直接抛错（SyntaxError/RangeError）并中断整次检查 */
const MAX_TERM_CHARS = 200;

/** 检查文本与术语表的一致性：定义前使用 / 重复定义不一致 / 全称冗余（提示） */
export function checkConsistency(text: string, glossary: GlossaryTerm[]): GlossaryIssue[] {
  const issues: GlossaryIssue[] = [];
  const defs = findDefinitions(text);

  const defsByAbbr = new Map<string, Definition[]>();
  for (const d of defs) {
    const key = d.abbr.toLowerCase();
    defsByAbbr.set(key, [...(defsByAbbr.get(key) ?? []), d]);
  }
  const glossaryByAbbr = new Map<string, GlossaryTerm>();
  for (const g of glossary) {
    if (g.abbr) glossaryByAbbr.set(g.abbr.toLowerCase(), g);
  }

  // ① 缩写在定义前使用（含从未定义）
  const abbrs = new Set([...glossaryByAbbr.keys(), ...defsByAbbr.keys()]);
  for (const key of abbrs) {
    const g = glossaryByAbbr.get(key);
    const abbrText = g?.abbr ?? defsByAbbr.get(key)?.[0]?.abbr ?? key;
    const usages = abbrUsages(text, abbrText);
    const defPositions = (defsByAbbr.get(key) ?? []).map((d) => d.index);
    const firstDef = defPositions.length > 0 ? Math.min(...defPositions) : undefined;
    for (const pos of usages) {
      if (firstDef === undefined) {
        issues.push({
          severity: 'error',
          abbr: abbrText,
          message: `缩写 ${abbrText} 在文中使用，但从未以"全称 (${abbrText})"形式给出定义。`,
        });
        break; // 同类问题只报一次
      }
      if (pos < firstDef) {
        issues.push({
          severity: 'error',
          abbr: abbrText,
          message: `缩写 ${abbrText} 在首次定义（第 ${firstDef} 字符处）之前即被使用，应先给出定义或调整语序。`,
        });
        break;
      }
    }
  }

  // ② 重复定义不一致（文内多种全称 / 与术语表锁定全称不符）
  for (const [key, ds] of defsByAbbr) {
    const abbrText = ds[0]?.abbr ?? key;
    const variants = [...new Set(ds.map((d) => d.term))];
    if (variants.length > 1) {
      issues.push({
        severity: 'error',
        abbr: abbrText,
        message: `缩写 ${abbrText} 被重复定义为不同全称：${variants.join(' / ')}（应以首次定义为准）。`,
      });
    }
    const locked = glossaryByAbbr.get(key);
    if (locked && !variants.includes(locked.term)) {
      issues.push({
        severity: 'error',
        abbr: locked.abbr,
        message: `文中将缩写 ${locked.abbr} 定义为 ${variants.join(' / ')}，与术语表锁定的"${locked.term}"不一致。`,
      });
    }
  }

  // ③ 定义后再次使用全称且无缩写跟随（提示性）
  const termsToCheck = new Map<string, string>(); // 全称 → 缩写
  for (const g of glossary) {
    if (g.abbr) termsToCheck.set(g.term, g.abbr);
  }
  for (const d of defs) {
    if (!termsToCheck.has(d.term)) termsToCheck.set(d.term, d.abbr);
  }
  for (const [term, abbr] of termsToCheck) {
    // 巨型正则防护：超长「全称」不是真术语，跳过该条提示（否则 RegExp 编译抛错）
    if (term.length > MAX_TERM_CHARS) continue;
    const defsOfKey = defsByAbbr.get(abbr.toLowerCase()) ?? [];
    if (defsOfKey.length === 0) continue;
    const firstDef = Math.min(...defsOfKey.map((d) => d.index));
    const termRe = new RegExp(
      `(^|[^A-Za-z])${term.split(/\s+/).map(escapeRegExp).join('\\s+')}(?![A-Za-z])`,
      'g',
    );
    for (const m of text.matchAll(termRe)) {
      const start = (m.index ?? 0) + m[1].length;
      if (start <= firstDef) continue;
      const after = text.slice(start + term.length);
      if (/^\s*\(\s*[A-Za-z][A-Za-z0-9-]{0,11}\s*\)/.test(after)) continue; // 全称后紧跟缩写括号
      issues.push({
        severity: 'hint',
        abbr,
        message: `术语"${term}"在定义后再次以全称出现，建议改用缩写 ${abbr}。`,
      });
      break; // 每个术语只提示一次
    }
  }

  return issues;
}
