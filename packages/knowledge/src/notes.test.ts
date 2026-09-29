import { describe, expect, it } from 'vitest';
import type { Note } from '@scholarforge/shared';
import { buildBacklinkIndex, createNoteFromAnnotation, parseWikilinks } from './notes';

describe('parseWikilinks', () => {
  it('取目标、支持别名与锚点、去重保序', () => {
    const md = '参见 [[注意力机制]] 与 [[Transformer|变形金刚]]，再看 [[注意力机制#多头|多头注意]] 与 [[方法论]]。';
    expect(parseWikilinks(md)).toEqual(['注意力机制', 'Transformer', '方法论']);
  });

  it('空目标与普通文本', () => {
    expect(parseWikilinks('没有链接的段落 [[ ]]')).toEqual([]);
    expect(parseWikilinks('plain text')).toEqual([]);
  });
});

describe('buildBacklinkIndex', () => {
  const note = (id: string, title: string, links: string[], bodyMd = ''): Note => ({
    id,
    title,
    bodyMd,
    links,
    createdAt: 0,
    updatedAt: 0,
  });

  it('标题 → 引用它的 note id 列表', () => {
    const notes = [
      note('n1', 'A', ['B']),
      note('n2', 'B', [], '正文里链接了 [[B]] 和 [[C]]'),
      note('n3', 'C', []),
    ];
    const index = buildBacklinkIndex(notes);
    expect(index.get('B')).toEqual(['n1', 'n2']);
    expect(index.get('C')).toEqual(['n2']);
    expect(index.has('A')).toBe(false);
  });

  it('未被引用的目标不出现在索引中', () => {
    const notes = [note('n1', '孤立笔记', [])];
    expect(buildBacklinkIndex(notes).size).toBe(0);
  });
});

describe('createNoteFromAnnotation', () => {
  it('由标注生成草稿：标题、引文块、出处脚注', () => {
    const n = createNoteFromAnnotation(
      {
        id: 'ann-1',
        text: '注意力可视化很有启发',
        quotedText: 'Attention maps reveal token interactions.',
        paperId: 'paper-9',
        page: 12,
      },
      { title: 'Attention Is All You Need', citekey: 'vaswani2017' },
    );
    expect(n.title).toBe('注意力可视化很有启发');
    expect(n.bodyMd).toContain('> Attention maps reveal token interactions.');
    expect(n.bodyMd).toContain('[^source]: 来源：Attention Is All You Need [vaswani2017]，第 12 页');
    expect(n.paperId).toBe('paper-9');
    expect(n.originAnnotationId).toBe('ann-1');
    expect(n.links).toEqual([]);
    expect(n.id).toBeTruthy();
  });

  it('无备注文本时用引文当标题；无 paper 时用 paperId 标注来源', () => {
    const n = createNoteFromAnnotation({ quotedText: 'Quoted sentence as title.', page: 3 });
    expect(n.title).toBe('Quoted sentence as title.');
    expect(n.bodyMd).toContain('[^source]: 来源：论文 未知，第 3 页');

    const withPaperId = createNoteFromAnnotation({ paperId: 'p-1', page: 5, quotedText: 'x' });
    expect(withPaperId.bodyMd).toContain('来源：论文 p-1，第 5 页');
  });

  it('超长标题截断；两者皆空给默认标题', () => {
    const long = createNoteFromAnnotation({ text: 'x'.repeat(80), page: 1 });
    expect(long.title.length).toBeLessThanOrEqual(51);
    expect(long.title.endsWith('…')).toBe(true);
    expect(createNoteFromAnnotation({ page: 2 }).title).toBe('论文批注（第 2 页）');
  });
});
