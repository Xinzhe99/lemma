// @vitest-environment jsdom
/**
 * v4.3.0 新工具与上下文注入测试：
 *  - paper.read：未找到 / 摘要兜底 / PDF 全文（reader 子入口 mock）/ pages 过滤与截断
 *  - web.search_scholar：聚合 arXiv + Crossref、单路失败不拖垮、缺 query 拒绝
 *  - enrichWithPaperMentions：@citekey 注入题录+摘要、未提及不注入、截断与上限
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

// reader 子入口 mock：paper.read 才会动态 import（不应拉起 pdfjs）
const fakePages = vi.hoisted(() => [
  { page: 1, text: 'Page one: we propose a method for caching embeddings.' },
  { page: 2, text: 'Page two: experiments show linear cost reduction.' },
  { page: 3, text: 'Page three: conclusion and limitations.' },
]);
vi.mock('@lemma/library/reader', () => ({
  loadPdfText: vi.fn(async () => ({ numPages: 3, pages: fakePages })),
}));

import { createAppToolExecutor, ENABLED_TOOLS } from './agentTools';
import { enrichWithPaperMentions } from './aiActions';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { resetLibraryCaches } from './state/libraryStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function makePaper(over: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'cache2024embedding',
    title: 'Embedding Caches for Incremental Retrieval',
    authors: [{ family: 'Zhang', given: 'San' }],
    year: 2024,
    venue: { type: 'conference', name: 'NeurIPS' },
    abstract: 'We study caching embedding vectors across index rebuilds.',
    tags: [],
    collections: [],
    readStatus: 'done',
    addedAt: 1,
    ...over,
  };
}

/** 静默审批：全部通过（paper.read/web.search 均只读，不走审批；留空实现防调用） */
const autoApprove = vi.fn(async () => ({ approved: true, note: 'test' }));

/** 便捷执行：executor.execute 接收完整 ToolCallRequest */
async function run(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const executor = createAppToolExecutor(autoApprove as never);
  return (await executor.execute({ id: `c-${tool}`, tool, args })) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLibraryCaches();
  useWorkspaceStore.setState({ files: {}, compileLog: [] });
  useLibraryStore.setState({ papers: [], pdfAttachments: {} });
});

describe('paper.read', () => {
  it('已启用且暴露给模型', () => {
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('paper.read');
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('web.search_scholar');
  });

  it('库中不存在 → found:false + 候选 citekey', async () => {
    useLibraryStore.setState({ papers: [makePaper()] });
    const out = await run('paper.read', { id: 'nope' }) as Record<string, unknown>;
    expect(out.found).toBe(false);
    expect(Array.isArray(out.candidates)).toBe(true);
    expect((out.candidates as string[]).length).toBeGreaterThan(0);
  });

  it('无 PDF 附件 → 摘要兜底', async () => {
    useLibraryStore.setState({ papers: [makePaper()] });
    const out = await run('paper.read', { id: 'cache2024embedding' }) as Record<string, unknown>;
    expect(out.found).toBe(true);
    expect(out.source).toBe('abstract');
    expect(String(out.abstract)).toContain('caching embedding');
  });

  it('有 PDF 附件 → 全文（分页标注），pages 过滤生效', async () => {
    useLibraryStore.setState({
      papers: [makePaper()],
      pdfAttachments: { p1: new ArrayBuffer(8) },
    });
    const full = await run('paper.read', { id: 'cache2024embedding' });
    expect(full.source).toBe('pdf');
    expect(full.numPages).toBe(3);
    expect(String(full.text)).toContain('【第 1 页】');
    expect(String(full.text)).toContain('【第 3 页】');

    const filtered = await run('paper.read', { id: 'p1', pages: [2] });
    const text = String(filtered.text);
    expect(text).toContain('Page two');
    expect(text).not.toContain('Page one');
    expect(filtered.pages).toEqual([2]);
  });

  it('超长全文截断到 12k 字符并提示分段读取', async () => {
    const big = 'A'.repeat(20000);
    const { loadPdfText } = await import('@lemma/library/reader');
    (loadPdfText as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => ({
      numPages: 1,
      pages: [{ page: 1, text: big }],
    }));
    useLibraryStore.setState({
      papers: [makePaper()],
      pdfAttachments: { p1: new ArrayBuffer(8) },
    });
    const out = await run('paper.read', { id: 'cache2024embedding' }) as Record<string, unknown>;
    expect(String(out.text).length).toBeLessThan(12100);
    expect(String(out.text)).toContain('已截断');
  });
});

describe('web.search_scholar', () => {
  it('缺 query → 参数校验拦截（到不了执行体）', async () => {
    await expect(run('web.search_scholar', {})).rejects.toThrow('query');
  });

  it('聚合 arXiv + Crossref 命中并归并去重', async () => {
    const atomXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><id>http://arxiv.org/abs/2401.00001v1</id><title>Arxiv Hit Paper</title>
  <summary>An arxiv abstract about retrieval.</summary>
  <published>2024-01-01T00:00:00Z</published>
  <author><name>Li Si</name></author></entry>
</feed>`;
    const crossrefJson = {
      message: {
        items: [
          {
            DOI: '10.1000/cr1',
            title: ['Crossref Hit Paper'],
            author: [{ given: 'Wang', family: 'Wu' }],
            'container-title': ['Nature'],
            issued: { 'date-parts': [[2023]] },
          },
        ],
      },
    };
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('export.arxiv.org')) {
        return { ok: true, text: async () => atomXml } as unknown as Response;
      }
      return { ok: true, json: async () => crossrefJson } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    const out = await run('web.search_scholar', { query: 'retrieval', limit: 5 }) as Record<string, unknown>;
    expect(out.ok).toBe(true);
    const hits = out.hits as Array<{ title: string }>;
    expect(hits.some((h) => h.title.includes('Arxiv Hit'))).toBe(true);
    expect(hits.some((h) => h.title.includes('Crossref Hit'))).toBe(true);
    vi.unstubAllGlobals();
  });

  it('两路全失败 → ok:false 带原因', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const out = await run('web.search_scholar', { query: 'anything' }) as Record<string, unknown>;
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toContain('检索');
    vi.unstubAllGlobals();
  });
});

describe('enrichWithPaperMentions（@citekey 注入）', () => {
  const papers = [makePaper(), makePaper({ id: 'p2', citekey: 'other2025x', title: 'Other Paper', year: 2025 })];

  it('无 @ 记号 → 原样返回', () => {
    expect(enrichWithPaperMentions('普通消息', papers)).toBe('普通消息');
  });

  it('@citekey → 注入题录 + 摘要', () => {
    const out = enrichWithPaperMentions('请总结 @cache2024embedding 的方法', papers);
    expect(out).toContain('[提及的文献]');
    expect(out).toContain('Embedding Caches for Incremental Retrieval');
    expect(out).toContain('NeurIPS');
    expect(out).toContain('caching embedding');
  });

  it('@ 未命中库内 citekey → 不注入', () => {
    const out = enrichWithPaperMentions('看看 @unknown2024zz 这篇', papers);
    expect(out).not.toContain('[提及的文献]');
  });

  it('邮箱样式（user@host）不误触发', () => {
    // user@host 的 host 段可能撞 citekey——纯函数按记号匹配，这里验证常见不含点的场景不炸
    const out = enrichWithPaperMentions('发到 foo@example.com 去', papers);
    expect(out).toBe('发到 foo@example.com 去');
  });

  it('长摘要截断到 1000 字', () => {
    const long = makePaper({ id: 'p3', citekey: 'long2024', abstract: 'B'.repeat(1500) });
    const out = enrichWithPaperMentions('总结 @long2024', [long]);
    expect(out).toContain('已截断');
    expect(out.length).toBeLessThan(1200);
  });

  it('最多注入 3 篇', () => {
    const many = [1, 2, 3, 4, 5].map((i) =>
      makePaper({ id: `p${i}`, citekey: `k${i}`, title: `T${i}` }),
    );
    const out = enrichWithPaperMentions('看 @k1 @k2 @k3 @k4 @k5', many);
    expect(out.match(/--- 文献 @k/g)?.length).toBe(3);
  });
});

// 避免 unused 警告
void sleep;
