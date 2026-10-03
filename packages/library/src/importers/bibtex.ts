import { createId, type Paper, type PaperAuthor, type Venue } from '@lemma/shared';

/**
 * 手写 BibTeX 解析器：
 * - 支持 @article/@inproceedings/@book/@misc 等条目类型（花括号与圆括号两种定界）。
 * - 字段值支持 {...} 与 "..."、嵌套大括号、# 拼接、@string 常量展开（含内置常见常量）。
 * - TeX 命令（如 \emph）原样保留；作者名中的保护性大括号会被剥离。
 * - 坏条目记录到 errors，不中断整体解析。
 */

/** 内置 @string 常量（少数常见：月份宏与出版机构缩写）。 */
const BUILT_IN_STRINGS: Record<string, string> = {
  jan: 'January',
  feb: 'February',
  mar: 'March',
  apr: 'April',
  may: 'May',
  jun: 'June',
  jul: 'July',
  aug: 'August',
  sep: 'September',
  oct: 'October',
  nov: 'November',
  dec: 'December',
  acm: 'Association for Computing Machinery',
  ieee: 'Institute of Electrical and Electronics Engineers',
  springer: 'Springer',
  elsevier: 'Elsevier',
  mit: 'MIT Press',
  cups: 'Cambridge University Press',
};

const VENUE_TYPE_BY_ENTRY: Record<string, Venue['type']> = {
  article: 'journal',
  inproceedings: 'conference',
  conference: 'conference',
  book: 'book',
  inbook: 'book',
  incollection: 'book',
  proceedings: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  misc: 'unknown',
  techreport: 'unknown',
  unpublished: 'unknown',
};

interface BibEntry {
  type: string;
  citekey: string;
  fields: Record<string, string>;
}

export interface ParseBibtexResult {
  papers: Paper[];
  errors: string[];
}

function isWhitespace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

function skipWhitespace(text: string, from: number): number {
  let i = from;
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** 读取 { 开头的平衡大括号内容，返回内部文本与结束花括号之后的下标。 */
function readBraced(text: string, start: number): { content: string; endIndex: number } {
  let depth = 1;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(start + 1, i), endIndex: i + 1 };
    }
    i++;
  }
  return { content: text.slice(start + 1), endIndex: text.length };
}

/** 读取 " 开头的引号字符串（花括号内的引号不计为结束）。 */
function readQuoted(text: string, start: number): { content: string; endIndex: number } {
  let depth = 0;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '"' && depth === 0) return { content: text.slice(start + 1, i), endIndex: i + 1 };
    i++;
  }
  return { content: text.slice(start + 1), endIndex: text.length };
}

/** 解析字段值：支持 `{...}`、`"..."`、裸词（数字或 @string 常量）以及 `#` 拼接。
 * 各部分原样拼接（保留 "Deep " 的尾空格），整体解析完再做空白折叠。 */
function readValue(
  text: string,
  start: number,
  strings: Map<string, string>,
): { value: string; endIndex: number } {
  let value = '';
  let i = start;
  while (i < text.length) {
    i = skipWhitespace(text, i);
    const ch = text[i];
    if (ch === '{') {
      const read = readBraced(text, i);
      value += read.content;
      i = read.endIndex;
    } else if (ch === '"') {
      const read = readQuoted(text, i);
      value += read.content;
      i = read.endIndex;
    } else {
      const bare = /^[^\s,#{}"()=]+/.exec(text.slice(i));
      if (!bare) break; // 无法识别的字符，交由上层报错恢复
      const raw = bare[0];
      value += strings.get(raw.toLowerCase()) ?? raw;
      i += raw.length;
    }
    const after = skipWhitespace(text, i);
    if (text[after] === '#') {
      i = after + 1;
      continue;
    }
    i = after;
    break;
  }
  return { value: collapseWhitespace(value), endIndex: i };
}

/** 恢复扫描：跳到下一个字段边界（, 或条目结束符）所在下标；到文件尾返回 -1。 */
function recoverToBoundary(text: string, from: number, close: string): number {
  let depth = 0;
  let inQuote = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i]!;
    // 边界判断必须在大括号计数之前，否则条目结束符 “}” 会被当作普通大括号消耗掉
    if (depth === 0 && !inQuote && (ch === ',' || ch === close)) return i;
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === '"' && depth === 0) inQuote = !inQuote;
  }
  return -1;
}

function parseFields(
  text: string,
  start: number,
  close: string,
  strings: Map<string, string>,
  label: string,
  onError: (message: string) => void,
): { fields: Record<string, string>; endIndex: number; closed: boolean } {
  const fields: Record<string, string> = {};
  let i = skipWhitespace(text, start);
  while (i < text.length) {
    i = skipWhitespace(text, i);
    const ch = text[i]!;
    if (ch === close) return { fields, endIndex: i + 1, closed: true };
    if (ch === ',') {
      i++;
      continue;
    }
    const nameMatch = /^[A-Za-z][A-Za-z0-9_.+\-]*/.exec(text.slice(i));
    if (!nameMatch) {
      onError(`条目 ${label}：无法识别的字段名，已跳过 “${text.slice(i, i + 20).trim()}”`);
      const recovered = recoverToBoundary(text, i, close);
      if (recovered === -1) return { fields, endIndex: text.length, closed: false };
      i = recovered;
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    i = skipWhitespace(text, i + nameMatch[0].length);
    if (text[i] !== '=') {
      onError(`条目 ${label}：字段 ${name} 缺少 “=”`);
      const recovered = recoverToBoundary(text, i, close);
      if (recovered === -1) return { fields, endIndex: text.length, closed: false };
      i = recovered;
      continue;
    }
    i = skipWhitespace(text, i + 1);
    const value = readValue(text, i, strings);
    i = skipWhitespace(text, value.endIndex);
    fields[name] = value.value;
    if (text[i] === ',') {
      i++;
      continue;
    }
    if (text[i] === close) {
      i++;
      return { fields, endIndex: i, closed: true };
    }
    if (i >= text.length) {
      onError(`条目 ${label}：缺少结束符 “${close}”`);
      return { fields, endIndex: i, closed: false };
    }
    onError(`条目 ${label}：字段 ${name} 后存在多余内容，已跳过`);
    const recovered = recoverToBoundary(text, i, close);
    if (recovered === -1) return { fields, endIndex: text.length, closed: false };
    i = recovered;
  }
  if (start < text.length) onError(`条目 ${label}：缺少结束符 “${close}”`);
  return { fields, endIndex: text.length, closed: false };
}

/** 在大括号深度为 0 处按 “ and ”（忽略大小写）切分作者列表。 */
function splitTopLevelAnd(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]!;
    if (ch === '{') depth++;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && /\s/.test(ch)) {
      const m = /^\s+and\s+/i.exec(value.slice(i));
      if (m) {
        parts.push(value.slice(start, i));
        i += m[0].length - 1;
        start = i + 1;
      }
    }
  }
  parts.push(value.slice(start));
  return parts;
}

/**
 * 解析单个作者名：兼容 "Family, Given" 与 "Given ... Family" 两种形式；
 * 剥离保护性大括号；"others" 占位符返回 null。
 */
export function parsePersonName(raw: string): PaperAuthor | null {
  const trimmed = raw.trim();
  // 整体被大括号包裹的机构作者（如 {Barnes and Noble}）：整体作为 family
  if (/^\{[^{}]*\}$/.test(trimmed)) {
    const family = trimmed.slice(1, -1).replace(/\s+/g, ' ').trim();
    return family ? { family } : null;
  }
  const cleaned = trimmed.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
  if (!cleaned || cleaned.toLowerCase() === 'others') return null;
  const commaIndex = cleaned.indexOf(',');
  if (commaIndex >= 0) {
    const family = cleaned.slice(0, commaIndex).trim();
    const given = cleaned
      .slice(commaIndex + 1)
      .replace(/,/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return given ? { family, given } : { family };
  }
  const tokens = cleaned.split(' ');
  const family = tokens[tokens.length - 1] ?? cleaned;
  const given = tokens.slice(0, -1).join(' ').trim();
  return given ? { family, given } : { family };
}

/** 解析 BibTeX author 字段为结构化作者列表。 */
export function parseBibtexAuthors(value: string): PaperAuthor[] {
  return splitTopLevelAnd(value)
    .map(part => parsePersonName(part))
    .filter((author): author is PaperAuthor => author !== null);
}

function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)\s*/i, '');
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function resolveArxivId(fields: Record<string, string>): string | undefined {
  const eprint = fields.eprint?.trim();
  if (!eprint) {
    const m = /arxiv[:\s\-]+(\d{4}\.\d{4,5}(?:v\d+)?)\b/i.exec(
      `${fields.journal ?? ''} ${fields.note ?? ''} ${fields.howpublished ?? ''}`,
    );
    return m ? m[1] : undefined;
  }
  const prefix = (fields.archiveprefix ?? fields.archivePrefix ?? '').toLowerCase();
  const looksLikeArxivId = /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(eprint);
  if (prefix.includes('arxiv') || looksLikeArxivId) return eprint;
  return undefined;
}

function entryToPaper(entry: BibEntry): Paper {
  const f = entry.fields;
  const venueName = f.booktitle ?? f.journal ?? f.publisher ?? f.school ?? f.institution ?? f.howpublished;
  const venue: Venue | undefined = venueName
    ? {
        type: VENUE_TYPE_BY_ENTRY[entry.type] ?? 'unknown',
        name: collapseWhitespace(venueName),
        volume: f.volume,
        issue: f.number,
        pages: f.pages,
      }
    : undefined;
  const yearMatch = /(\d{4})/.exec(f.year ?? '');
  return {
    id: createId(),
    citekey: entry.citekey,
    title: collapseWhitespace(f.title ?? ''),
    authors: parseBibtexAuthors(f.author ?? f.editor ?? ''),
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    venue,
    abstract: f.abstract ? collapseWhitespace(f.abstract) : undefined,
    doi: normalizeDoi(f.doi),
    arxivId: resolveArxivId(f),
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
  };
}

/** 解析 BibTeX 文本为文献列表；坏条目记入 errors。 */
export function parseBibtex(text: string): ParseBibtexResult {
  const papers: Paper[] = [];
  const errors: string[] = [];
  const strings = new Map<string, string>(Object.entries(BUILT_IN_STRINGS));
  let pos = 0;

  while (true) {
    const at = text.indexOf('@', pos);
    if (at === -1) break;
    pos = at + 1;
    const typeMatch = /^[A-Za-z]+/.exec(text.slice(pos));
    if (!typeMatch) {
      errors.push(`第 ${at} 个字符附近：@ 后缺少条目类型`);
      continue;
    }
    const entryType = typeMatch[0].toLowerCase();
    pos = skipWhitespace(text, pos + typeMatch[0].length);
    const open = text[pos];
    if (open !== '{' && open !== '(') {
      errors.push(`@${entryType} 后缺少 “{” 或 “(”`);
      continue;
    }
    const close = open === '{' ? '}' : ')';
    pos++;

    if (entryType === 'comment') {
      // @comment：内容按行注释处理（若有花括号体则跳过整个平衡块）
      if (text[pos] === '{') pos = readBraced(text, pos).endIndex;
      else while (pos < text.length && text[pos] !== '\n') pos++;
      continue;
    }
    if (entryType === 'preamble') {
      const parsed = parseFields(text, pos, close, strings, '@preamble', () => {});
      pos = parsed.endIndex;
      continue;
    }

    if (entryType === 'string') {
      // @string 语法为 “名称 = 取值”（名称后没有逗号），须在读取 citekey 之前处理
      pos = skipWhitespace(text, pos);
      const nameMatch = /^[A-Za-z][A-Za-z0-9_.+\-]*/.exec(text.slice(pos));
      const afterName = skipWhitespace(text, pos + (nameMatch ? nameMatch[0].length : 0));
      if (!nameMatch || text[afterName] !== '=') {
        errors.push('@string 定义缺少 “名称 = 取值”，已跳过');
        const recovered = parseFields(text, pos, close, strings, '@string', () => {});
        pos = recovered.endIndex;
        continue;
      }
      const value = readValue(text, skipWhitespace(text, afterName + 1), strings);
      strings.set(nameMatch[0].toLowerCase(), value.value);
      const boundary = recoverToBoundary(text, value.endIndex, close);
      pos = boundary === -1 ? text.length : text[boundary] === close ? boundary + 1 : boundary;
      continue;
    }

    pos = skipWhitespace(text, pos);
    const keyStart = pos;
    while (pos < text.length && text[pos] !== ',' && text[pos] !== close && !isWhitespace(text[pos])) pos++;
    const citekey = text.slice(keyStart, pos);
    if (text[pos] === ',') pos++;

    const label = citekey || '(缺少 citekey)';
    const parsed = parseFields(text, pos, close, strings, label, message => errors.push(message));
    pos = parsed.endIndex;

    if (!citekey) {
      errors.push('存在缺少 citekey 的条目，已跳过');
      continue;
    }
    if (!parsed.closed) continue; // 未闭合的报错已由 parseFields 记录
    if (!parsed.fields.title) {
      errors.push(`条目 ${citekey}：缺少 title 字段，已跳过`);
      continue;
    }
    papers.push(entryToPaper({ type: entryType, citekey, fields: parsed.fields }));
  }

  return { papers, errors };
}
