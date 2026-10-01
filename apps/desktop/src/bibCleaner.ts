/**
 * Bib 清理向导（纯函数层）：refs.bib 用久了积累的重复 / 缺字段 / 不一致条目的
 * 检测（analyzeBib）与唯一可执行修复——去重保留字段更全条目（applyBibFixes）。
 *
 * 为什么不直接用 parseBibtex（@scholarforge/library）做分析：parseBibtex 面向
 * 「入库」——缺 title 的条目会被整条丢弃、journal/booktitle 被折叠进 venue、
 * 不保留原始字段集合与源码位置。清理场景恰恰要看到这些「坏条目」并在原始文本上
 * 做手术，因此这里自带一套轻量条目块扫描（`@type{key,` 到配对定界符的深度扫描，
 * 与 parseBibtex 的 readBraced 同款先例）：
 *  - 支持 `{...}` 与 `(...)` 两种条目定界；@comment / @preamble / @string 块跳过；
 *  - 字段值支持 {...} / "..." / 裸词三形（`#` 拼接与 @string 宏不做展开，取原文——
 *    对「是否缺字段 / DOI 是否一致」这类检查足够）；
 *  - 坏块（未闭合等）跳过且绝不抛出，容错优先。
 */

/** 一处清理发现：keys = 涉及条目的 citekey；suggestion 缺省表示「仅提示，不自动改」 */
export interface BibIssue {
  kind: 'duplicate' | 'missing-field' | 'inconsistent';
  severity: 'error' | 'warning';
  keys: string[];
  message: string;
  suggestion?: string;
}

/** 原始文本上的一个条目块（from 为 `@` 下标，to 为结束定界符之后） */
export interface RawBibEntry {
  /** 小写条目类型（article / inproceedings / …） */
  type: string;
  citekey: string;
  /** 小写字段名 → 值原文（已 trim；不展开 @string 宏） */
  fields: Record<string, string>;
  from: number;
  to: number;
}

const DEDUPE_SUGGESTION = '合并为一条（建议保留字段更全的 key）';

// ---------------------------------------------------------------------------
// 条目块定位（原始文本手术的基础）
// ---------------------------------------------------------------------------

const ENTRY_TYPE_RE = /^[A-Za-z]+/;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_.+\-]*/;

/** 条目定界符配对扫描：返回与 openIdx 处 `{`/`(` 配对的闭符下标；未闭合返回 -1。
 * 括号条目中，值内花括号保护 `)`（author = {Smith (Jr.)} 不误断）、括号深度 0 处的
 * 引号体内的定界符不计（parseBibtex recoverToBoundary 同款语义）；花括号条目与
 * parseBibtex 的 readBraced 同款纯深度计数。 */
function findEntryEnd(text: string, openIdx: number): number {
  const open = text[openIdx];
  const close = open === '(' ? ')' : '}';
  let depth = 1;
  let brace = 0;
  let inQuote = false;
  for (let i = openIdx + 1; i < text.length; i++) {
    const ch = text[i];
    if (open === '(' && brace === 0 && ch === '"') inQuote = !inQuote;
    if (ch === '{') brace++;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    if (open === '(' && (brace > 0 || inQuote)) continue;
    if (ch === open) depth++;
    else if (ch === close && --depth === 0) return i;
  }
  return -1;
}

/** 读取 `{` 起的平衡花括号内容（parseBibtex readBraced 同款深度计数） */
function readBraced(text: string, start: number): { content: string; endIndex: number } {
  let depth = 1;
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(start + 1, i), endIndex: i + 1 };
    }
    i++;
  }
  return { content: text.slice(start + 1), endIndex: text.length };
}

/** 块内字段解析（启发式，容错优先）：返回字段表与消费到的下标 */
function parseEntryFields(
  text: string,
  start: number,
  end: number,
): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = start;
  const ws = (): void => {
    while (i < end && /\s/.test(text[i]!)) i++;
  };
  ws();
  while (i < end) {
    ws();
    if (i >= end) break;
    const nameMatch = FIELD_NAME_RE.exec(text.slice(i, end));
    if (!nameMatch) {
      // 无法识别的字段名：跳到下一个逗号（值内花括号保护）
      let brace = 0;
      while (i < end) {
        const ch = text[i]!;
        if (ch === '{') brace++;
        else if (ch === '}') brace = Math.max(0, brace - 1);
        else if (ch === ',' && brace === 0) break;
        i++;
      }
      i++; // 吃掉逗号
      continue;
    }
    const name = nameMatch[0].toLowerCase();
    i += nameMatch[0].length;
    ws();
    if (text[i] !== '=') continue;
    i++;
    ws();
    const ch = text[i];
    let value: string;
    if (ch === '{') {
      const read = readBraced(text, i);
      value = read.content;
      i = Math.min(read.endIndex, end);
    } else if (ch === '"') {
      let j = i + 1;
      while (j < end && text[j] !== '"') j++;
      value = text.slice(i + 1, j);
      i = Math.min(j + 1, end);
    } else {
      let j = i;
      while (j < end && !',\n'.includes(text[j]!)) j++;
      value = text.slice(i, j);
      i = j;
    }
    fields[name] = value.replace(/\s+/g, ' ').trim();
    ws();
    if (text[i] === ',') i++;
  }
  return fields;
}

/**
 * 扫描全文条目块。@comment / @preamble / @string 被定位并跳过（不作为条目参与
 * 分析与手术）；无法定位闭合的坏 `@` 蝉联块同样跳过（不抛出）。
 */
export function locateBibEntries(text: string): RawBibEntry[] {
  const entries: RawBibEntry[] = [];
  let pos = 0;
  while (true) {
    const at = text.indexOf('@', pos);
    if (at === -1) break;
    const typeMatch = ENTRY_TYPE_RE.exec(text.slice(at + 1));
    if (!typeMatch) {
      pos = at + 1;
      continue;
    }
    const type = typeMatch[0].toLowerCase();
    let i = at + 1 + typeMatch[0].length;
    while (i < text.length && /\s/.test(text[i]!)) i++;
    const open = text[i];
    if (open !== '{' && open !== '(') {
      pos = at + 1;
      continue;
    }
    const end = findEntryEnd(text, i);
    if (end === -1) {
      pos = i + 1; // 未闭合：跳过该定界符继续找下一个 @
      continue;
    }
    const bodyStart = i + 1;
    pos = end + 1;
    if (type === 'comment' || type === 'preamble' || type === 'string') continue;

    // citekey：到首个逗号 / 定界符 / 空白
    let k = bodyStart;
    while (k < end && text[k] !== ',' && text[k] !== '}' && text[k] !== ')' && !/\s/.test(text[k]!)) k++;
    const citekey = text.slice(bodyStart, k);
    const fields = parseEntryFields(text, text[k] === ',' ? k + 1 : k, end);
    entries.push({ type, citekey, fields, from: at, to: end + 1 });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// 归一化键
// ---------------------------------------------------------------------------

/** DOI 归一化：去 doi.org 前缀 / doi: 前缀与首尾空白（保留大小写——用于「完全相同」判重） */
function stripDoiPrefix(raw: string): string {
  return raw.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)\s*/i, '');
}

/** 判重组（value → 命中条目下标表），只保留 ≥2 的组，按首次出现顺序 */
function groupBy<T>(items: T[], keyOf: (item: T) => string | null): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  items.forEach((item, idx) => {
    const key = keyOf(item);
    if (key === null || key === '') return;
    const list = groups.get(key);
    if (list) list.push(idx);
    else groups.set(key, [idx]);
  });
  for (const [key, list] of groups) if (list.length < 2) groups.delete(key);
  return groups;
}

/** 标题归一化：小写、去全部标点与空白（"Attention Is All You Need!" ≡ "attention is all you need"） */
function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** arXiv ID 提取（parseBibtex resolveArxivId 的简化只读版）：eprint 优先（需
 * archivePrefix 含 arxiv 或形如 2401.12345），否则在 journal/note/howpublished 中找 */
function resolveArxivId(fields: Record<string, string>): string | null {
  const eprint = fields.eprint?.trim();
  if (eprint) {
    const prefix = (fields.archiveprefix ?? '').toLowerCase();
    if (prefix.includes('arxiv') || /^\d{4}\.\d{4,5}(?:v\d+)?$/.test(eprint)) return eprint;
    return null;
  }
  const m = /arxiv[:\s\-]+(\d{4}\.\d{4,5}(?:v\d+)?)\b/i.exec(
    `${fields.journal ?? ''} ${fields.note ?? ''} ${fields.howpublished ?? ''}`,
  );
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// 重复组（analyzeBib 与 applyBibFixes 共用同一判定）
// ---------------------------------------------------------------------------

/** 一组疑似重复：keySetSignature 用于跨依据去重（同组条目 DOI 与标题都相同只报一次） */
interface DupGroup {
  entries: number[];
  basis: 'doi' | 'arxiv' | 'title';
  detail: string;
}

function findDuplicateGroups(entries: RawBibEntry[]): DupGroup[] {
  const groups: DupGroup[] = [];
  const seenSignatures = new Set<string>();
  const push = (idxList: number[], basis: DupGroup['basis'], detail: string): void => {
    const signature = [...idxList].sort((a, b) => a - b).join(',');
    if (seenSignatures.has(signature)) return;
    seenSignatures.add(signature);
    groups.push({ entries: idxList, basis, detail });
  };

  for (const [doi, idxList] of groupBy(entries, (e) => stripDoiPrefix(e.fields.doi ?? '') || null)) {
    push(idxList, 'doi', `DOI 相同：${doi}`);
  }
  for (const [id, idxList] of groupBy(entries, (e) => resolveArxivId(e.fields))) {
    push(idxList, 'arxiv', `arXiv ID 相同：${id}`);
  }
  for (const [title, idxList] of groupBy(entries, (e) => {
    const t = e.fields.title ? normalizeTitle(e.fields.title) : '';
    return t.length >= 8 ? t : null; // 过短标题（如单词）不做标题判重，避免误报
  })) {
    push(idxList, 'title', `标题归一化后相同：${title.slice(0, 40)}`);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// analyzeBib
// ---------------------------------------------------------------------------

/**
 * 分析 Bib 文本，产出三类 issue：
 *  - duplicate（error）：同 DOI / 同 arXiv ID / 标题归一化后相同；suggestion 固定为
 *    「合并为一条（建议保留字段更全的 key）」——唯一可由 applyBibFixes 执行的修复；
 *  - missing-field（warning）：@article 缺 journal / 缺 year、条目缺 author、
 *    有形如 10.xxxx 的 doi 但缺 title；
 *  - inconsistent（warning）：同一 DOI 大小写混用；camel 与 colon 两种 citekey
 *    风格并存且条目总数 > 3。
 * 顺序稳定：先 error（重复组按出现顺序），后 warning（按条目位置）。
 * 坏文本不抛出——只分析能定位的条目块。
 */
export function analyzeBib(bibText: string): BibIssue[] {
  const entries = locateBibEntries(bibText);
  const issues: BibIssue[] = [];

  // —— 重复（error）——
  for (const group of findDuplicateGroups(entries)) {
    issues.push({
      kind: 'duplicate',
      severity: 'error',
      keys: group.entries.map((i) => entries[i]!.citekey),
      message: `疑似重复（${group.detail}）`,
      suggestion: DEDUPE_SUGGESTION,
    });
  }

  // —— 缺字段（warning，按条目位置）——
  for (const entry of entries) {
    const key = entry.citekey || '(缺少 citekey)';
    if (entry.type === 'article') {
      if (!entry.fields.journal) {
        issues.push({
          kind: 'missing-field',
          severity: 'warning',
          keys: [key],
          message: `条目 ${key}（@article）缺少 journal 字段（期刊文章应标注期刊名）`,
        });
      }
      if (!entry.fields.year) {
        issues.push({
          kind: 'missing-field',
          severity: 'warning',
          keys: [key],
          message: `条目 ${key}（@article）缺少 year 字段（出版年份用于引用排序与筛选）`,
        });
      }
    }
    if (!entry.fields.author) {
      issues.push({
        kind: 'missing-field',
        severity: 'warning',
        keys: [key],
        message: `条目 ${key} 缺少 author 字段（无法生成作者-年份引用）`,
      });
    }
    const doi = stripDoiPrefix(entry.fields.doi ?? '');
    if (/^10\.\S+/i.test(doi) && !entry.fields.title) {
      issues.push({
        kind: 'missing-field',
        severity: 'warning',
        keys: [key],
        message: `条目 ${key} 有 DOI（${doi}）但缺少 title 字段`,
        suggestion: '补全 title 后重新入库（解析器会跳过无 title 条目）',
      });
    }
  }

  // —— 不一致（warning）——
  // 同一 DOI 大小写混用：大小写不敏感分组后组内出现 ≥2 种原文写法
  for (const [, idxList] of groupBy(entries, (e) => {
    const doi = stripDoiPrefix(e.fields.doi ?? '');
    return doi ? doi.toLowerCase() : null;
  })) {
    const forms = [...new Set(idxList.map((i) => stripDoiPrefix(entries[i]!.fields.doi ?? '')))];
    if (forms.length >= 2) {
      issues.push({
        kind: 'inconsistent',
        severity: 'warning',
        keys: idxList.map((i) => entries[i]!.citekey),
        message: `同一 DOI 大小写混用：${forms.join(' 与 ')}`,
        suggestion: 'DOI 不区分大小写，建议统一为小写写法',
      });
    }
  }
  // citekey 风格混杂：camel（vaswani2017attention）与 colon（vaswani:2017:attention）并存超 3 条
  const camelKeys: string[] = [];
  const colonKeys: string[] = [];
  for (const entry of entries) {
    if (!entry.citekey) continue;
    if (entry.citekey.includes(':')) colonKeys.push(entry.citekey);
    else camelKeys.push(entry.citekey);
  }
  if (camelKeys.length > 0 && colonKeys.length > 0 && camelKeys.length + colonKeys.length > 3) {
    issues.push({
      kind: 'inconsistent',
      severity: 'warning',
      keys: [...camelKeys.slice(0, 4), ...colonKeys.slice(0, 4)],
      message: `citekey 风格混杂：camel 风格 ${camelKeys.length} 条（如 ${camelKeys[0]}）与 colon 风格 ${colonKeys.length} 条（如 ${colonKeys[0]}）并存`,
      suggestion: '统一为一种 citekey 风格（colon 风格为 citekey 生成器默认格式）',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// applyBibFixes（唯一可执行动作：去重保留字段更全条目）
// ---------------------------------------------------------------------------

export type BibFixAction = 'dedupe-keep-fuller';

/**
 * 去重执行：同组重复保留字段数最多的条目（平手保留首个），其余整条删除。
 * 文本手术在原始文本上做：删除区间 = 条目块 `[from, to)` 向前扩展吃掉紧邻的
 * 纯空白（把条目间的空行一并清掉，避免残留连续空行），条目之后的内容原样保留。
 * 返回新文本与被删条目的 citekey（按出现顺序）。无重复时原样返回、removed 为空。
 */
export function applyBibFixes(
  bibText: string,
  action: BibFixAction,
): { text: string; removed: string[] } {
  void action; // 当前唯一动作 'dedupe-keep-fuller'；保留参数位以便未来扩展
  const entries = locateBibEntries(bibText);
  const groups = findDuplicateGroups(entries);

  // 每条目只属于一个判重组（findDuplicateGroups 已按签名去重，但同一条目可能
  // 出现在不同签名的两组——如 A、B 同 DOI，B、C 同标题：A/B 组与 B/C 组。
  // 处理：按组序处理，已被更早组保留/删除的条目不再影响后续组的选择）
  const keep = new Set<number>();
  const drop = new Set<number>();
  for (const group of groups) {
    const alive = group.entries.filter((i) => !keep.has(i) && !drop.has(i));
    if (alive.length < 2) {
      // 组内其余条目已在更早组处置过：仅确保至少有一条被保留
      const representative = group.entries.find((i) => !drop.has(i));
      if (representative !== undefined) keep.add(representative);
      continue;
    }
    let best = alive[0]!;
    for (const i of alive.slice(1)) {
      if (Object.keys(entries[i]!.fields).length > Object.keys(entries[best]!.fields).length) best = i;
    }
    keep.add(best);
    for (const i of alive) if (i !== best) drop.add(i);
  }
  if (drop.size === 0) return { text: bibText, removed: [] };

  // 删除区间：[向前吃掉的空白起点, 条目块终点)，按起点排序后拼接保留段。
  // 条目间的分隔空白随被删条目一并吃掉——衔接由被删条目「之后」的分隔空白承担，
  // 典型 `}\n\n@b\n\n@c` 删 b 后仍是 `}\n\n@c`；文件头部条目则顺带吃掉其后空白。
  const spans = [...drop]
    .sort((a, b) => a - b)
    .map((i) => {
      const entry = entries[i]!;
      let start = entry.from;
      while (start > 0 && /\s/.test(bibText[start - 1]!)) start--;
      let end = entry.to;
      if (start === 0) {
        // 文件头部条目：其后空白一并吃掉，避免结果以空行开头
        while (end < bibText.length && /\s/.test(bibText[end]!)) end++;
      }
      return { start, end, citekey: entry.citekey };
    });

  const parts: string[] = [];
  let cursor = 0;
  const removed: string[] = [];
  for (const span of spans) {
    if (span.start < cursor) continue; // 防御：交叠区间跳过（理论不可达）
    parts.push(bibText.slice(cursor, span.start));
    cursor = span.end;
    removed.push(span.citekey);
  }
  parts.push(bibText.slice(cursor));
  return { text: parts.join(''), removed };
}

// ---------------------------------------------------------------------------
// 预览统计（向导 diff 预览用）
// ---------------------------------------------------------------------------

/** 行级多重集差异：added = 新文本多出的行数，removed = 旧文本多出的行数（去重只删行 → added 恒 0） */
export function diffLineStats(oldText: string, newText: string): { added: number; removed: number } {
  const count = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const line of text.split('\n')) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const oldCounts = count(oldText);
  const newCounts = count(newText);
  let added = 0;
  let removed = 0;
  for (const [line, n] of oldCounts) {
    const diff = n - (newCounts.get(line) ?? 0);
    if (diff > 0) removed += diff;
  }
  for (const [line, n] of newCounts) {
    const diff = n - (oldCounts.get(line) ?? 0);
    if (diff > 0) added += diff;
  }
  return { added, removed };
}
