// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createId, type Annotation, type Paper } from '@scholarforge/shared';
import { hydrateAttachments, initLibrary, useLibraryStore } from './libraryStore';
import { paperAnnotationKey, useAnnotationStore } from './annotationStore';
import { useUiStore } from './uiStore';
import * as db from '../storage/db';
import { __resetKvStoreForTests, getBigData, setBigData } from '../storage/kvStore';

// 包装真实 storage/db 实现（jsdom 无 indexedDB → 内存降级后端）并 spy：
// 行为不变，同时可断言 attach/remove/openPdf 对持久层的调用。
vi.mock('../storage/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage/db')>();
  return {
    ...actual,
    kvGet: vi.fn(actual.kvGet),
    kvSet: vi.fn(actual.kvSet),
    attachmentPut: vi.fn(actual.attachmentPut),
    attachmentGet: vi.fn(actual.attachmentGet),
    attachmentDelete: vi.fn(actual.attachmentDelete),
    attachmentBulkDelete: vi.fn(actual.attachmentBulkDelete),
    attachmentGetAll: vi.fn(actual.attachmentGetAll),
  };
});

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: 'p1',
    citekey: 'vaswani2017attention',
    title: 'Attention Is All You Need',
    authors: [{ family: 'Vaswani', given: 'Ashish' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...overrides,
  };
}

function resetStores(papers: Paper[]): void {
  useLibraryStore.setState({ papers, pdfAttachments: {} });
  useAnnotationStore.setState({ byFile: {}, boundPaperId: {} });
  useUiStore.setState({ pdfView: null, centerView: 'editor' });
}

/** 冲刷异步队列：至少一个宏任务，然后轮询直至条件满足（FileReader/blob 转换可能跨宏任务相位）。 */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function flushUntil(cond: () => boolean, rounds = 25): Promise<void> {
  for (let i = 0; i < rounds && !cond(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  resetStores([makePaper()]);
  db.__resetStorageForTests();
  __resetKvStoreForTests();
});

describe('attachPdf / openPdf（L2 库内 PDF 关联）', () => {
  it('attachPdf 存内存副本并标记 paper.pdfPath', () => {
    const original = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(useLibraryStore.getState().attachPdf('p1', original)).toBe(true);

    const state = useLibraryStore.getState();
    expect(state.papers[0]!.pdfPath).toBe('vaswani2017attention.pdf');
    expect(new Uint8Array(state.pdfAttachments['p1']!)).toEqual(new Uint8Array([1, 2, 3, 4]));

    // 存的是副本：调用方后续改动/转移不影响库内附件
    new Uint8Array(original)[0] = 99;
    expect(new Uint8Array(useLibraryStore.getState().pdfAttachments['p1']!)[0]).toBe(1);

    expect(useLibraryStore.getState().attachPdf('missing', original)).toBe(false);
  });

  it('openPdf 经 uiStore.setPdfView 打开，文件名为 ${citekey}.pdf', () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([5, 6]).buffer);
    const r = useLibraryStore.getState().openPdf('p1');
    expect(r).toEqual({ ok: true, name: 'vaswani2017attention.pdf' });

    const ui = useUiStore.getState();
    expect(ui.pdfView?.name).toBe('vaswani2017attention.pdf');
    expect(ui.centerView).toBe('pdf');
    // 库内存档未被转移（可再次打开）
    expect(useLibraryStore.getState().pdfAttachments['p1']!.byteLength).toBe(2);
    expect(useLibraryStore.getState().openPdf('p1').ok).toBe(true);
  });

  it('openPdf 失败返回错误码（条目不存在 / 无附件）', () => {
    expect(useLibraryStore.getState().openPdf('nope')).toEqual({ ok: false, error: 'no-paper' });
    expect(useLibraryStore.getState().openPdf('p1')).toEqual({ ok: false, error: 'no-attachment' });
  });

  it('同一 PDF 从库内打开两次，第二次恢复第一次的标注（键控 paper:{paperId}）', () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([1]).buffer);

    // 第一次打开：App 集成契约——经 resolveKey 落库 PdfReader.onCreateAnnotation
    useLibraryStore.getState().openPdf('p1');
    const annotation: Annotation = {
      id: createId(),
      paperId: 'p1',
      page: 3,
      kind: 'highlight',
      semantic: 'finding',
      quotedText: 'attention',
      createdAt: 1,
    };
    const store = useAnnotationStore.getState();
    expect(store.resolveKey('vaswani2017attention.pdf')).toBe(paperAnnotationKey('p1'));
    store.add(store.resolveKey('vaswani2017attention.pdf'), annotation);

    // 关闭视图后重开：annotationsForPaper / resolveKey 依旧取到
    useUiStore.getState().setPdfView(null);
    useLibraryStore.getState().openPdf('p1');
    const restored = useAnnotationStore.getState().annotationsForPaper('p1');
    expect(restored.map((a) => a.id)).toEqual([annotation.id]);
    expect(useAnnotationStore.getState().resolveKey('vaswani2017attention.pdf')).toBe('paper:p1');
  });

  it('自由打开（未绑定）的 PDF 仍沿用 pdf:{文件名} 键（兼容既有规则）', () => {
    expect(useAnnotationStore.getState().resolveKey('random-paper.pdf')).toBe('pdf:random-paper.pdf');
  });
});

describe('批量与级联（L5）', () => {
  it('removePapers 级联清理：条目、内存附件、paper 键标注、文件名绑定', () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([1]).buffer);
    useLibraryStore.getState().openPdf('p1');
    useAnnotationStore
      .getState()
      .add(paperAnnotationKey('p1'), {
        id: 'a1',
        paperId: 'p1',
        page: 1,
        kind: 'note',
        createdAt: 1,
      });

    useLibraryStore.getState().removePapers(['p1']);

    const lib = useLibraryStore.getState();
    expect(lib.papers).toHaveLength(0);
    expect(lib.pdfAttachments['p1']).toBeUndefined();
    expect(useAnnotationStore.getState().annotationsForPaper('p1')).toEqual([]);
    expect(useAnnotationStore.getState().resolveKey('vaswani2017attention.pdf')).toBe(
      'pdf:vaswani2017attention.pdf',
    );
  });

  it('removePaper 单条删除委托批量路径', () => {
    useLibraryStore.getState().removePaper('p1');
    expect(useLibraryStore.getState().papers).toHaveLength(0);
  });

  it('setReadStatusBulk 批量标记，不影响未选中条目', () => {
    const other = makePaper({ id: 'p2', citekey: 'brown2020language' });
    useLibraryStore.setState({ papers: [useLibraryStore.getState().papers[0]!, other] });

    useLibraryStore.getState().setReadStatusBulk(['p1', 'p2'], 'done');

    const statuses = useLibraryStore.getState().papers.map((p) => p.readStatus);
    expect(statuses).toEqual(['done', 'done']);
    useLibraryStore.getState().setReadStatusBulk(['p1'], 'reading');
    expect(useLibraryStore.getState().papers.map((p) => p.readStatus)).toEqual(['reading', 'done']);
  });
});

describe('附件持久化（IndexedDB attachments 表）', () => {
  it('attachPdf 同步落持久层：paperId / Blob 字节 / ${citekey}.pdf 文件名', async () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([1, 2, 3, 4]).buffer);

    expect(vi.mocked(db.attachmentPut)).toHaveBeenCalledTimes(1);
    const rec = vi.mocked(db.attachmentPut).mock.calls[0][0];
    expect(rec.paperId).toBe('p1');
    expect(rec.name).toBe('vaswani2017attention.pdf');
    expect(rec.savedAt).toBeGreaterThan(0);
    expect(new Uint8Array(await db.blobToArrayBuffer(rec.data))).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );

    // 不存在的条目不落盘
    useLibraryStore.getState().attachPdf('missing', new Uint8Array([1]).buffer);
    expect(vi.mocked(db.attachmentPut)).toHaveBeenCalledTimes(1);
  });

  it('removePapers 级联删除持久层附件（含未 hydrate 回内存的）', async () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([1]).buffer);
    useLibraryStore.getState().removePapers(['p1']);

    expect(vi.mocked(db.attachmentBulkDelete)).toHaveBeenCalledWith(['p1']);
    await flush();
    expect(await db.attachmentGetAll()).toEqual([]);
  });

  it('openPdf 从持久层回填：内存 miss → 异步读回填内存 → 再次打开成功', async () => {
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([7, 8, 9]).buffer);
    await flush();

    // 模拟重启：清空内存附件（持久层留存）
    useLibraryStore.setState({ pdfAttachments: {} });
    expect(useLibraryStore.getState().openPdf('p1')).toEqual({ ok: false, error: 'no-attachment' });
    expect(vi.mocked(db.attachmentGet)).toHaveBeenCalledWith('p1');

    await flush();
    expect(
      new Uint8Array(useLibraryStore.getState().pdfAttachments['p1']!),
    ).toEqual(new Uint8Array([7, 8, 9]));
    const r = useLibraryStore.getState().openPdf('p1');
    expect(r).toEqual({ ok: true, name: 'vaswani2017attention.pdf' });
    expect(new Uint8Array(useUiStore.getState().pdfView!.data)).toEqual(
      new Uint8Array([7, 8, 9]),
    );
  });

  it('hydrateAttachments 预载全部附件且幂等（内存已有不覆盖、不计入）', async () => {
    const p2 = makePaper({ id: 'p2', citekey: 'brown2020language' });
    useLibraryStore.setState({ papers: [useLibraryStore.getState().papers[0]!, p2] });
    useLibraryStore.getState().attachPdf('p1', new Uint8Array([1]).buffer);
    useLibraryStore.getState().attachPdf('p2', new Uint8Array([2, 2]).buffer);
    await flush();

    // 模拟重启：内存清空，仅持久层有
    useLibraryStore.setState({ pdfAttachments: {} });
    expect(await hydrateAttachments()).toBe(2);
    const s = useLibraryStore.getState();
    expect(new Uint8Array(s.pdfAttachments['p1']!)).toEqual(new Uint8Array([1]));
    expect(new Uint8Array(s.pdfAttachments['p2']!)).toEqual(new Uint8Array([2, 2]));

    // 幂等：内存已有的键不覆盖；仅补齐缺失键
    useLibraryStore.setState({ pdfAttachments: { p1: new Uint8Array([9]).buffer } });
    expect(await hydrateAttachments()).toBe(1);
    expect(new Uint8Array(useLibraryStore.getState().pdfAttachments['p1']!)).toEqual(
      new Uint8Array([9]),
    );
    expect(new Uint8Array(useLibraryStore.getState().pdfAttachments['p2']!)).toEqual(
      new Uint8Array([2, 2]),
    );
  });
});

describe('papers 持久化（IndexedDB kv 表，localStorage 配额解耦）', () => {
  it('状态变更写 IndexedDB 而非 localStorage', async () => {
    useLibraryStore.setState({ papers: [makePaper({ id: 'x1' })] });
    await flush();

    const stored = await getBigData<{ papers: Paper[]; seeded: boolean }>('sf-library');
    expect(stored?.papers.map((p) => p.id)).toEqual(['x1']);
    expect(stored?.seeded).toBe(true);
    expect(localStorage.getItem('sf-library')).toBeNull();
  });

  it('initLibrary 从 IndexedDB 恢复且不重复播种', async () => {
    await setBigData('sf-library', {
      papers: [makePaper({ id: 'restored' })],
      seeded: true,
    });
    await initLibrary();
    expect(useLibraryStore.getState().papers.map((p) => p.id)).toEqual(['restored']);
  });

  it('initLibrary：清空过的库不重新播种（seeded 标记持久）', async () => {
    await setBigData('sf-library', { papers: [], seeded: true });
    await initLibrary();
    expect(useLibraryStore.getState().papers).toEqual([]);
  });

  it('initLibrary：全新环境注入种子文献（首次运行语义保留）', async () => {
    useLibraryStore.setState({ papers: [] });
    await flush();
    // 模拟全新环境：持久层与缓存均为空
    db.__resetStorageForTests();
    __resetKvStoreForTests();

    await initLibrary();

    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(3);
    expect(papers[0]!.citekey).toBe('vaswani2017attention');
  });

  it('initLibrary：旧 localStorage 存量（未迁移）兜底恢复', async () => {
    useLibraryStore.setState({ papers: [makePaper({ id: 'legacy' })] });
    await flush();
    // 清掉订阅已写入的 IndexedDB 副本，模拟"仅 localStorage 有存量"的升级首启
    db.__resetStorageForTests();
    __resetKvStoreForTests();
    localStorage.setItem(
      'sf-library',
      JSON.stringify({ papers: [makePaper({ id: 'legacy' })], seeded: true }),
    );

    await initLibrary();

    expect(useLibraryStore.getState().papers.map((p) => p.id)).toEqual(['legacy']);
  });
});

// ---------------------------------------------------------------------------
// v1.4.0：混合检索质量 sanity（TF-IDF 本地嵌入接入后）
// ---------------------------------------------------------------------------

describe('searchKnowledge（TF-IDF 接入后）', () => {
  it('initLibrary 后索引就绪，相关查询命中种子文献的 chunk', async () => {
    resetStores([
      {
        id: 'seed-vaswani2017attention',
        citekey: 'vaswani2017attention',
        title: 'Attention Is All You Need',
        sections: [
          {
            id: 'sec-1',
            heading: 'Model Architecture',
            text: 'The Transformer relies entirely on attention mechanisms, dispensing with recurrence and convolutions entirely.',
            pageStart: 1,
          },
        ],
      } as never,
    ]);
    await initLibrary();
    await flushUntil(() => useLibraryStore.getState().indexReady);

    const s = useLibraryStore.getState();
    expect(s.indexReady).toBe(true);
    expect(s.indexMode).toBe('hash'); // 本地档（TF-IDF 仍归 hash 档，UI 文案区分）
    const hits = await s.searchKnowledge('attention transformer architecture', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.citekey).toBe('vaswani2017attention');
  });
});
