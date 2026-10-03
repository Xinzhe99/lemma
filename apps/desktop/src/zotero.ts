/**
 * Zotero 生态迁移（WF：第一天迁移成本清零）——解析 / 匹配纯函数层。
 *
 *  - parseZoteroJson：Better BibTeX JSON（Zotero 右键集合 → Export → Better BibTeX JSON）
 *    → { papers, collections, errors }。宽容解析：坏条目跳过并计入 errors、不中断后续
 *    条目；附件（attachment/note）静默跳过；文件尾部的集合元数据条目（无 title、
 *    collections 为 {key,name,parent} 对象数组）提取为 ZoteroCollection 而非报错；
 *  - collectionTree / collectionNamesFor：集合层级缩进树 与 key → 名称列表（含祖先链，
 *    供「zotero:<集合名>」tag 展示/过滤）；
 *  - matchPdfToPaper：本地 PDF 文件名 ↔ 文献 title/citekey 的启发式匹配（归一化 +
 *    包含 + 编辑距离评分，阈值可配置）；
 *  - readFileArrayBuffer：File → ArrayBuffer（优先 Blob.arrayBuffer，回退 FileReader）。
 *
 * UI 接线在 panels/LibraryPanel.tsx（「Zotero JSON」导入对话框 + 「PDF 目录」批量关联
 * 对话框）；入库复用 libraryStore.importHit（citekey 入库时生成消歧）。
 */

import { createId, type Paper, type PaperAuthor, type Venue } from '@lemma/shared';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** Zotero 集合（key 为 Zotero 集合 key；parent 为父集合 key，缺省为顶层）。 */
export interface ZoteroCollection {
  key: string;
  name: string;
  parent?: string;
}

/** Zotero 条目 → Paper（citekey 留空，入库时经 importHit 生成）+ 所属集合 key 列表。 */
export interface ZoteroPaper extends Paper {
  collectionKeys: string[];
}

export interface ParseZoteroResult {
  papers: ZoteroPaper[];
  collections: ZoteroCollection[];
  errors: string[];
}

/** 集合树节点：按 parent 链展开后的缩进深度（顶层 0）。 */
export interface CollectionTreeNode {
  key: string;
  name: string;
  depth: number;
}

/** 文件名匹配结果（score ∈ [0,1]，越高越可信）。 */
export interface PdfMatchResult {
  paperId: string;
  score: number;
}

/** 集合名写入 Paper.tags 时的前缀（文献库过滤器 tag: 前缀天然可用，无 schema 侵入）。 */
export const ZOTERO_TAG_PREFIX = 'zotero:';

/** matchPdfToPaper 默认阈值：≥ 该分数才认为匹配成立。 */
export const DEFAULT_PDF_MATCH_THRESHOLD = 0.65;

// ---------------------------------------------------------------------------
// 宽容取值 helper
// ---------------------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 非字符串 / 空白串 → undefined；否则返回 trim 后的值。 */
function asTrimmedString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t : undefined;
}

// ---------------------------------------------------------------------------
// 字段归一化
// ---------------------------------------------------------------------------

const VENUE_TYPE_BY_ITEM_TYPE: Record<string, Venue['type']> = {
  journalArticle: 'journal',
  magazineArticle: 'journal',
  newspaperArticle: 'journal',
  proceedingsArticle: 'conference',
  conferencePaper: 'conference',
  preprint: 'preprint',
  manuscript: 'preprint',
  book: 'book',
  bookSection: 'book',
  dictionaryEntry: 'book',
  encyclopediaArticle: 'book',
  thesis: 'thesis',
};

/** Zotero itemType → 本库 venue.type；未列出的类型（document/report/webpage…）按 unknown。 */
export function zoteroVenueType(itemType: string): Venue['type'] {
  return VENUE_TYPE_BY_ITEM_TYPE[itemType] ?? 'unknown';
}

/** arXiv ID 形态：新式 2303.08774[.v2] / 旧式 hep-th/9901001、cs.CL/0101200。 */
const ARXIV_ID_RE = /^(?:\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{6,8})$/i;

/** 从 extra 文本中提取 `arXiv: <id>`（大小写/冒号后空格宽容；非法形态忽略）。 */
export function extractArxivId(text: string): string | undefined {
  const m = /(?:^|\n)\s*arxiv\s*[:=]?\s*(\S+)/i.exec(text);
  const raw = m?.[1];
  if (!raw) return undefined;
  const id = raw.replace(/[.,;)\]]+$/, '');
  return ARXIV_ID_RE.test(id) ? id : undefined;
}

/** 归一化 arxivId 字段：剥掉 arXiv: 前缀 / abs 链接；非法形态忽略。 */
function normalizeArxiv(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw
    .trim()
    .replace(/^arxiv\s*:\s*/i, '')
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '');
  return ARXIV_ID_RE.test(t) ? t : undefined;
}

/** DOI 归一化：剥掉 https://doi.org/ 前缀与 doi: 前缀，统一小写。 */
function normalizeDoi(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '');
  return t ? t.toLowerCase() : undefined;
}

// ---------------------------------------------------------------------------
// 条目映射
// ---------------------------------------------------------------------------

/**
 * creators → authors：lastName/firstName → family/given；机构作者（无 lastName、
 * 仅有 name 字段）fallback 为 { family: name }。优先取 creatorType 为 author（或缺省）
 * 的创作者；一个 author 都没有时（全部为 editor 等）宽容取全部。
 */
function parseCreators(raw: unknown): PaperAuthor[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.filter(isRecord);
  const mapped = entries.map((e): PaperAuthor | null => {
    const family = asTrimmedString(e.lastName);
    const given = asTrimmedString(e.firstName);
    if (family) return { family, given };
    const name = asTrimmedString(e.name);
    return name ? { family: name } : null;
  });
  const authors = mapped.filter((_, i) => {
    const type = asTrimmedString(entries[i]!.creatorType)?.toLowerCase();
    return type === undefined || type === 'author';
  });
  const pickFrom = authors.length > 0 ? authors : mapped;
  return pickFrom.filter((a): a is PaperAuthor => a !== null);
}

function parseTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const tags: string[] = [];
  for (const t of raw) {
    const v = typeof t === 'string' ? t.trim() : isRecord(t) ? asTrimmedString(t.tag) : undefined;
    if (v) tags.push(v);
  }
  return tags;
}

/** 条目的 collections 字段（key 字符串数组；宽容接受 {key} 对象）→ key 列表。 */
function parseCollectionKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const keys: string[] = [];
  for (const col of raw) {
    const v = typeof col === 'string' ? col.trim() : isRecord(col) ? asTrimmedString(col.key) : undefined;
    if (v) keys.push(v);
  }
  return keys;
}

function itemToZoteroPaper(entry: Record<string, unknown>): ZoteroPaper {
  const itemType = asTrimmedString(entry.itemType) ?? 'journalArticle';
  const venueType = zoteroVenueType(itemType);
  const venueName =
    asTrimmedString(entry.publicationTitle) ??
    asTrimmedString(entry.proceedingsTitle) ??
    asTrimmedString(entry.bookTitle) ??
    asTrimmedString(entry.repository);
  const dateStr = asTrimmedString(entry.date) ?? asTrimmedString(entry.issueDate);
  const yearMatch = dateStr ? /(\d{4})/.exec(dateStr) : null;

  return {
    id: createId(),
    citekey: '', // 留空：入库时经 importHit 生成并消歧
    title: asTrimmedString(entry.title) ?? '',
    authors: parseCreators(entry.creators),
    year: yearMatch ? Number(yearMatch[1]) : undefined,
    venue:
      venueName || venueType !== 'unknown'
        ? { type: venueType, name: venueName }
        : undefined,
    abstract: asTrimmedString(entry.abstract) ?? asTrimmedString(entry.abstractNote),
    doi: normalizeDoi(asTrimmedString(entry.DOI) ?? asTrimmedString(entry.doi)),
    arxivId:
      normalizeArxiv(asTrimmedString(entry.arxivId)) ??
      extractArxivId(asTrimmedString(entry.extra) ?? ''),
    tags: parseTags(entry.tags),
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
    collectionKeys: parseCollectionKeys(entry.collections),
  };
}

// ---------------------------------------------------------------------------
// 集合元数据
// ---------------------------------------------------------------------------

/**
 * 从 collections 字段提取集合对象（{key,name,parent?}）。返回是否至少识别出一个
 * 合法集合（用于区分「尾部元数据条目」与「坏条目」）。重复 key 只保留首个。
 */
function harvestCollections(raw: unknown, into: ZoteroCollection[], seen: Set<string>): boolean {
  if (!Array.isArray(raw)) return false;
  let found = false;
  for (const col of raw) {
    if (!isRecord(col)) continue;
    const key = asTrimmedString(col.key);
    const name = asTrimmedString(col.name);
    if (!key || !name || seen.has(key)) continue;
    seen.add(key);
    const parent = asTrimmedString(col.parent);
    into.push(parent ? { key, name, parent } : { key, name });
    found = true;
  }
  return found;
}

// ---------------------------------------------------------------------------
// parseZoteroJson
// ---------------------------------------------------------------------------

/**
 * 解析 Better BibTeX JSON 文本。根节点宽容接受数组（常见形态）或
 * { items: [...], collections: [...] } 对象；附件条目与笔记静默跳过；无 title 且
 * 无集合对象的条目计入 errors；JSON 非法时返回单条错误、papers 为空。
 */
export function parseZoteroJson(text: string): ParseZoteroResult {
  const papers: ZoteroPaper[] = [];
  const collections: ZoteroCollection[] = [];
  const errors: string[] = [];
  const seenCollections = new Set<string>();

  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return {
      papers,
      collections,
      errors: [`JSON 解析失败：${e instanceof Error ? e.message : String(e)}`],
    };
  }

  let entries: unknown[];
  if (Array.isArray(root)) {
    entries = root;
  } else if (isRecord(root) && Array.isArray(root.items)) {
    entries = root.items;
    harvestCollections(root.collections, collections, seenCollections);
  } else if (
    isRecord(root) &&
    (root.itemType !== undefined || root.title !== undefined || root.collections !== undefined)
  ) {
    entries = [root]; // 单条目对象形态（宽容）
  } else {
    return {
      papers,
      collections,
      errors: ['无法识别的 Better BibTeX JSON 结构（根节点应为条目数组或 { items, collections }）'],
    };
  }

  entries.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`第 ${index + 1} 条不是对象，已跳过`);
      return;
    }
    const itemType = (asTrimmedString(entry.itemType) ?? '').toLowerCase();
    // 附件 / 笔记 / 标注条目：Zotero 导出常伴随，静默跳过（不计错误）
    if (itemType === 'attachment' || itemType === 'note' || itemType === 'annotation') return;

    if (!asTrimmedString(entry.title)) {
      // 尾部集合元数据条目（无 itemType/title，collections 为 {key,name} 对象数组）
      if (harvestCollections(entry.collections, collections, seenCollections)) return;
      const key = asTrimmedString(entry.key);
      errors.push(`第 ${index + 1} 条缺少 title${key ? `（key: ${key}）` : ''}，已跳过`);
      return;
    }
    papers.push(itemToZoteroPaper(entry));
  });

  return { papers, collections, errors };
}

// ---------------------------------------------------------------------------
// 集合结构
// ---------------------------------------------------------------------------

/**
 * 按 parent 链展开为缩进树（深度优先，兄弟保持原顺序）：
 * 顶层 depth=0，子集合 depth=parent+1；parent 指向不存在 key 的按顶层处理；
 * 环等极端输入保证每个集合恰好出现一次（未从根触达的平铺补在尾部）。
 */
export function collectionTree(collections: ZoteroCollection[]): CollectionTreeNode[] {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const childrenOf = new Map<string, ZoteroCollection[]>();
  const roots: ZoteroCollection[] = [];
  for (const col of collections) {
    if (col.parent && byKey.has(col.parent)) {
      const list = childrenOf.get(col.parent) ?? [];
      list.push(col);
      childrenOf.set(col.parent, list);
    } else {
      roots.push(col);
    }
  }

  const out: CollectionTreeNode[] = [];
  const visited = new Set<string>();
  const walk = (col: ZoteroCollection, depth: number): void => {
    if (visited.has(col.key)) return;
    visited.add(col.key);
    out.push({ key: col.key, name: col.name, depth });
    for (const child of childrenOf.get(col.key) ?? []) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  for (const col of collections) walk(col, 0); // 环 / 断链兜底：恰好一次
  return out;
}

/**
 * 条目的集合 key → 名称列表（含沿 parent 链的祖先名称：Zotero 子集合内的条目
 * 过滤父集合 tag 时也能命中）。未知 key 跳过（导出缺尾部元数据时不污染 tag），
 * 同名去重、保持首次出现顺序。
 */
export function collectionNamesFor(keys: string[], collections: ZoteroCollection[]): string[] {
  const byKey = new Map(collections.map((c) => [c.key, c]));
  const names: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    let cur = byKey.get(key);
    let guard = 0; // 环防御
    while (cur && !seen.has(cur.name) && guard < 64) {
      seen.add(cur.name);
      names.push(cur.name);
      cur = cur.parent ? byKey.get(cur.parent) : undefined;
      guard += 1;
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// PDF 文件名 ↔ 文献匹配
// ---------------------------------------------------------------------------

/** 归一化：小写、去 .pdf 扩展名、去全部非字母数字（连字符/空格/下划线/标点）字符。 */
function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.pdf$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** 经典两行 DP 编辑距离（输入为归一化后的短字符串）。 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}

/** 编辑距离相似度 ∈ [0,1]。 */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function titleScore(file: string, title: string): number {
  if (file === title) return 1; // 精确标题
  if (title.length >= 4 && file.includes(title)) return 0.9; // 标题 + 年份等后缀
  if (file.length >= 4 && title.includes(file)) return 0.75; // 文件名为标题片段
  return similarity(file, title); // 兜底编辑距离（拼写差异等）
}

function citekeyScore(file: string, key: string): number {
  if (file === key) return 0.95;
  if (key.length >= 4 && file.includes(key)) return 0.85;
  if (file.length >= 4 && key.includes(file)) return 0.7;
  return similarity(file, key) * 0.9; // citekey 相似度打折：词根撞车更常见
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * 将 PDF 文件名匹配到库内文献：对每篇取 title/citekey 两个维度的最高分，
 * 全库取最高分候选；低于阈值返回 null。评分（见 titleScore/citekeyScore）：
 * 精确相等 1 / 0.95，包含（年份后缀等）0.9 / 0.85，被包含 0.75 / 0.7，
 * 否则编辑距离相似度。多候选同分取先出现者（稳定）。
 */
export function matchPdfToPaper(
  pdfName: string,
  papers: Paper[],
  threshold: number = DEFAULT_PDF_MATCH_THRESHOLD,
): PdfMatchResult | null {
  const file = normalizeForMatch(pdfName);
  if (!file) return null;
  let best: PdfMatchResult | null = null;
  for (const paper of papers) {
    const title = normalizeForMatch(paper.title);
    const key = normalizeForMatch(paper.citekey);
    let score = 0;
    if (title) score = titleScore(file, title);
    if (key) score = Math.max(score, citekeyScore(file, key));
    if (score > (best?.score ?? 0)) best = { paperId: paper.id, score: round3(score) };
  }
  return best !== null && best.score >= threshold ? best : null;
}

// ---------------------------------------------------------------------------
// 文件读取（唯一的 I/O helper：批量关联时 File → ArrayBuffer）
// ---------------------------------------------------------------------------

/** 读取 File 为 ArrayBuffer：优先 Blob.arrayBuffer()，缺失时回退 FileReader。 */
export function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error(`读取文件失败：${file.name}`));
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// 入库查重
// ---------------------------------------------------------------------------

/**
 * 文献身份键：doi > arxivId > 小写标题。用于 Zotero 导入时与库内及本批次
 * 已导入条目查重（重复跳过）。
 */
export function paperIdentity(p: { doi?: string; arxivId?: string; title: string }): string {
  if (p.doi) return `doi:${p.doi.trim().toLowerCase()}`;
  if (p.arxivId) return `arxiv:${p.arxivId.trim().toLowerCase()}`;
  return `title:${p.title.trim().toLowerCase()}`;
}
