// @vitest-environment jsdom
/**
 * v4.2.0 性能缓存的正确性测试：
 *  1. Context Pack memo——文件未变时 outline/glossary 不重算；文件变了立即失效；
 *  2. API 嵌入缓存——增量 rebuild 只嵌入新增文本，未变文本不再请求嵌入服务；
 *  3. 重建合并——批量导入的连续 rebuild 在 250ms 窗口内合并为一次。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

// 透传真实 projectDoc 并计数：验证 memo 命中（combinedDoc 调用次数）
vi.mock('../projectDoc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../projectDoc')>();
  return {
    ...actual,
    combinedDoc: vi.fn(actual.combinedDoc),
    outlineAcrossFiles: vi.fn(actual.outlineAcrossFiles),
  };
});

import { combinedDoc, outlineAcrossFiles } from '../projectDoc';
import { buildContextPackMd, resetContextPackCache } from '../agentTools';
import { initLibrary, resetLibraryCaches, useLibraryStore } from './libraryStore';
import { useWorkspaceStore } from './workspaceStore';
import { useSettingsStore, type ProviderConfig } from './settingsStore';
import { __resetKvStoreForTests } from '../storage/kvStore';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const provider: ProviderConfig = {
  id: 'perf-test',
  label: 'PerfTest',
  baseUrl: 'https://embed.test/v1',
  apiKey: 'sk-test',
  model: 'chat-m',
  tier: 'flagship',
};

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'pp1',
    citekey: 'perfPaper2024',
    title: 'Performance Caching for Local RAG',
    authors: [{ family: 'Zhang', given: 'San' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    abstract:
      'We study embedding caches for incremental retrieval index rebuilds. The cache avoids re-embedding unchanged chunks when papers are added or removed, reducing latency and API cost linearly with library size.',
    ...overrides,
  };
}

/**
 * 嵌入服务 mock：记录每次请求的文本批次，返回固定向量。
 * textsSince(mark) 只取标记之后的批次——断言「增量 rebuild 发送了什么」时
 * 必须排除初始全量索引的批次。
 */
function stubEmbeddingFetch(): {
  batchCount: () => number;
  textsSince: (mark: number) => string[];
} {
  const batches: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { input?: string[] };
      const input = body.input ?? [];
      batches.push(input);
      return {
        ok: true,
        json: async () => ({ data: input.map((_, i) => ({ index: i, embedding: [0.1, 0.2] })) }),
      } as unknown as Response;
    }),
  );
  return {
    batchCount: () => batches.length,
    textsSince: (mark: number) => batches.slice(mark).flat(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetKvStoreForTests();
  resetContextPackCache();
  resetLibraryCaches();
  useWorkspaceStore.setState({ files: {} });
  useLibraryStore.setState({ papers: [], pdfAttachments: {} });
  useSettingsStore.setState({
    providers: [],
    activeProviderId: null,
    embeddingModel: '',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Context Pack memo（outline/glossary 按文件签名缓存）', () => {
  it('文件未变时重复调用不重算 outline/glossary', { timeout: 20000 }, async () => {
    useWorkspaceStore.setState({
      files: {
        'main.tex': '\\section{Intro}\nbody text here.\n\\section{Method}\nmore text.',
        'refs.bib': '@misc{a, title={T}, author={X}, year={2024}}',
      },
    });
    await buildContextPackMd('第一个问题');
    await buildContextPackMd('第二个问题');
    await buildContextPackMd('第三个问题');
    expect(combinedDoc).toHaveBeenCalledTimes(1);
    expect(outlineAcrossFiles).toHaveBeenCalledTimes(1);
  });

  it('文件内容变化后缓存失效，outline 反映新内容', { timeout: 20000 }, async () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': '\\section{Old}\nold content.' },
    });
    const first = await buildContextPackMd('query');
    expect(first).toContain('Old');
    useWorkspaceStore.setState({
      files: { 'main.tex': '\\section{New Section}\nfresh content after edit.' },
    });
    const second = await buildContextPackMd('query');
    expect(second).toContain('New Section');
    expect(combinedDoc).toHaveBeenCalledTimes(2);
  });

  it('显式 reset 后即使文件相同也重算', { timeout: 20000 }, async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': '\\section{S}\ncontent.' } });
    await buildContextPackMd('q');
    resetContextPackCache();
    await buildContextPackMd('q');
    expect(combinedDoc).toHaveBeenCalledTimes(2);
  });
});

describe('API 嵌入缓存 + 重建合并', () => {
  it('增量导入只嵌入新文本，未变文本命中缓存', { timeout: 20000 }, async () => {
    const emb = stubEmbeddingFetch();
    useLibraryStore.setState({ papers: [makePaper()] });
    useSettingsStore.setState({
      providers: [provider],
      activeProviderId: provider.id,
      embeddingModel: 'emb-test',
    });
    await initLibrary();
    await sleep(320); // 等初始 rebuild + settings 订阅触发的 rebuild 稳定
    const mark = emb.batchCount();

    useLibraryStore.getState().importBibtex(
      '@article{newPaper2025, title={Brand New Paper on Caching}, author={Li, Si}, year={2025}, abstract={Fresh abstract about incremental index updates with embedding reuse across rebuilds.}}',
    );
    await sleep(450);

    const sent = emb.textsSince(mark);
    expect(sent.length).toBeGreaterThan(0);
    // 未变文本（初始论文的 chunk）不应再次发送——嵌入缓存命中
    for (const text of sent) {
      expect(text).not.toContain('Performance Caching for Local RAG');
      expect(text).not.toContain('embedding caches for incremental');
    }
    // 新文本必须已发送（缓存不能漏嵌入新内容）
    expect(
      sent.some((t) => t.includes('Brand New Paper') || t.includes('Fresh abstract')),
    ).toBe(true);
  });

  it('连续导入合并为一次重建', { timeout: 20000 }, async () => {
    const emb = stubEmbeddingFetch();
    useLibraryStore.setState({ papers: [makePaper()] });
    useSettingsStore.setState({
      providers: [provider],
      activeProviderId: provider.id,
      embeddingModel: 'emb-test',
    });
    await initLibrary();
    await sleep(320);
    const mark = emb.batchCount();

    // 两次导入在同一 250ms 窗口内 → 只应触发一次嵌入批次（64 上限内单批可覆盖）
    useLibraryStore.getState().importBibtex(
      '@article{n1, title={Paper One}, author={A, B}, year={2025}, abstract={Abstract one about merging rebuild requests.}}',
    );
    useLibraryStore.getState().importBibtex(
      '@article{n2, title={Paper Two}, author={C, D}, year={2025}, abstract={Abstract two about merging rebuild requests.}}',
    );
    await sleep(450);

    expect(emb.batchCount() - mark).toBe(1);
    const sent = emb.textsSince(mark);
    expect(sent.some((t) => t.includes('Paper One') || t.includes('Abstract one'))).toBe(true);
    expect(sent.some((t) => t.includes('Paper Two') || t.includes('Abstract two'))).toBe(true);
    for (const t of sent) {
      expect(t).not.toContain('Performance Caching for Local RAG');
    }
  });

  it('本地哈希路径的检索在重建合并窗口内仍可用', { timeout: 20000 }, async () => {
    useLibraryStore.setState({ papers: [makePaper()] });
    await initLibrary();
    const results = await useLibraryStore.getState().searchKnowledge('embedding cache', 3);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].citekey).toBe('perfPaper2024');
  });
});
