import { createId, type Paper, type PaperAuthor, type Venue } from '@lemma/shared';
import { parsePersonName } from './bibtex';

/**
 * RIS 基础解析：TY（类型）/ TI·T1（标题）/ AU·AF（作者）/ PY·DA（年份）/
 * JO·JF·T2（场所）/ DO（DOI）/ ID（citekey），另支持 AB（摘要）、KW（标签）、
 * VL·IS·SP·EP（卷期页）。无标签的续行接在上一个标签的值之后（长标题/摘要折行）；
 * 记录以 ER 结束，缺失 ER 时由下一个 TY 或文件结束收尾（宽松，不丢记录）。
 */

export interface ParseRisResult {
  papers: Paper[];
  errors: string[];
}

const RIS_LINE = /^([A-Za-z][A-Za-z0-9])[ \t]*-[ \t]*(.*)$/;

const VENUE_TYPE_BY_RIS: Record<string, Venue['type']> = {
  JOUR: 'journal',
  MGZN: 'journal',
  CONF: 'conference',
  BOOK: 'book',
  CHAP: 'book',
  THES: 'thesis',
};

function firstYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = /(\d{4})/.exec(value);
  return m ? Number(m[1]) : undefined;
}

function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)\s*/i, '');
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function recordToPaper(record: Map<string, string[]>, errors: string[]): Paper | null {
  const pick = (tag: string): string | undefined => record.get(tag)?.[0];
  const all = (tag: string): string[] => record.get(tag) ?? [];

  const title = (pick('TI') ?? pick('T1') ?? '').trim();
  if (!title) {
    errors.push('存在缺少 TI 标题行的记录，已跳过');
    return null;
  }

  const authors: PaperAuthor[] = [];
  for (const raw of [...all('AU'), ...all('AF')]) {
    const author = parsePersonName(raw);
    if (author) authors.push(author);
  }

  const risType = pick('TY') ?? 'JOUR';
  const venueName = pick('JO') ?? pick('JF') ?? pick('T2');
  const startPage = pick('SP');
  const endPage = pick('EP');

  const tags: string[] = [];
  for (const kw of all('KW')) {
    for (const part of kw.split(';')) {
      const tag = part.trim();
      if (tag) tags.push(tag);
    }
  }

  const doi = normalizeDoi(pick('DO'));
  return {
    id: createId(),
    citekey: (pick('ID') ?? '').trim(),
    title,
    authors,
    year: firstYear(pick('PY') ?? pick('DA')),
    venue: venueName
      ? {
          type: VENUE_TYPE_BY_RIS[risType.toUpperCase()] ?? 'unknown',
          name: venueName,
          volume: pick('VL'),
          issue: pick('IS'),
          pages: startPage && endPage ? `${startPage}-${endPage}` : startPage,
        }
      : undefined,
    abstract: (pick('AB') ?? pick('N2'))?.trim() || undefined,
    doi,
    tags,
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
  };
}

/** 续行（无标签行）追加到上一个标签的最后一个值之后——RIS 允许长字段折行。 */
function appendContinuation(record: Map<string, string[]>, tag: string, text: string): void {
  const list = record.get(tag);
  if (!list) return;
  const last = list.length - 1;
  if (last < 0) list.push(text); // 标签首行为空（如 “AB  - ”）时续行即首段
  else list[last] = `${list[last]!} ${text}`.trim();
}

/** 解析 RIS 文本为文献列表；坏记录记入 errors。 */
export function parseRis(text: string): ParseRisResult {
  const papers: Paper[] = [];
  const errors: string[] = [];
  const records: Map<string, string[]>[] = [];
  let current: Map<string, string[]> | null = null;
  /** 最近一个标签：无标签的续行归它所有（ER 后 current 置空，续行自然丢弃） */
  let lastTag: string | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const m = RIS_LINE.exec(line);
    if (!m) {
      if (current && lastTag) appendContinuation(current, lastTag, line.trim());
      continue; // 其余非标签内容：宽松忽略
    }
    const tag = m[1]!.toUpperCase();
    const value = m[2]!.trim();
    if (tag === 'TY') {
      // 缺少 ER 的上一条记录按结束处理（与文件结束同款），避免静默丢条目
      if (current) records.push(current);
      current = new Map();
    }
    if (!current) continue;
    const list = current.get(tag) ?? [];
    if (value) list.push(value);
    current.set(tag, list);
    lastTag = tag;
    if (tag === 'ER') {
      records.push(current);
      current = null;
      lastTag = null;
    }
  }
  // 文件结束时未闭合的记录按结束处理（宽松）
  if (current) records.push(current);

  for (const record of records) {
    if (!record.has('TY')) {
      errors.push('存在缺少 TY 类型行的记录，已跳过');
      continue;
    }
    const paper = recordToPaper(record, errors);
    if (paper) papers.push(paper);
  }

  return { papers, errors };
}
