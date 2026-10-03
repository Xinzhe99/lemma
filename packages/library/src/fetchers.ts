import { XMLParser } from 'fast-xml-parser';
import { createId, type Paper, type PaperAuthor, type Venue } from '@lemma/shared';
import { parsePersonName } from './importers/bibtex';

/** 可注入的 HTTP 客户端（便于测试与平台适配）。 */
export interface Http {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

const defaultHttp: Http = {
  fetch: (url, init) => {
    // 15s 超时：外网 API（arXiv/Crossref）卡死时及时返回错误而非无限等待
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    return fetch(url, { ...init, signal: init?.signal ?? controller.signal }).finally(() => clearTimeout(timer));
  },
};

const CROSSREF_VENUE_TYPE: Record<string, Venue['type']> = {
  'journal-article': 'journal',
  'proceedings-article': 'conference',
  book: 'book',
  'book-chapter': 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-entry': 'book',
  'posted-content': 'preprint',
  dissertation: 'thesis',
  report: 'unknown',
};

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function stripHtmlTags(html: string): string {
  return collapseWhitespace(
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;|&apos;/g, "'"),
  );
}

type XmlObj = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asContent(value: unknown): string | undefined {
  const direct = asString(value);
  if (direct !== undefined) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return asString((value as Record<string, unknown>)['#text']);
  }
  return undefined;
}

export { collapseWhitespace, stripHtmlTags, asArray, asString, asContent, parseArxivEntry };
export type { XmlObj };
export { CROSSREF_VENUE_TYPE };

interface CrossrefMessage {
  DOI?: string;
  type?: string;
  title?: string[];
  author?: { given?: string; family?: string; ORCID?: string; name?: string }[];
  'container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
  volume?: string;
  issue?: string;
  page?: string;
  abstract?: string;
}

/** 通过 DOI 从 Crossref 拉取题录并映射为 Paper（citekey 留空，由宿主生成）。 */
export async function fetchByDoi(doi: string, http: Http = defaultHttp): Promise<Paper> {
  const normalized = doi.trim().replace(/^(https?:\/\/(dx\.)?doi\.org\/|doi:)\s*/i, '');
  if (!normalized) throw new Error('DOI 不能为空');
  const url = `https://api.crossref.org/works/${encodeURIComponent(normalized)}`;
  let response: Response;
  try {
    response = await http.fetch(url, { headers: { Accept: 'application/json' } });
  } catch (cause) {
    throw new Error(`Crossref 网络请求失败（DOI: ${normalized}）`, { cause });
  }
  if (!response.ok) {
    throw new Error(`Crossref 请求失败：HTTP ${response.status}（DOI: ${normalized}）`);
  }
  const json = (await response.json()) as { message?: CrossrefMessage };
  const message = json.message;
  if (!message) throw new Error(`Crossref 返回内容缺少 message 字段（DOI: ${normalized}）`);

  const authors: PaperAuthor[] = asArray(message.author)
    .map(entry => {
      if (entry.family || entry.given) {
        const orcid = entry.ORCID?.replace(/^https?:\/\/orcid\.org\//, '');
        return { family: entry.family ?? '', given: entry.given, ...(orcid ? { orcid } : {}) };
      }
      return entry.name ? { family: entry.name } : null; // 机构作者：整名作 family
    })
    .filter((author): author is PaperAuthor => author !== null);

  const year = message.issued?.['date-parts']?.[0]?.[0];
  const containerName = asArray(message['container-title'])[0];

  return {
    id: createId(),
    citekey: '',
    title: collapseWhitespace(asArray(message.title)[0] ?? normalized),
    authors,
    year,
    venue: containerName
      ? {
          type: CROSSREF_VENUE_TYPE[message.type ?? ''] ?? 'unknown',
          name: containerName,
          volume: message.volume,
          issue: message.issue,
          pages: message.page,
        }
      : undefined,
    abstract: message.abstract ? stripHtmlTags(message.abstract) : undefined,
    doi: (message.DOI ?? normalized).toLowerCase(),
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
  };
}

function parseArxivEntry(xml: string): XmlObj | undefined {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@' });
  const parsed = parser.parse(xml) as XmlObj;
  const feed = parsed['feed'] as XmlObj | undefined;
  const entry = feed?.['entry'];
  if (!entry || typeof entry !== 'object') return undefined;
  const obj = entry as XmlObj;
  // arXiv 对非法 ID 会返回 title 为 "Error" 的占位条目
  if (asString(obj['title'])?.trim().toLowerCase() === 'error') return undefined;
  return obj;
}

/** 通过 arXiv ID 拉取题录（Atom XML）并映射为 Paper（citekey 留空，由宿主生成）。 */
export async function fetchByArxiv(id: string, http: Http = defaultHttp): Promise<Paper> {
  const normalized = id.trim().replace(/^arxiv:/i, '');
  if (!normalized) throw new Error('arXiv ID 不能为空');
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(normalized)}`;
  let response: Response;
  try {
    response = await http.fetch(url, { headers: { Accept: 'application/atom+xml' } });
  } catch (cause) {
    throw new Error(`arXiv 网络请求失败（ID: ${normalized}）`, { cause });
  }
  if (!response.ok) {
    throw new Error(`arXiv 请求失败：HTTP ${response.status}（ID: ${normalized}）`);
  }
  const entry = parseArxivEntry(await response.text());
  if (!entry) throw new Error(`arXiv 未返回有效条目（ID: ${normalized}）`);

  const authors: PaperAuthor[] = asArray(
    entry['author'] as { name?: unknown } | { name?: unknown }[] | undefined,
  )
    .map(author => asContent(author?.name))
    .filter((name): name is string => !!name)
    .map(name => parsePersonName(name))
    .filter((author): author is PaperAuthor => author !== null);

  const tags: string[] = [];
  for (const category of asArray(
    entry['category'] as { '@term'?: unknown } | { '@term'?: unknown }[] | undefined,
  )) {
    const term = asString(category?.['@term']);
    if (term) tags.push(term);
  }

  const idUrl = asContent(entry['id']) ?? normalized;
  const arxivId = /\/abs\/([^/?#]+)/.exec(idUrl)?.[1] ?? normalized;
  const published = asContent(entry['published']) ?? '';
  const year = Number(published.slice(0, 4));

  return {
    id: createId(),
    citekey: '',
    title: collapseWhitespace(asContent(entry['title']) ?? normalized),
    authors,
    year: published.length >= 4 && Number.isFinite(year) ? year : undefined,
    venue: { type: 'preprint', name: 'arXiv' },
    abstract: collapseWhitespace(asContent(entry['summary']) ?? '') || undefined,
    doi: asContent(entry['arxiv:doi'])?.toLowerCase(),
    arxivId,
    tags,
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
  };
}
