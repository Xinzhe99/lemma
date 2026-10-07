// @vitest-environment jsdom
/**
 * 嵌入配置订阅回归（v7.8.0）：
 *  1. 给「已激活服务」补填 / 更换 API Key（或 BaseURL）后必须重选嵌入源并重建索引——
 *     此前只比较 embeddingModel / activeProviderId，这类改动不生效，本会话一直停在本地哈希；
 *  2. 嵌入模型名是逐字符写入 store 的，连续变更必须在 250ms 合并窗口内只重建一次
 *     （每次重建都会发一轮嵌入请求，逐字符各发一轮既费流量又把索引态翻成 api-fallback）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';
import { initLibrary, resetLibraryCaches, useLibraryStore } from './libraryStore';
import { useSettingsStore, type ProviderConfig } from './settingsStore';
import { __resetKvStoreForTests } from '../storage/kvStore';

const PROVIDER: ProviderConfig = {
  id: 'embed-cfg',
  label: 'EmbedCfg',
  baseUrl: 'https://embed.test/v1',
  apiKey: '',
  model: 'chat-m',
  tier: 'cheap',
};

function makePaper(): Paper {
  return {
    id: 'p1',
    citekey: 'cfg2024',
    title: 'Embedding Configuration Test',
    authors: [{ family: 'Zhang', given: 'San' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    abstract:
      'We study embedding configuration changes and index rebuild scheduling for local retrieval. The abstract is long enough to produce several chunks for the retriever.',
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 嵌入服务 mock：记录每次请求的批数（= 一次 rebuild 的嵌入请求次数）。 */
let embedRequests = 0;
function stubEmbeddingFetch(): void {
  embedRequests = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[] };
      const input = body.input ?? [];
      embedRequests += 1;
      return {
        ok: true,
        json: async () => ({ data: input.map((_, i) => ({ index: i, embedding: [0.1, 0.2] })) }),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  __resetKvStoreForTests();
  stubEmbeddingFetch();
  useLibraryStore.setState({ papers: [makePaper()], pdfAttachments: {}, indexMode: 'hash' });
  useSettingsStore.setState({
    providers: [{ ...PROVIDER }],
    activeProviderId: PROVIDER.id,
    embeddingModel: 'emb-1',
  });
  resetLibraryCaches(); // 丢弃 beforeEach 设置变更排入的合并窗口（各用例自行时序）
});

afterEach(() => {
  resetLibraryCaches();
  vi.unstubAllGlobals();
});

describe('嵌入配置变更 → 重选嵌入源并重建索引', () => {
  it('给已激活服务补填 API Key 后本会话即切到语义嵌入（无需改模型/重启）', async () => {
    await initLibrary(); // Key 为空 → 本地哈希
    expect(useLibraryStore.getState().indexMode).toBe('hash');
    expect(embedRequests).toBe(0);

    useSettingsStore.getState().updateProvider(PROVIDER.id, { apiKey: 'sk-test' });
    await sleep(400);

    expect(useLibraryStore.getState().indexMode).toBe('api');
    expect(embedRequests).toBeGreaterThan(0);
  });

  it('更换已激活服务的 BaseURL 同样触发重选与重建', async () => {
    useSettingsStore.getState().updateProvider(PROVIDER.id, { apiKey: 'sk-test' });
    await initLibrary();
    expect(useLibraryStore.getState().indexMode).toBe('api');
    const before = embedRequests;

    useSettingsStore.getState().updateProvider(PROVIDER.id, { baseUrl: 'https://embed2.test/v1' });
    await sleep(400);

    expect(embedRequests).toBeGreaterThan(before);
  });

  it('连续修改嵌入模型名只重建一次（250ms 合并窗口）', async () => {
    useSettingsStore.getState().updateProvider(PROVIDER.id, { apiKey: 'sk-test' });
    await initLibrary();
    expect(useLibraryStore.getState().indexMode).toBe('api');
    embedRequests = 0;

    const setModel = useSettingsStore.getState().setEmbeddingModel;
    setModel('emb-2');
    setModel('emb-3');
    setModel('emb-4');
    setModel('emb-5');
    await sleep(400);

    expect(embedRequests).toBe(1);
    expect(useLibraryStore.getState().indexMode).toBe('api');
  });
});
