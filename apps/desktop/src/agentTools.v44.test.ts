// @vitest-environment jsdom
/**
 * v4.4.0 AI 能力增强测试：
 *  - memory.write：审批采纳写入 agent-memory（注入后续上下文）；拒绝不写入
 *  - PDF 全文索引：attachPdf 触发抽取 → paper.fullText → 索引升级全文级；旧附件启动回填
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

// reader 子入口 mock：全文抽取与 paper.read 共用
vi.mock('@lemma/library/reader', () => ({
  loadPdfText: vi.fn(async () => ({
    numPages: 2,
    pages: [
      { page: 1, text: 'Full text page one: the proposed retrieval cache design.' },
      { page: 2, text: 'Full text page two: ablation on cache sizes.' },
    ],
  })),
}));

import { createAppToolExecutor, ENABLED_TOOLS } from './agentTools';
import {
  initLibrary,
  resetLibraryCaches,
  useLibraryStore,
} from './state/libraryStore';
import { useAgentMemoryStore } from './state/agentMemory';
import { useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore, type ProviderConfig } from './state/settingsStore';
import { __resetKvStoreForTests } from './storage/kvStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const provider: ProviderConfig = {
  id: 'v44-test',
  label: 'T',
  baseUrl: 'https://x.test/v1',
  apiKey: 'k',
  model: 'm',
  tier: 'flagship',
};

function makePaper(over: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'full2024text',
    title: 'Full Text Indexing',
    authors: [{ family: 'Chen', given: 'Si' }],
    year: 2024,
    abstract: 'Short abstract only.',
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...over,
  };
}

async function run(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const executor = createAppToolExecutor(vi.fn(async () => ({ approved: true, note: 'ok' })) as never);
  return (await executor.execute({ id: `c-${tool}`, tool, args })) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetKvStoreForTests();
  resetLibraryCaches();
  useAgentMemoryStore.setState({ styleNotes: [], approvedPatterns: [], ignoredSuggestions: [], enabled: true });
  useWorkspaceStore.setState({ files: {}, compileLog: [] });
  useLibraryStore.setState({ papers: [], pdfAttachments: {} });
  useSettingsStore.setState({ providers: [], activeProviderId: null, embeddingModel: '' });
});

describe('memory.write（AI 自主记忆）', () => {
  it('已启用暴露给模型', () => {
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('memory.write');
  });

  it('审批采纳 → 写入 styleNotes，后续 buildMemoryInjection 可见', async () => {
    const out = await run('memory.write', { key: '术语约定', value: 'LLM 统一写作 LLM，不用大模型' });
    expect(out.written).toBe(true);
    const notes = useAgentMemoryStore.getState().styleNotes;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('【术语约定】');
    expect(notes[0]).toContain('大模型');
  });

  it('审批拒绝 → 不写入并回传原因', async () => {
    const executor = createAppToolExecutor(
      vi.fn(async () => ({ approved: false, note: '不需要' })) as never,
    );
    const out = (await executor.execute({
      id: 'c1',
      tool: 'memory.write',
      args: { key: 'k', value: 'v' },
    })) as Record<string, unknown>;
    expect(out.written).toBe(false);
    expect(out.reason).toBe('不需要');
    expect(useAgentMemoryStore.getState().styleNotes).toHaveLength(0);
  });

  it('空 key/value 拒绝', async () => {
    const out = await run('memory.write', { key: '', value: '' });
    expect(out.written).toBe(false);
  });
});

describe('PDF 全文进知识索引', () => {
  it('attachPdf 后异步抽取 → paper.fullText 落库', async () => {
    useLibraryStore.setState({ papers: [makePaper()] });
    useLibraryStore.getState().attachPdf('p1', new ArrayBuffer(16));
    await sleep(50);
    const paper = useLibraryStore.getState().papers.find((p) => p.id === 'p1');
    expect(paper?.fullText).toContain('Full text page one');
    expect(paper?.fullText).toContain('ablation on cache sizes');
  });

  it('已有 fullText 的论文不重复抽取（幂等）', async () => {
    const { loadPdfText } = await import('@lemma/library/reader');
    useLibraryStore.setState({
      papers: [makePaper({ fullText: '既有全文' })],
      pdfAttachments: { p1: new ArrayBuffer(16) },
    });
    // 直接再触发一次抽取路径：attach 新副本
    useLibraryStore.getState().attachPdf('p1', new ArrayBuffer(16));
    await sleep(50);
    expect(loadPdfText).not.toHaveBeenCalled();
    const paper = useLibraryStore.getState().papers.find((p) => p.id === 'p1');
    expect(paper?.fullText).toBe('既有全文');
  });

  it('全文优先于摘要进检索索引：searchKnowledge 命中正文内容', async () => {
    useLibraryStore.setState({
      papers: [makePaper({ fullText: 'uniquefulltexttoken about retrieval cache ablation' })],
    });
    await initLibrary(); // 本地哈希嵌入路径
    const hits = await useLibraryStore.getState().searchKnowledge('retrieval cache ablation uniquefulltexttoken', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].citekey).toBe('full2024text');
  });

  it('抽取失败静默保持摘要索引', async () => {
    const { loadPdfText } = await import('@lemma/library/reader');
    (loadPdfText as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      throw new Error('bad pdf');
    });
    useLibraryStore.setState({ papers: [makePaper()] });
    useLibraryStore.getState().attachPdf('p1', new ArrayBuffer(16));
    await sleep(50);
    const paper = useLibraryStore.getState().papers.find((p) => p.id === 'p1');
    expect(paper?.fullText).toBeUndefined();
    // 摘要索引仍可用
    const hits = await useLibraryStore.getState().searchKnowledge('abstract', 3);
    expect(hits.length).toBeGreaterThan(0);
  });
});
