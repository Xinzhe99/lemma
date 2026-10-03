import { describe, expect, it } from 'vitest';
import { createId, type Annotation, type Note, type Paper } from '@lemma/shared';
import { MemoryStore } from './store';

function makePaper(overrides: Partial<Paper> = {}): Paper {
  return {
    id: createId(),
    citekey: `key-${Math.random().toString(36).slice(2, 8)}`,
    title: '示例文献',
    authors: [{ family: 'Zhang', given: 'San' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: Date.now(),
    ...overrides,
  };
}

describe('MemoryStore', () => {
  it('文献 CRUD：新增、查重、更新、删除', async () => {
    const store = new MemoryStore();
    const early = makePaper({ citekey: 'early', addedAt: 1000 });
    const late = makePaper({ citekey: 'late', addedAt: 2000 });
    await store.addPaper(early);
    await store.addPaper(late);

    expect((await store.listPapers()).map(p => p.citekey)).toEqual(['late', 'early']);
    await expect(store.addPaper(early)).rejects.toThrow(/已存在/);

    early.title = '更新后的标题';
    await store.updatePaper(early);
    expect((await store.getPaper(early.id))?.title).toBe('更新后的标题');
    await expect(store.updatePaper(makePaper({ id: 'missing' }))).rejects.toThrow(/不存在/);

    await store.deletePaper(early.id);
    expect(await store.getPaper(early.id)).toBeUndefined();
    expect((await store.listPapers()).map(p => p.citekey)).toEqual(['late']);
  });

  it('删除文献时级联删除其标注', async () => {
    const store = new MemoryStore();
    const paper = makePaper();
    await store.addPaper(paper);
    const annotation: Annotation = {
      id: createId(),
      paperId: paper.id,
      page: 1,
      kind: 'highlight',
      semantic: 'method',
      quotedText: '一段文字',
      createdAt: 1,
    };
    await store.addAnnotation(annotation);
    expect(await store.listAnnotations(paper.id)).toHaveLength(1);
    await store.deletePaper(paper.id);
    expect(await store.listAnnotations(paper.id)).toHaveLength(0);
  });

  it('标注按文献过滤，并按页码、创建时间排序', async () => {
    const store = new MemoryStore();
    const a = makePaper();
    const b = makePaper();
    await store.addPaper(a);
    await store.addPaper(b);
    await store.addAnnotation({ id: createId(), paperId: a.id, page: 3, kind: 'note', createdAt: 5 });
    await store.addAnnotation({ id: createId(), paperId: a.id, page: 1, kind: 'highlight', createdAt: 9 });
    await store.addAnnotation({ id: createId(), paperId: a.id, page: 1, kind: 'highlight', createdAt: 7 });
    await store.addAnnotation({ id: createId(), paperId: b.id, page: 1, kind: 'note', createdAt: 1 });

    const list = await store.listAnnotations(a.id);
    expect(list).toHaveLength(3);
    expect(list.map(x => [x.page, x.createdAt])).toEqual([[1, 7], [1, 9], [3, 5]]);
  });

  it('集合 CRUD', async () => {
    const store = new MemoryStore();
    const collection = { id: 'c1', name: '深度学习', parentId: null };
    await store.createCollection(collection);
    await expect(store.createCollection(collection)).rejects.toThrow(/已存在/);

    collection.name = '机器学习';
    await store.updateCollection(collection);
    expect((await store.getCollection('c1'))?.name).toBe('机器学习');
    expect(await store.listCollections()).toHaveLength(1);

    await store.deleteCollection('c1');
    expect(await store.getCollection('c1')).toBeUndefined();
    expect(await store.listCollections()).toHaveLength(0);
  });

  it('笔记新增与按时间倒序列出', async () => {
    const store = new MemoryStore();
    const first: Note = {
      id: 'n1',
      title: '第一张卡',
      bodyMd: '> 原文',
      links: [],
      createdAt: 100,
      updatedAt: 100,
    };
    const second: Note = { ...first, id: 'n2', title: '第二张卡', createdAt: 200, updatedAt: 200 };
    await store.addNote(first);
    await store.addNote(second);
    await expect(store.addNote(second)).rejects.toThrow(/已存在/);

    const notes = await store.listNotes();
    expect(notes.map(n => n.id)).toEqual(['n2', 'n1']);
  });
});
