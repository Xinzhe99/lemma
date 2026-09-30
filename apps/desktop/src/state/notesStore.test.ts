// @vitest-environment jsdom
/**
 * notesStore：卡片 CRUD、[[双链]] links 同步、localStorage（sf-notes）持久化、标注转卡片。
 * N1/N2 验收的 store 级落点（面板仅做展示与交互）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, Note } from '@scholarforge/shared';
import { buildBacklinkIndex } from '@scholarforge/knowledge';
import { NOTES_STORAGE_KEY, useNotesStore } from './notesStore';

const ann: Annotation = {
  id: 'ann-1',
  paperId: 'pdf:attention.pdf',
  page: 12,
  kind: 'highlight',
  semantic: 'finding',
  quotedText: 'Attention maps reveal token interactions.',
  text: '关键证据：注意力可视化',
  createdAt: 0,
};

beforeEach(() => {
  localStorage.clear();
  useNotesStore.setState({ notes: [] });
});

describe('notesStore CRUD 与双链 links', () => {
  it('addNote 创建卡片，links 由正文 [[双链]] 解析（支持别名/锚点）', () => {
    const n = useNotesStore.getState().addNote({
      title: '方法论',
      bodyMd: '参见 [[注意力机制]] 与 [[Transformer|变形金刚]]，另见 [[方法论#锚点]]。',
    });
    expect(n.title).toBe('方法论');
    expect(n.links).toEqual(['注意力机制', 'Transformer', '方法论']);
    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(n.id).toBeTruthy();
  });

  it('空标题回退默认标题；空正文合法', () => {
    const n = useNotesStore.getState().addNote({ title: '   ', bodyMd: '' });
    expect(n.title).toBe('未命名卡片');
    expect(n.links).toEqual([]);
  });

  it('updateNote 更新标题/正文并重算 links；空标题保留原标题', () => {
    const n = useNotesStore.getState().addNote({ title: '旧题', bodyMd: '正文' });
    useNotesStore.getState().updateNote(n.id, { title: '新题', bodyMd: '链接 [[Target]]' });
    const after = useNotesStore.getState().notes.find((x) => x.id === n.id)!;
    expect(after.title).toBe('新题');
    expect(after.links).toEqual(['Target']);
    expect(after.updatedAt).toBeGreaterThanOrEqual(n.updatedAt);

    useNotesStore.getState().updateNote(n.id, { title: '  ' });
    expect(useNotesStore.getState().notes.find((x) => x.id === n.id)!.title).toBe('新题');
  });

  it('removeNote 删除指定卡片', () => {
    const a = useNotesStore.getState().addNote({ title: 'A', bodyMd: '' });
    useNotesStore.getState().addNote({ title: 'B', bodyMd: '' });
    useNotesStore.getState().removeNote(a.id);
    const titles = useNotesStore.getState().notes.map((n) => n.title);
    expect(titles).toEqual(['B']);
  });
});

describe('notesStore localStorage 持久化（sf-notes）', () => {
  it('CRUD 后写入 sf-notes，且为合法 JSON 卡片数组', () => {
    useNotesStore.getState().addNote({ title: 'A', bodyMd: 'ref [[B]]' });
    const raw = localStorage.getItem(NOTES_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const persisted = JSON.parse(raw!) as Note[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]!.title).toBe('A');
    expect(persisted[0]!.links).toEqual(['B']);
  });

  it('刷新后恢复：重新加载模块时从 localStorage 读取（验收「刷新仍在」）', async () => {
    useNotesStore.getState().addNote({ title: 'Target', bodyMd: '被引用方' });
    useNotesStore.getState().addNote({ title: '来源', bodyMd: '提到 [[Target]]' });
    expect(localStorage.getItem(NOTES_STORAGE_KEY)).toBeTruthy();

    vi.resetModules();
    const fresh = await import('./notesStore');
    const titles = fresh.useNotesStore.getState().notes.map((n) => n.title);
    expect(titles).toEqual(['来源', 'Target']); // 新建在前，顺序保持
  });

  it('损坏 JSON / 非数组 / 非法条目 → 初始化为空或被过滤', async () => {
    localStorage.setItem(NOTES_STORAGE_KEY, '{bad json');
    vi.resetModules();
    const broken = await import('./notesStore');
    expect(broken.useNotesStore.getState().notes).toEqual([]);

    const valid = useNotesStore.getState().addNote({ title: 'ok', bodyMd: '' });
    localStorage.setItem(
      NOTES_STORAGE_KEY,
      JSON.stringify([{ id: 'not-a-note' }, valid]),
    );
    vi.resetModules();
    const filtered = await import('./notesStore');
    const notes = filtered.useNotesStore.getState().notes;
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toBe('ok');
  });
});

describe('N2 标注转卡片（addNoteFromAnnotation）', () => {
  it('生成含页码出处的卡片并出现在列表顶部', () => {
    const n = useNotesStore.getState().addNoteFromAnnotation(ann);
    expect(n.bodyMd).toContain('第 12 页');
    expect(n.bodyMd).toContain('> Attention maps reveal token interactions.');
    expect(n.originAnnotationId).toBe('ann-1');
    expect(n.paperId).toBe('pdf:attention.pdf');
    const first = useNotesStore.getState().notes[0];
    expect(first?.id).toBe(n.id);
  });

  it('提供 PaperRef 时出处含文献题名与 citekey', () => {
    const n = useNotesStore.getState().addNoteFromAnnotation(ann, {
      title: 'Attention Is All You Need',
      citekey: 'vaswani2017',
    });
    expect(n.bodyMd).toContain('Attention Is All You Need [vaswani2017]，第 12 页');
  });
});

describe('N1 反向链接 wiring（buildBacklinkIndex × store notes）', () => {
  it('新建含 [[Target]] 的卡片后，Target 卡片的反向链接包含来源', () => {
    const target = useNotesStore.getState().addNote({ title: 'Target', bodyMd: '被引用' });
    const source = useNotesStore.getState().addNote({ title: '来源卡片', bodyMd: '参考 [[Target]]' });

    const index = buildBacklinkIndex(useNotesStore.getState().notes);
    expect(index.get('Target')).toEqual([source.id]);

    // 面板按 id 映射回标题展示来源标题
    const byId = new Map(useNotesStore.getState().notes.map((n) => [n.id, n]));
    const backlinkTitles = (index.get('Target') ?? []).map((id) => byId.get(id)!.title);
    expect(backlinkTitles).toEqual(['来源卡片']);
    expect(target.links).toEqual([]);
  });
});
