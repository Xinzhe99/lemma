import { describe, expect, it } from 'vitest';
import type { Annotation, Paper } from '@scholarforge/shared';
import { annotationToCard } from './annotationToNote';

const paper: Paper = {
  id: 'paper-9',
  citekey: 'vaswani2017attention',
  title: 'Attention Is All You Need',
  authors: [
    { family: 'Vaswani', given: 'Ashish' },
    { family: 'Shazeer', given: 'Noam' },
  ],
  year: 2017,
  tags: [],
  collections: [],
  readStatus: 'reading',
  addedAt: 1,
};

const annotation: Annotation = {
  id: 'anno-1',
  paperId: 'paper-9',
  page: 3,
  kind: 'highlight',
  semantic: 'method',
  bbox: [100, 200, 300, 220],
  quotedText: 'We compute the dot products of the query with all keys.',
  text: '注意力的核心公式',
  createdAt: 1710000000000,
};

describe('annotationToCard', () => {
  it('生成含引用原文与页码回链的 markdown 卡片', () => {
    const note = annotationToCard(annotation, paper);
    expect(note.id).toBeTruthy();
    expect(note.title).toContain('Attention Is All You Need');
    expect(note.title).toContain('第 3 页');
    expect(note.bodyMd).toContain('> We compute the dot products of the query with all keys.');
    expect(note.bodyMd).toContain('方法');
    expect(note.bodyMd).toContain('注意力的核心公式');
    expect(note.bodyMd).toContain(`[回到 PDF 第 3 页](paper-9#3)`);
    expect(note.bodyMd).toContain('Vaswani 等');
    expect(note.bodyMd).toContain('2017');
    expect(note.bodyMd).toContain('《Attention Is All You Need》');
  });

  it('回链与笔记字段正确挂接', () => {
    const note = annotationToCard(annotation, paper);
    expect(note.originAnnotationId).toBe('anno-1');
    expect(note.paperId).toBe('paper-9');
    expect(note.links).toEqual(['[[Attention Is All You Need]]']);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(note.updatedAt).toBe(note.createdAt);
  });

  it('无备注、无语义的标注也能成卡', () => {
    const bare: Annotation = { ...annotation, id: 'anno-2', semantic: undefined, text: undefined };
    const note = annotationToCard(bare, paper);
    expect(note.bodyMd).toContain('> We compute');
    expect(note.bodyMd).not.toContain('语义：');
    expect(note.bodyMd).not.toContain('备注：');
    expect(note.bodyMd).toContain('(paper-9#3)');
  });
});
