/**
 * arXiv 每日晨报状态引擎（设计 D-6「每天打开」习惯闭环）：
 *  - 订阅：用户研究方向的关键词串（如 "diffusion model video"），小数据持久化到
 *    localStorage（key: sf-digest-subs）；
 *  - 拉取：合并全部订阅为单一 search_query（订阅内多词 AND、多订阅间 OR），调
 *    arXiv API（sortBy=submittedDate 降序取 30 条）；此处自实现 Atom 解析而非复用
 *    searchArxiv——晨报需要 <published> 发表时间做近三日过滤与日期分组；
 *  - 过滤分组：只保留最近 3 天发表的论文，按发表日期降序排序/分组；
 *  - 缓存：结果经 setBigData 写入（key: sf-digest-cache），loadCachedDigest 读回，
 *    上次结果离线可见；
 *  - CORS 双通道：默认浏览器 fetch 直连（arXiv 不给 CORS 头时抛错）；捕获后若为
 *    桌面形态（getPlatform().kind === 'tauri'）改走 tauriProcRun('curl', ...) 解析
 *    stdout；仍失败返回中文提示（浏览器版受跨域限制，显示上次缓存）。
 */

import { create } from 'zustand';
import { XMLParser } from 'fast-xml-parser';
import { createId, type PaperAuthor } from '@scholarforge/shared';
import { parsePersonName } from '@scholarforge/library';
import { getBigData, setBigData } from '../storage/kvStore';
import { getPlatform } from '../platform/types';
import { tauriProcRun } from '../platform/tauri';

/** 订阅持久化键（localStorage，小数据）。 */
export const SUBS_STORAGE_KEY = 'sf-digest-subs';
/** 晨报结果缓存键（setBigData / getBigData，大数据走 IndexedDB）。 */
export const DIGEST_CACHE_KEY = 'sf-digest-cache';

/** arXiv API 拉取上限。 */
const MAX_RESULTS = 30;
/** 只保留最近 3 天发表的论文（按 published 时间戳滚动窗口）。 */
const RECENT_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

/** 浏览器版拉取失败时的固定中文提示（验收文案）。 */
export const DIGEST_BROWSER_LIMIT_HINT = '桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存';

/** 可注入的 HTTP 客户端（与 @scholarforge/library 的 Http 同构，便于测试）。 */
export interface HttpFetch {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

const defaultHttpFetch: HttpFetch = {
  fetch: (url, init) => fetch(url, init),
};

/** 一条晨报订阅：label 是人读名，query 是关键词串（空格分隔多词）。 */
export interface DigestSubscription {
  id: string;
  label: string;
  query: string;
  createdAt: number;
}

/** 晨报里的一条新论文（自解析 Atom，含发表时间——PaperSearchHit 不带该字段）。 */
export interface DigestPaper {
  title: string;
  authors: PaperAuthor[];
  /** Atom <published>（ISO 8601） */
  publishedAt: string;
  arxivId?: string;
  abstract?: string;
  categories: string[];
}

/** 拉取结果：成功带条目与时间戳；失败带中文错误（含浏览器跨域提示）。 */
export type DigestResult =
  | { ok: true; items: DigestPaper[]; fetchedAt: number }
  | { ok: false; error: string };

/** 结果缓存的持久化形状。 */
export interface DigestCache {
  fetchedAt: number;
  items: DigestPaper[];
}

/** 按日期分组的一组论文（date 为本地时区 YYYY-MM-DD）。 */
export interface DigestDayGroup {
  date: string;
  items: DigestPaper[];
}

// ---------------------------------------------------------------------------
// 持久化：订阅（localStorage 小数据）
// ---------------------------------------------------------------------------

function isSubscription(value: unknown): value is DigestSubscription {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === 'string' &&
    s.id !== '' &&
    typeof s.label === 'string' &&
    typeof s.query === 'string' &&
    s.query.trim() !== '' &&
    typeof s.createdAt === 'number' &&
    Number.isFinite(s.createdAt)
  );
}

function readPersisted(): DigestSubscription[] {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(SUBS_STORAGE_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw) as { subscriptions?: unknown };
    if (!v || !Array.isArray(v.subscriptions)) return [];
    return v.subscriptions.filter(isSubscription);
  } catch {
    return [];
  }
}

const initialSubscriptions = readPersisted();

// ---------------------------------------------------------------------------
// 纯函数：查询组装 / Atom 解析 / 过滤排序分组
// ---------------------------------------------------------------------------

/** arXiv 短语内的引号与反斜杠转义（词本身含 " 或 \ 时）。 */
function escapeArxivTerm(word: string): string {
  return word.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * 订阅列表 → arXiv search_query：
 *  - 订阅内多词 AND：`all:"kw1" AND all:"kw2"`（arXiv 中 AND 优先级高于 OR，
 *    与直觉的括号语义一致）；
 *  - 多订阅之间 OR 连接；
 *  - 全部为空（无订阅 / query 全空白）时返回空串。
 */
export function buildDigestSearchQuery(subscriptions: DigestSubscription[]): string {
  const clauses: string[] = [];
  for (const sub of subscriptions) {
    const words = sub.query.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    clauses.push(words.map((w) => `all:"${escapeArxivTerm(w)}"`).join(' AND '));
  }
  return clauses.join(' OR ');
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** XML 文本节点：字符串直取，对象取 '#text'（fast-xml-parser 混合内容的两种形态）。 */
function asContent(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct !== undefined) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return asString((value as Record<string, unknown>)['#text']);
  }
  return undefined;
}

/** 解析 arXiv Atom feed 为晨报条目（文档序；过滤与排序由调用方负责）。 */
export function parseDigestAtom(xml: string): DigestPaper[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const feed = parsed['feed'] as Record<string, unknown> | undefined;
  const entries = feed ? asArray(feed['entry'] as unknown) : [];

  const items: DigestPaper[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;

    const title = collapseWhitespace(asContent(entry['title']) ?? '');
    // arXiv 对非法查询会返回 title 为 "Error" 的占位条目
    if (!title || title.toLowerCase() === 'error') continue;

    const publishedAt = collapseWhitespace(asContent(entry['published']) ?? '');
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) continue;

    const authors = asArray(entry['author'] as { name?: unknown } | { name?: unknown }[])
      .map((author) => asContent((author as { name?: unknown })?.name))
      .filter((name): name is string => !!name)
      .map((name) => parsePersonName(name))
      .filter((author): author is PaperAuthor => author !== null);

    const categories: string[] = [];
    for (const category of asArray(
      entry['category'] as { '@term'?: unknown } | { '@term'?: unknown }[],
    )) {
      const term = asString((category as { '@term'?: unknown })?.['@term']);
      if (term) categories.push(term);
    }

    const idUrl = asContent(entry['id']) ?? '';
    const arxivId = /\/abs\/([^/?#]+)/.exec(idUrl)?.[1];

    items.push({
      title,
      authors,
      publishedAt,
      arxivId,
      abstract: collapseWhitespace(asContent(entry['summary']) ?? '') || undefined,
      categories,
    });
  }
  return items;
}

/** 只保留最近 3 天发表的论文（滚动 72h 窗口；容许小幅未来时间戳的时钟偏差）。 */
export function filterRecentPapers(items: DigestPaper[], now: number = Date.now()): DigestPaper[] {
  return items.filter((item) => {
    const t = Date.parse(item.publishedAt);
    return Number.isFinite(t) && now - t <= RECENT_WINDOW_MS;
  });
}

/** 按发表时间降序排序（返回新数组）。 */
export function sortDigestByPublished(items: DigestPaper[]): DigestPaper[] {
  return [...items].sort(
    (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 本地时区日期键（YYYY-MM-DD，分组标题与「今天」判定用）。 */
export function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 按发表日期降序分组：组间按日期降序、组内按时间降序。 */
export function groupDigestByDate(items: DigestPaper[]): DigestDayGroup[] {
  const byDate = new Map<string, DigestPaper[]>();
  for (const item of items) {
    const t = Date.parse(item.publishedAt);
    if (!Number.isFinite(t)) continue;
    const key = localDateKey(new Date(t));
    const bucket = byDate.get(key);
    if (bucket) bucket.push(item);
    else byDate.set(key, [item]);
  }
  return [...byDate.entries()]
    .map(([date, group]) => ({ date, items: sortDigestByPublished(group) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------------------------------------------------------------------------
// 拉取：fetch →（桌面）curl 双通道
// ---------------------------------------------------------------------------

function digestFetchUrl(searchQuery: string): string {
  return (
    `${ARXIV_API_URL}?search_query=${encodeURIComponent(searchQuery)}` +
    `&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${MAX_RESULTS}`
  );
}

function digestFetchErrorMessage(e: unknown): string {
  const cause = e instanceof Error ? e.message : String(e);
  return `晨报拉取失败：${cause}。${DIGEST_BROWSER_LIMIT_HINT}。`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface DigestState {
  subscriptions: DigestSubscription[];
  items: DigestPaper[];
  lastFetchedAt: number | null;
  loading: boolean;
  error: string | null;
  addSubscription(label: string, query: string): boolean;
  removeSubscription(id: string): void;
  fetchDigest(http?: HttpFetch): Promise<DigestResult>;
  loadCachedDigest(): Promise<void>;
}

export const useDigestStore = create<DigestState>()((set, get) => ({
  subscriptions: initialSubscriptions,
  items: [],
  lastFetchedAt: null,
  loading: false,
  error: null,

  addSubscription(label, query) {
    const q = query.trim().replace(/\s+/g, ' ');
    if (!q) return false;
    const sub: DigestSubscription = {
      id: createId(),
      label: label.trim() || q,
      query: q,
      createdAt: Date.now(),
    };
    set((s) => ({ subscriptions: [...s.subscriptions, sub] }));
    return true;
  },

  removeSubscription(id) {
    set((s) => ({ subscriptions: s.subscriptions.filter((sub) => sub.id !== id) }));
  },

  async fetchDigest(http = defaultHttpFetch) {
    const searchQuery = buildDigestSearchQuery(get().subscriptions);
    if (!searchQuery) return { ok: true, items: [], fetchedAt: Date.now() };

    const url = digestFetchUrl(searchQuery);
    set({ loading: true, error: null });
    try {
      let xml: string;
      try {
        const response = await http.fetch(url, { headers: { Accept: 'application/atom+xml' } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        xml = await response.text();
      } catch (browserError) {
        // 浏览器直连失败（无 CORS 头 / 断网）：桌面形态改走 curl 通道
        if (getPlatform().kind !== 'tauri') throw browserError;
        const out = await tauriProcRun('curl', ['-s', '--max-time', '20', url]);
        if (out.code !== 0 || !out.stdout.trim()) {
          throw new Error(`curl 退出码 ${out.code}${out.stderr ? `：${out.stderr.slice(0, 200)}` : ''}`);
        }
        xml = out.stdout;
      }

      const items = sortDigestByPublished(filterRecentPapers(parseDigestAtom(xml)));
      const fetchedAt = Date.now();
      set({ items, lastFetchedAt: fetchedAt, loading: false, error: null });
      void setBigData(DIGEST_CACHE_KEY, { fetchedAt, items });
      return { ok: true, items, fetchedAt };
    } catch (e) {
      const error = digestFetchErrorMessage(e);
      // 失败不清空 items——上次缓存继续可见
      set({ loading: false, error });
      return { ok: false, error };
    }
  },

  async loadCachedDigest() {
    let cached: DigestCache | undefined;
    try {
      cached = await getBigData<DigestCache>(DIGEST_CACHE_KEY);
    } catch {
      return; // 缓存读取失败：静默保持内存态
    }
    if (!cached || !Array.isArray(cached.items)) return;
    const items = cached.items;
    const fetchedAt = typeof cached.fetchedAt === 'number' ? cached.fetchedAt : 0;
    // 正在拉取 / 内存里已有更新结果时不用旧缓存覆盖
    set((s) =>
      s.loading || (s.lastFetchedAt !== null && s.lastFetchedAt >= fetchedAt)
        ? s
        : { items, lastFetchedAt: fetchedAt > 0 ? fetchedAt : null },
    );
  },
}));

// 订阅持久化（小数据 localStorage；失败静默）
useDigestStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SUBS_STORAGE_KEY, JSON.stringify({ subscriptions: s.subscriptions }));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});

/** 读取当前持久化的订阅（测试与调试用）。 */
export function readPersistedDigestSubs(): DigestSubscription[] {
  return readPersisted();
}
