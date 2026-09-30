// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createId, type Annotation, type Paper } from '@scholarforge/shared';
import { useLibraryStore } from './libraryStore';
import { paperAnnotationKey, useAnnotationStore } from './annotationStore';
import { useUiStore } from './uiStore';

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

beforeEach(() => {
  localStorage.clear();
  resetStores([makePaper()]);
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
