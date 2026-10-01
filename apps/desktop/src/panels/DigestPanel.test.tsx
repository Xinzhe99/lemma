// @vitest-environment jsdom
/**
 * DigestPanel 组件测试。测试环境说明同 libraryRis.test.tsx：mock zustand 为仅依赖
 * 本包 react@18 的等价实现。晨报的网络动作（loadCachedDigest / fetchDigest）以
 * setState 覆写为受控 mock（不真实联网），入库走真实 libraryStore.importHit。
 * 覆盖验收路径：
 *  - 空订阅引导文案 + 两个示例订阅一键添加（持久化到 sf-digest-subs，挂载时不发起请求）；
 *  - 添加输入框（label + query）新增订阅、删除按钮移除，均同步持久化；
 *  - 挂载即 loadCachedDigest 渲染缓存：按日期降序分组、今天标记、标题/arXiv 链接/
 *    作者前 3/分类 chips/摘要折叠；
 *  - 【加入文献库】→ importHit 映射入库（arxivId/year/tags），按钮变「已入库」且防重复；
 *  - 拉取失败：顶部小字中文提示，缓存内容仍可见；en 语言字典切换。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  interface Listener {
    (state: unknown, prev: unknown): void;
  }
  function impl<S extends object>(init: (set: unknown, get: unknown) => S) {
    let state: S;
    const listeners = new Set<Listener>();
    const setState = (partial: Partial<S> | ((s: S) => Partial<S>)) => {
      const patch = typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial;
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    };
    const getState = () => state;
    const subscribe = (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    state = init(setState, getState);
    const useStore = <T,>(selector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => selector(state),
        () => selector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

import { DigestPanel } from './DigestPanel';
import {
  SUBS_STORAGE_KEY,
  localDateKey,
  useDigestStore,
  type DigestPaper,
  type DigestResult,
  type DigestSubscription,
} from '../state/digestStore';
import { useLibraryStore } from '../state/libraryStore';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// 用本地时区的「今天」构造，避免 UTC+8 深夜时 toISOString 落到昨天导致「今天标记」测试跨日翻转
const localIsoToday = (hoursAgo: number) => {
  const d = new Date();
  d.setHours(d.getHours() - hoursAgo, d.getMinutes(), d.getSeconds(), d.getMilliseconds());
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000Z`;
};
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const isoTodayLocal = (hoursAgo: number) => localIsoToday(hoursAgo);

const PAPER_TODAY: DigestPaper = {
  title: 'Video Diffusion Transformers',
  authors: [
    { family: 'Ho', given: 'Jonathan' },
    { family: 'Chan', given: 'William' },
    { family: 'Saharia', given: 'Chitwan' },
    { family: 'Extra', given: 'Author' },
  ],
  publishedAt: isoTodayLocal(2),
  arxivId: '2610.01234v1',
  abstract: 'We introduce a video diffusion transformer for long-horizon generation.',
  categories: ['cs.CV', 'cs.LG'],
};

const PAPER_TWO_DAYS_AGO: DigestPaper = {
  title: 'LLM Reasoning Survey',
  authors: [{ family: 'Zhang', given: 'Wei' }],
  publishedAt: iso(2 * DAY + 3 * HOUR),
  arxivId: '2609.09999v1',
  abstract: 'A survey of reasoning in large language models.',
  categories: ['cs.CL'],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let mockLoadCached: ReturnType<typeof vi.fn>;
let mockFetchDigest: ReturnType<typeof vi.fn>;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function query(selector: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(selector);
}

function queryAll(selector: string): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>(selector)];
}

function btnByClass(cls: string): HTMLButtonElement {
  const found = container!.querySelector<HTMLButtonElement>(`button.${cls}`);
  if (!found) throw new Error(`button not found: ${cls}`);
  return found;
}

function readPersistedSubs(): DigestSubscription[] {
  const raw = localStorage.getItem(SUBS_STORAGE_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as { subscriptions?: DigestSubscription[] };
    return Array.isArray(v.subscriptions) ? v.subscriptions : [];
  } catch {
    return [];
  }
}

/** 挂载面板并等挂载副作用（缓存读回 + 静默刷新）的微任务排空。 */
async function mount() {
  await act(async () => {
    root!.render(<DigestPanel />);
  });
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  useLibraryStore.setState({ papers: [], pdfAttachments: {}, indexReady: true });

  mockLoadCached = vi.fn(async () => {});
  mockFetchDigest = vi.fn(async () =>
    ({ ok: true, items: [], fetchedAt: Date.now() }) satisfies DigestResult,
  );
  useDigestStore.setState({
    subscriptions: [],
    items: [],
    lastFetchedAt: null,
    loading: false,
    error: null,
    loadCachedDigest: mockLoadCached as never,
    fetchDigest: mockFetchDigest as never,
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('DigestPanel', () => {
  it('空订阅显示引导文案与两个示例订阅；挂载不发起请求；示例一键添加并持久化、触发静默刷新', async () => {
    await mount();

    expect(query('.sf-digest-empty')?.textContent).toContain('添加你的研究方向关键词，每天打开即见新论文');
    const examples = queryAll('.sf-digest-example').map((b) => b.textContent ?? '');
    expect(examples.some((t) => t.includes('大语言模型') && t.includes('llm reasoning'))).toBe(true);
    expect(examples.some((t) => t.includes('计算机视觉') && t.includes('diffusion model'))).toBe(true);
    // 无订阅：挂载即读缓存，但不发起网络刷新
    expect(mockLoadCached).toHaveBeenCalledTimes(1);
    expect(mockFetchDigest).not.toHaveBeenCalled();

    click(btnByClass('sf-digest-example'));
    const subs = useDigestStore.getState().subscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0].query).toBe('llm reasoning');
    expect(readPersistedSubs()[0].query).toBe('llm reasoning');
    // 添加订阅后立即静默拉取一次
    await act(async () => {});
    expect(mockFetchDigest).toHaveBeenCalledTimes(1);
  });

  it('添加输入框（label + query）新增订阅并持久化；删除按钮移除并同步持久化', async () => {
    await mount();

    type(query('.sf-digest-input-label') as HTMLInputElement, '多模态');
    type(query('.sf-digest-input-query') as HTMLInputElement, 'multimodal  agent');
    click(btnByClass('sf-digest-add-btn'));

    const subs = useDigestStore.getState().subscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0].label).toBe('多模态');
    expect(subs[0].query).toBe('multimodal agent'); // 空白折叠
    const row = query('.sf-digest-sub');
    expect(row?.textContent).toContain('多模态');
    expect(row?.textContent).toContain('multimodal agent');
    expect(readPersistedSubs()).toHaveLength(1);
    expect(readPersistedSubs()[0].query).toBe('multimodal agent');

    // 空关键词被拒绝并提示
    click(btnByClass('sf-digest-add-btn'));
    expect(query('.sf-digest-add-hint')?.textContent).toContain('请先填写关键词');
    expect(useDigestStore.getState().subscriptions).toHaveLength(1);

    // 删除
    click(query('.sf-digest-sub-del') as HTMLElement);
    expect(useDigestStore.getState().subscriptions).toHaveLength(0);
    expect(query('.sf-digest-sub')).toBeNull();
    expect(readPersistedSubs()).toHaveLength(0);
  });

  it('挂载即 loadCachedDigest 渲染缓存：按日期降序分组、今天标记、标题链接/作者前3/分类chips/摘要折叠', async () => {
    mockLoadCached = vi.fn(async () => {
      useDigestStore.setState({
        items: [PAPER_TWO_DAYS_AGO, PAPER_TODAY],
        lastFetchedAt: Date.now() - 5 * 60_000,
      });
    });
    useDigestStore.setState({ loadCachedDigest: mockLoadCached as never });
    await mount();

    expect(mockLoadCached).toHaveBeenCalledTimes(1);
    expect(query('.sf-digest-fetchedat')?.textContent).toContain('上次更新');

    // 分组：今天在最前，其次两天前
    const heads = queryAll('.sf-digest-day-head').map((h) => h.textContent ?? '');
    const todayKey = localDateKey(new Date());
    const twoDaysAgoKey = localDateKey(new Date(Date.now() - 2 * DAY - 3 * HOUR));
    expect(heads).toHaveLength(2);
    expect(heads[0]).toContain('今天');
    expect(heads[0]).toContain(todayKey);
    expect(heads[1]).toContain(twoDaysAgoKey);

    // 今天那组的条目
    const firstDay = queryAll('.sf-digest-day')[0];
    const title = firstDay.querySelector<HTMLAnchorElement>('.sf-digest-item-title');
    expect(title?.textContent).toBe('Video Diffusion Transformers');
    expect(title?.tagName).toBe('A');
    expect(title?.getAttribute('href')).toBe('https://arxiv.org/abs/2610.01234v1');

    // 作者前 3 + 「等」；第 4 位不显示
    const authors = firstDay.querySelector('.sf-digest-item-authors')?.textContent ?? '';
    expect(authors).toContain('Jonathan Ho');
    expect(authors).toContain('William Chan');
    expect(authors).toContain('Chitwan Saharia');
    expect(authors).toContain('等');
    expect(authors).not.toContain('Extra');

    // 分类 chips 与摘要折叠
    const chips = [...firstDay.querySelectorAll('.sf-digest-item-chips .sf-chip')].map(
      (c) => c.textContent,
    );
    expect(chips).toEqual(['cs.CV', 'cs.LG']);
    const details = firstDay.querySelector('details.sf-digest-abstract');
    expect(details?.querySelector('summary')?.textContent).toContain('摘要');
    expect(details?.querySelector('p')?.textContent).toContain('video diffusion transformer');
  });

  it('【加入文献库】映射 PaperSearchHit → importHit 入库；按钮变「已入库」且防重复', async () => {
    mockLoadCached = vi.fn(async () => {
      useDigestStore.setState({ items: [PAPER_TODAY] });
    });
    useDigestStore.setState({ loadCachedDigest: mockLoadCached as never });
    await mount();

    const importBtn = btnByClass('sf-digest-import');
    expect(importBtn.textContent?.trim()).toBe('加入文献库');
    expect(importBtn.disabled).toBe(false);

    click(importBtn);
    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe('Video Diffusion Transformers');
    expect(papers[0].arxivId).toBe('2610.01234v1');
    expect(papers[0].venue).toEqual({ type: 'preprint', name: 'arXiv' });
    expect(papers[0].year).toBe(new Date().getFullYear());
    expect(papers[0].tags).toEqual(['cs.CV', 'cs.LG']);
    expect(papers[0].citekey.length).toBeGreaterThan(0);

    // 按钮变「已入库」并禁用；再次点击不重复入库
    expect(importBtn.textContent?.trim()).toBe('已入库');
    expect(importBtn.disabled).toBe(true);
    click(importBtn);
    expect(useLibraryStore.getState().papers).toHaveLength(1);
  });

  it('拉取失败：顶部小字中文提示（含浏览器跨域说明），缓存内容仍可见', async () => {
    useDigestStore.setState({
      subscriptions: [{ id: 's1', label: 'llm', query: 'llm reasoning', createdAt: 1 }],
    });
    mockLoadCached = vi.fn(async () => {
      useDigestStore.setState({ items: [PAPER_TODAY], lastFetchedAt: 1000 });
    });
    mockFetchDigest = vi.fn(async () => {
      const error = '晨报拉取失败：TypeError: Failed to fetch。桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存。';
      // 面板错误提示读取 store.error——mock 同步模拟真实 fetchDigest 的失败落态
      useDigestStore.setState({ error, loading: false });
      return { ok: false, error } satisfies DigestResult;
    });
    useDigestStore.setState({
      loadCachedDigest: mockLoadCached as never,
      fetchDigest: mockFetchDigest as never,
    });
    await mount();

    expect(mockFetchDigest).toHaveBeenCalledTimes(1);
    const err = query('.sf-digest-error');
    expect(err?.textContent).toContain('桌面版可正常拉取；浏览器版受跨域限制，显示上次缓存');
    // 缓存内容不被失败清空
    expect(queryAll('.sf-digest-item').length).toBe(1);
    expect(query('.sf-digest-item-title')?.textContent).toBe('Video Diffusion Transformers');
  });

  it('en 语言渲染英文文案', async () => {
    useSettingsStore.setState({ language: 'en' });
    await mount();

    expect(query('.sf-digest-empty')?.textContent).toContain(
      'Add keywords for your research direction',
    );
    expect(query('.sf-digest-add-btn')?.textContent?.trim()).toBe('Add');
    expect(query('.sf-digest-refresh')?.textContent?.trim()).toBe('Refresh');
  });
});
