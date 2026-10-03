/**
 * 文献发现：arXiv + Crossref 聚合检索（设计 4.1 D-1）。
 * 返回 PaperSearchHit 供 UI 展示与一键入库；fetch 可注入便于测试。
 */

import { XMLParser } from 'fast-xml-parser';
import type { Paper, PaperAuthor } from '@lemma/shared';
import { parsePersonName } from './importers/bibtex';
import {
  asArray,
  asContent,
  asString,
  collapseWhitespace,
  stripHtmlTags,
  CROSSREF_VENUE_TYPE,
  type Http,
} from './fetchers';

export interface PaperSearchHit {
  source: 'arxiv' | 'crossref';
  title: string;
  authors: PaperAuthor[];
  year?: number;
  venue?: Paper['venue'];
  abstract?: string;
  doi?: string;
  arxivId?: string;
  tags: string[];
}

const defaultHttp: Http = {
  fetch: (url, init) => fetch(url, init),
};

/** 检索词 → arXiv API 的 search_query（单词 all: 前缀 AND 连接） */
export function buildArxivQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `all:${word}`)
    .join('+AND+');
}

/** arXiv Atom 检索。返回按相关性排序的命中。 */
export async function searchArxiv(
  query: string,
  http: Http = defaultHttp,
  limit = 10,
): Promise<PaperSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('检索词不能为空');
  const url = `https://export.arxiv.org/api/query?search_query=${buildArxivQuery(
    trimmed,
  )}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`;

  let response: Response;
  try {
    response = await http.fetch(url, { headers: { Accept: 'application/atom+xml' } });
  } catch (cause) {
    throw new Error('arXiv 检索请求失败（浏览器直连可能受跨域限制）', { cause });
  }
  if (!response.ok) throw new Error(`arXiv 检索失败：HTTP ${response.status}`);

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
  const parsed = parser.parse(await response.text()) as Record<string, unknown>;
  const feed = parsed['feed'] as Record<string, unknown> | undefined;
  const entries = feed ? asArray(feed['entry'] as unknown) : [];

  const hits: PaperSearchHit[] = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Record<string, unknown>;
    const title = collapseWhitespace(asContent(entry['title']) ?? '');
    if (!title || title.toLowerCase() === 'error') continue;

    const authors = asArray(entry['author'] as { name?: unknown } | { name?: unknown }[] | undefined)
      .map((author) => asContent((author as { name?: unknown })?.name))
      .filter((name): name is string => !!name)
      .map((name) => parsePersonName(name))
      .filter((author): author is PaperAuthor => author !== null);

    const tags: string[] = [];
    for (const category of asArray(
      entry['category'] as { '@term'?: unknown } | { '@term'?: unknown }[] | undefined,
    )) {
      const term = asString((category as { '@term'?: unknown })?.['@term']);
      if (term) tags.push(term);
    }

    const idUrl = asContent(entry['id']) ?? '';
    const arxivId = /\/abs\/([^/?#]+)/.exec(idUrl)?.[1];
    const published = asContent(entry['published']) ?? '';
    const yearNum = Number(published.slice(0, 4));

    hits.push({
      source: 'arxiv',
      title,
      authors,
      year: published.length >= 4 && Number.isFinite(yearNum) ? yearNum : undefined,
      venue: { type: 'preprint', name: 'arXiv' },
      abstract: collapseWhitespace(asContent(entry['summary']) ?? '') || undefined,
      doi: asContent(entry['arxiv:doi'])?.toLowerCase(),
      arxivId,
      tags,
    });
  }
  return hits;
}

interface CrossrefWork {
  DOI?: string;
  type?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  'container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
  abstract?: string;
}

/** Crossref 关键词检索。 */
export async function searchCrossref(
  query: string,
  http: Http = defaultHttp,
  limit = 10,
): Promise<PaperSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) throw new Error('检索词不能为空');
  const url = `https://api.crossref.org/works?query=${encodeURIComponent(
    trimmed,
  )}&rows=${limit}&select=DOI,type,title,author,container-title,issued,abstract`;

  let response: Response;
  try {
    response = await http.fetch(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new Error('Crossref 检索请求失败', { cause });
  }
  if (!response.ok) throw new Error(`Crossref 检索失败：HTTP ${response.status}`);

  const json = (await response.json()) as { message?: { items?: CrossrefWork[] } };
  const items = json.message?.items ?? [];

  return items
    .filter((item) => asArray(item.title)[0])
    .map((item) => {
      const authors = asArray(item.author)
        .map((entry) => {
          if (entry.family || entry.given) return { family: entry.family ?? '', given: entry.given };
          return entry.name ? { family: entry.name } : null;
        })
        .filter((author): author is PaperAuthor => author !== null);
      const year = item.issued?.['date-parts']?.[0]?.[0];
      const containerName = asArray(item['container-title'])[0];
      return {
        source: 'crossref' as const,
        title: stripHtmlTags(asArray(item.title)[0] ?? ''),
        authors,
        year,
        venue: containerName
          ? {
              type: CROSSREF_VENUE_TYPE[item.type ?? ''] ?? 'unknown',
              name: containerName,
            }
          : undefined,
        abstract: item.abstract ? stripHtmlTags(item.abstract) : undefined,
        doi: item.DOI?.toLowerCase(),
        tags: [],
      };
    });
}

/** 合并去重：doi 优先，其次 arxivId，再次小写标题。 */
export function mergeSearchHits(hits: PaperSearchHit[]): PaperSearchHit[] {
  const seenDoi = new Set<string>();
  const seenArxiv = new Set<string>();
  const seenTitle = new Set<string>();
  const out: PaperSearchHit[] = [];
  for (const hit of hits) {
    if (hit.doi) {
      if (seenDoi.has(hit.doi)) continue;
      seenDoi.add(hit.doi);
    } else if (hit.arxivId) {
      if (seenArxiv.has(hit.arxivId)) continue;
      seenArxiv.add(hit.arxivId);
    } else {
      const titleKey = hit.title.toLowerCase();
      if (seenTitle.has(titleKey)) continue;
      seenTitle.add(titleKey);
    }
    out.push(hit);
  }
  return out;
}
