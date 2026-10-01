// @vitest-environment jsdom
/**
 * digestStore 单元测试（不真实联网）：
 *  - 订阅 CRUD 与 localStorage 持久化（sf-digest-subs，含模块重载恢复与坏数据兜底）；
 *  - buildDigestSearchQuery 组装（单订阅多词 AND / 多订阅 OR / 引号反斜杠转义 / 空）；
 *  - parseDigestAtom 解析（fixture 含 published/categories/机构作者，风格参考
 *    packages/library 的 search.test.ts）；
 *  - 近三日过滤（滚动 72h 边界）；
 *  - fetchDigest：成功路径（URL 参数 / 排序 / 缓存写入）、无订阅短路、HTTP 失败、
 *    浏览器 fetch 抛错 → 中文跨域提示且保留缓存、桌面 tauri curl 通道（mock）→
 *    再失败中文错误；
 *  - loadCachedDigest 缓存往返与无缓存不动状态。
 * CORS 双通道的平台依赖以 vi.mock 注入（platform/types、platform/tauri），http 全部
 * 用可注入的 HttpFetch 假实现（不依赖全局 fetch / Response）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../platform/types', () => ({
  getPlatform: vi.fn((): { kind: 'browser' | 'tauri' } => ({ kind: 'browser' })),
}));
vi.mock('../platform/tauri', () => ({
  tauriProcRun: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
}));

import {
  DIGEST_CACHE_KEY,
  SUBS_STORAGE_KEY,
  buildDigestSearchQuery,
  filterRecentPapers,
  groupDigestByDate,
  parseDigestAtom,
  readPersistedDigestSubs,
  useDigestStore,
  type DigestCache,
  type DigestPaper,
  type DigestSubscription,
  type HttpFetch,
} from './digestStore';
import { getBigData, setBigData } from '../storage/kvStore';
import { getPlatform } from '../platform/types';
import { tauriProcRun } from '../platform/tauri';

/** 平台形态桩（digestStore 只读 kind 字段）。 */
const browserPlatform = { kind: 'browser' } as unknown as ReturnType<typeof getPlatform>;
const tauriPlatform = { kind: 'tauri' } as unknown as ReturnType<typeof getPlatform>;

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RECENT_WINDOW_MS = 3 * DAY;

/** now 往前 msAgo 毫秒的 ISO 时间戳（保证落入/跳出近三日窗口）。 */
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function sub(id: string, label: string, query: string): DigestSubscription {
  return { id, label, query, createdAt: 1 };
}

function paper(title: string, publishedAt: string, arxivId = '2401.00001'): DigestPaper {
  return {
    title,
    authors: [{ family: 'Zhang', given: 'Wei' }],
    publishedAt,
    arxivId,
    abstract: `Abstract of ${title}.`,
    categories: ['cs.CL'],
  };
}

interface EntrySpec {
  id: string;
  title: string;
  published: string;
  authors?: string[];
  categories?: string[];
  summary?: string;
}

function entryXml(e: EntrySpec): string {
  const authors = (e.authors ?? []).map((a) => `    <author><name>${a}</name></author>`).join('\n');
  const cats = (e.categories ?? []).map((c) => `    <category term="${c}" />`).join('\n');
  return `  <entry>
    <id>${e.id}</id>
    <published>${e.published}</published>
    <title>${e.title}</title>
    <summary>${e.summary ?? ''}</summary>
${authors}
${cats}
  </entry>`;
}

function atomFeed(entries: EntrySpec[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
${entries.map(entryXml).join('\n')}
</feed>`;
}

/** 成功响应（避免依赖测试环境的全局 Response）。 */
function okHttp(xml: string, onUrl?: (url: string) => void): HttpFetch {
  return {
    fetch: async (url) => {
      onUrl?.(url);
      return { ok: true, status: 200, text: async () => xml } as unknown as Response;
    },
  };
}

function failHttp(): HttpFetch {
  return {
    fetch: async () => {
      throw new TypeError('Failed to fetch');
    },
  };
}

function statusHttp(status: number): HttpFetch {
  return {
    fetch: async () => ({ ok: false, status, text: async () => '' }) as unknown as Response,
  };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(getPlatform).mockReturnValue(browserPlatform);
  vi.mocked(tauriProcRun).mockReset().mockResolvedValue({ code: 0, stdout: '', stderr: '' });
  useDigestStore.setState({
    subscriptions: [],
    items: [],
    lastFetchedAt: null,
    loading: false,
    error: null,
  });
});

// ---------------------------------------------------------------------------
// 订阅 CRUD 与持久化
// ---------------------------------------------------------------------------

describe('digestStore · 订阅管理', () => {
  it('addSubscription 添加订阅（空白折叠、label 缺省回落 query）并持久化到 sf-digest-subs', () => {
    const ok = useDigestStore.getState().addSubscription('大语言模型', '  llm   reasoning ');
    expect(ok).toBe(true);
    const subs = useDigestStore.getState().subscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe('大语言模型');
    expect(subs[0].query).toBe('llm reasoning');
    expect(typeof subs[0].id).toBe('string');
    expect(subs[0].createdAt).toBeGreaterThan(0);

    expect(readPersistedDigestSubs()).toHaveLength(1);
    expect(readPersistedDigestSubs()[0].query).toBe('llm reasoning');

    // label 为空时回落为 query
    expect(useDigestStore.getState().addSubscription('', ' diffusion ')).toBe(true);
    expect(useDigestStore.getState().subscriptions[1].label).toBe('diffusion');
  });

  it('addSubscription 拒绝空白关键词：返回 false 且不添加', () => {
    expect(useDigestStore.getState().addSubscription('空', '   ')).toBe(false);
    expect(useDigestStore.getState().addSubscription('空', '')).toBe(false);
    expect(useDigestStore.getState().subscriptions).toHaveLength(0);
    expect(readPersistedDigestSubs()).toHaveLength(0);
  });

  it('removeSubscription 删除对应订阅并同步持久化', () => {
    useDigestStore.getState().addSubscription('a', 'kw one');
    useDigestStore.getState().addSubscription('b', 'kw two');
    const firstId = useDigestStore.getState().subscriptions[0].id;
    useDigestStore.getState().removeSubscription(firstId);
    const rest = useDigestStore.getState().subscriptions;
    expect(rest).toHaveLength(1);
    expect(rest[0].query).toBe('kw two');
    expect(readPersistedDigestSubs()).toHaveLength(1);
    expect(readPersistedDigestSubs()[0].query).toBe('kw two');
  });

  it('模块重载时从 sf-digest-subs 通道恢复订阅', async () => {
    localStorage.setItem(
      SUBS_STORAGE_KEY,
      JSON.stringify({ subscriptions: [sub('s1', '视觉', 'diffusion model')] }),
    );
    vi.resetModules();
    const mod = await import('./digestStore');
    const restored = mod.useDigestStore.getState().subscriptions;
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe('s1');
    expect(restored[0].query).toBe('diffusion model');
  });

  it('持久化数据损坏（坏 JSON / 缺字段条目）时安全回落', async () => {
    localStorage.setItem(SUBS_STORAGE_KEY, '{{{not json');
    vi.resetModules();
    const mod1 = await import('./digestStore');
    expect(mod1.useDigestStore.getState().subscriptions).toEqual([]);

    localStorage.setItem(
      SUBS_STORAGE_KEY,
      JSON.stringify({
        subscriptions: [
          { id: 'bad' }, // 缺 label/query/createdAt
          sub('good', '视觉', 'diffusion model'),
        ],
      }),
    );
    vi.resetModules();
    const mod2 = await import('./digestStore');
    const kept = mod2.useDigestStore.getState().subscriptions;
    expect(kept).toHaveLength(1);
    expect(kept[0].id).toBe('good');
  });
});

// ---------------------------------------------------------------------------
// 查询组装
// ---------------------------------------------------------------------------

describe('digestStore · buildDigestSearchQuery', () => {
  it('单订阅多词 AND 连接（多余空白折叠）', () => {
    expect(buildDigestSearchQuery([sub('s1', '视频生成', 'diffusion  model   video')])).toBe(
      'all:"diffusion" AND all:"model" AND all:"video"',
    );
    expect(buildDigestSearchQuery([sub('s1', '单词', 'transformer')])).toBe('all:"transformer"');
  });

  it('多订阅之间 OR 连接', () => {
    expect(
      buildDigestSearchQuery([sub('s1', 'llm', 'llm reasoning'), sub('s2', 'cv', 'diffusion model')]),
    ).toBe('all:"llm" AND all:"reasoning" OR all:"diffusion" AND all:"model"');
  });

  it('词内引号与反斜杠转义；空输入产出空串', () => {
    expect(buildDigestSearchQuery([sub('s1', '怪词', 'he said "hi"')])).toBe(
      'all:"he" AND all:"said" AND all:"\\"hi\\""',
    );
    expect(buildDigestSearchQuery([sub('s1', '反斜杠', 'a\\b')])).toBe('all:"a\\\\b"');
    expect(buildDigestSearchQuery([])).toBe('');
    expect(buildDigestSearchQuery([sub('s1', '空', '   ')])).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Atom 解析与近三日过滤
// ---------------------------------------------------------------------------

describe('digestStore · parseDigestAtom', () => {
  it('解析 title/authors/published/arxivId/abstract/categories（含机构作者与 Error 占位剔除）', () => {
    const items = parseDigestAtom(
      atomFeed([
        {
          id: 'http://arxiv.org/abs/2303.08774v1',
          title: 'GPT-4 Technical  Report',
          published: '2023-03-14T17:21:20-04:00',
          authors: ['OpenAI', 'Autor, Bete'],
          categories: ['cs.CL', 'cs.AI'],
          summary: 'We report the  development of GPT-4.',
        },
        {
          id: 'http://arxiv.org/abs/1706.03762v7',
          title: 'Attention Is All You Need',
          published: '2017-06-12T15:48:14-04:00',
          authors: ['Vaswani, Ashish'],
          categories: ['cs.CL'],
        },
        {
          id: 'http://arxiv.org/abs/0000.00000',
          title: 'Error',
          published: '2024-01-01T00:00:00Z',
        },
      ]),
    );
    expect(items).toHaveLength(2);
    const first = items[0];
    expect(first.title).toBe('GPT-4 Technical Report'); // 空白折叠
    expect(first.authors).toEqual([{ family: 'OpenAI' }, { family: 'Autor', given: 'Bete' }]);
    expect(first.publishedAt).toBe('2023-03-14T17:21:20-04:00');
    expect(first.arxivId).toBe('2303.08774v1');
    expect(first.abstract).toBe('We report the development of GPT-4.');
    expect(first.categories).toEqual(['cs.CL', 'cs.AI']);
    expect(items[1].abstract).toBeUndefined(); // 空 summary → undefined
  });

  it('filterRecentPapers 只保留近三日（滚动 72h，含边界）', () => {
    const now = Date.now();
    const fresh = paper('Fresh', new Date(now - 2 * DAY).toISOString());
    const edge = paper('Edge', new Date(now - RECENT_WINDOW_MS + 1).toISOString());
    const stale = paper('Stale', new Date(now - RECENT_WINDOW_MS - 1).toISOString());
    const ancient = paper('Ancient', new Date(now - 10 * DAY).toISOString());
    const kept = filterRecentPapers([fresh, stale, edge, ancient], now);
    expect(kept.map((p) => p.title)).toEqual(['Fresh', 'Edge']);
  });

  it('groupDigestByDate 按日期降序分组，组内按时间降序', () => {
    const items = [
      paper('Old-Day-B', iso(2 * DAY + 2 * HOUR)),
      paper('Today-A', iso(1 * HOUR)),
      paper('Old-Day-A', iso(2 * DAY + 5 * HOUR)),
      paper('Today-B', iso(5 * HOUR)),
    ];
    const groups = groupDigestByDate(items);
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((p) => p.title)).toEqual(['Today-A', 'Today-B']);
    // 两天前一组：2d+2h（较新）在 2d+5h（较旧）之前
    expect(groups[1].items.map((p) => p.title)).toEqual(['Old-Day-B', 'Old-Day-A']);
    expect(groups[0].date > groups[1].date).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fetchDigest
// ---------------------------------------------------------------------------

describe('digestStore · fetchDigest', () => {
  it('成功路径：URL 参数正确、近三日过滤、按日期降序、写缓存、更新状态', async () => {
    useDigestStore.setState({ subscriptions: [sub('s1', '视觉', 'diffusion model video')] });
    let calledUrl = '';
    const xml = atomFeed([
      {
        id: 'http://arxiv.org/abs/2401.00002v1',
        title: 'Older But Recent',
        published: iso(6 * HOUR),
        authors: ['Zhang, Wei'],
        categories: ['cs.CV'],
        summary: 'Recent paper.',
      },
      {
        id: 'http://arxiv.org/abs/2401.00003v1',
        title: 'Newest Paper',
        published: iso(1 * HOUR),
        authors: ['Li, Ming'],
        categories: ['cs.CV'],
        summary: 'Newest.',
      },
      {
        id: 'http://arxiv.org/abs/2310.00001v1',
        title: 'Ten Days Ago Paper',
        published: iso(10 * DAY),
        authors: ['Old, One'],
        categories: ['cs.CV'],
        summary: 'Should be filtered out.',
      },
    ]);

    const result = await useDigestStore.getState().fetchDigest(okHttp(xml, (u) => (calledUrl = u)));

    // URL：search_query 编码 + 提交日期降序 + 30 条上限
    expect(calledUrl.startsWith('https://export.arxiv.org/api/query?search_query=')).toBe(true);
    const decoded = decodeURIComponent(calledUrl.split('search_query=')[1].split('&')[0]);
    expect(decoded).toBe('all:"diffusion" AND all:"model" AND all:"video"');
    expect(calledUrl).toContain('sortBy=submittedDate');
    expect(calledUrl).toContain('sortOrder=descending');
    expect(cachedParam(calledUrl, 'max_results')).toBe('30');
    expect(cachedParam(calledUrl, 'start')).toBe('0');

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.items.map((p) => p.title)).toEqual(['Newest Paper', 'Older But Recent']);
    expect(useDigestStore.getState().items).toEqual(result.items);
    expect(useDigestStore.getState().lastFetchedAt).toBe(result.fetchedAt);
    expect(useDigestStore.getState().loading).toBe(false);
    expect(useDigestStore.getState().error).toBeNull();

    // 缓存写入（setBigData 通道）
    const cached = await getBigData<DigestCache>(DIGEST_CACHE_KEY);
    expect(cached?.fetchedAt).toBe(result.fetchedAt);
    expect(cached?.items.map((p) => p.title)).toEqual(['Newest Paper', 'Older But Recent']);
  });

  it('无订阅时短路返回空结果，不发起网络请求', async () => {
    const http = okHttp(atomFeed([]));
    const spy = vi.fn(http.fetch);
    const result = await useDigestStore.getState().fetchDigest({ fetch: spy });
    expect(spy).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.items).toEqual([]);
    expect(useDigestStore.getState().loading).toBe(false);
  });

  it('浏览器形态 fetch 抛错 → ok:false 中文跨域提示，且不清空已有缓存内容', async () => {
    const keep = paper('Cached Paper', iso(3 * HOUR));
    useDigestStore.setState({
      subscriptions: [sub('s1', 'llm', 'llm reasoning')],
      items: [keep],
      lastFetchedAt: 111,
    });
    const result = await useDigestStore.getState().fetchDigest(failHttp());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存');
    expect(useDigestStore.getState().error).toBe(result.error);
    expect(useDigestStore.getState().items).toEqual([keep]);
    expect(useDigestStore.getState().lastFetchedAt).toBe(111);
    expect(useDigestStore.getState().loading).toBe(false);
  });

  it('HTTP 非 200 → ok:false，错误带状态码与中文提示', async () => {
    useDigestStore.setState({ subscriptions: [sub('s1', 'llm', 'llm reasoning')] });
    const result = await useDigestStore.getState().fetchDigest(statusHttp(500));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('HTTP 500');
    expect(result.error).toContain('桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存');
  });

  it('桌面形态：fetch 抛错后改走 tauriProcRun curl 通道并解析 stdout', async () => {
    vi.mocked(getPlatform).mockReturnValue(tauriPlatform);
    const xml = atomFeed([
      {
        id: 'http://arxiv.org/abs/2401.00009v1',
        title: 'Via Curl Paper',
        published: iso(2 * HOUR),
        authors: ['Curl, Works'],
        categories: ['cs.LG'],
        summary: 'Fetched through curl stdout.',
      },
    ]);
    vi.mocked(tauriProcRun).mockResolvedValue({ code: 0, stdout: xml, stderr: '' });
    useDigestStore.setState({ subscriptions: [sub('s1', '视觉', 'diffusion model')] });

    const result = await useDigestStore.getState().fetchDigest(failHttp());

    expect(vi.mocked(tauriProcRun)).toHaveBeenCalledTimes(1);
    const [cmd, args] = vi.mocked(tauriProcRun).mock.calls[0];
    expect(cmd).toBe('curl');
    expect(args).toEqual(['-s', '--max-time', '20', expect.stringContaining('https://export.arxiv.org/api/query')]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.items.map((p) => p.title)).toEqual(['Via Curl Paper']);
    expect(useDigestStore.getState().error).toBeNull();
  });

  it('桌面形态 curl 再失败（非零退出码）→ ok:false 中文错误', async () => {
    vi.mocked(getPlatform).mockReturnValue(tauriPlatform);
    vi.mocked(tauriProcRun).mockResolvedValue({ code: 7, stdout: '', stderr: 'Failed to connect' });
    useDigestStore.setState({ subscriptions: [sub('s1', '视觉', 'diffusion model')] });

    const result = await useDigestStore.getState().fetchDigest(failHttp());

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('curl 退出码 7');
    expect(result.error).toContain('桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存');
  });

  it('桌面形态 curl 抛出异常同样收敛为中文错误', async () => {
    vi.mocked(getPlatform).mockReturnValue(tauriPlatform);
    vi.mocked(tauriProcRun).mockRejectedValue(new Error('桥接不可用'));
    useDigestStore.setState({ subscriptions: [sub('s1', '视觉', 'diffusion model')] });

    const result = await useDigestStore.getState().fetchDigest(failHttp());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('桥接不可用');
    expect(useDigestStore.getState().loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 缓存读取
// ---------------------------------------------------------------------------

describe('digestStore · loadCachedDigest', () => {
  it('读回上次结果：items 与 lastFetchedAt 恢复', async () => {
    const items = [paper('Cached One', iso(1 * HOUR)), paper('Cached Two', iso(2 * HOUR))];
    await setBigData(DIGEST_CACHE_KEY, { fetchedAt: 12345, items });
    useDigestStore.setState({ items: [], lastFetchedAt: null });

    await useDigestStore.getState().loadCachedDigest();

    expect(useDigestStore.getState().items).toEqual(items);
    expect(useDigestStore.getState().lastFetchedAt).toBe(12345);
  });

  it('无缓存时不动内存状态；内存已有更新结果时不被旧缓存覆盖', async () => {
    // 无缓存：模块图整体重载（kvStore/db 全新内存后端），确保缓存确定不存在
    vi.resetModules();
    const fresh = await import('./digestStore');
    const sentinel = [paper('Sentinel', iso(2 * HOUR))];
    fresh.useDigestStore.setState({ items: sentinel, lastFetchedAt: 42 });
    await fresh.useDigestStore.getState().loadCachedDigest();
    expect(fresh.useDigestStore.getState().items).toBe(sentinel);
    expect(fresh.useDigestStore.getState().lastFetchedAt).toBe(42);

    // 已有更新结果：不降级
    await setBigData(DIGEST_CACHE_KEY, { fetchedAt: 1, items: [paper('Old Cache', iso(1 * HOUR))] });
    useDigestStore.setState({ items: [paper('Newer', iso(1 * HOUR))], lastFetchedAt: 99 });
    await useDigestStore.getState().loadCachedDigest();
    expect(useDigestStore.getState().lastFetchedAt).toBe(99);
    expect(useDigestStore.getState().items.map((p) => p.title)).toEqual(['Newer']);
  });
});

/** 提取 URL query 参数（find 参数在 ? 与 # 之间）。 */
function cachedParam(url: string, name: string): string | null {
  const qs = url.split('?')[1] ?? '';
  for (const pair of qs.split('&')) {
    const [k, v] = pair.split('=');
    if (k === name) return v ?? '';
  }
  return null;
}
