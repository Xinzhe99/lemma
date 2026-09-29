import { createId, type Annotation, type HighlightSemantic, type Note, type Paper } from '@scholarforge/shared';

const SEMANTIC_LABELS: Record<HighlightSemantic, string> = {
  method: '方法',
  finding: '发现',
  question: '质疑',
  citation: '引用',
};

/**
 * 标注转 markdown 卡片（"标注即笔记"）：
 * 引用原文 + 出处（作者/年份/标题/页码），页码回链目标为 `paperId#page`。
 */
export function annotationToCard(annotation: Annotation, paper: Paper): Note {
  const quote = (annotation.quotedText ?? '').trim();
  const firstAuthor = paper.authors[0];
  const authorLabel = firstAuthor
    ? `${firstAuthor.family}${paper.authors.length > 1 ? ' 等' : ''}`
    : '';
  const source = [authorLabel, paper.year !== undefined ? String(paper.year) : '', `《${paper.title}》`]
    .filter(Boolean)
    .join('，');

  const lines: string[] = [];
  if (quote) {
    lines.push(`> ${quote.replace(/\r?\n/g, '\n> ')}`, '');
  }
  if (source) lines.push(`> —— ${source}`, '');
  if (annotation.semantic) lines.push(`- 语义：${SEMANTIC_LABELS[annotation.semantic]}`);
  if (annotation.text?.trim()) lines.push(`- 备注：${annotation.text.trim()}`);
  lines.push('', `[回到 PDF 第 ${annotation.page} 页](${paper.id}#${annotation.page})`);

  const createdAt = Date.now();
  return {
    id: createId(),
    title: `摘录：${paper.title}（第 ${annotation.page} 页）`,
    bodyMd: `${lines.join('\n').trim()}\n`,
    links: paper.title ? [`[[${paper.title}]]`] : [],
    originAnnotationId: annotation.id,
    paperId: paper.id,
    createdAt,
    updatedAt: createdAt,
  };
}
