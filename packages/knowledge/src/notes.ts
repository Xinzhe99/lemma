/**
 * 卡片与双链笔记（设计 4.7）：[[双链]] 解析、反向索引、PDF 标注自动成卡。
 */
import { createId, type Note } from '@scholarforge/shared';

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

/** 解析 [[目标|别名]] / [[目标#小节]] 形式的双链，返回目标标题（去重保序） */
export function parseWikilinks(bodyMd: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of bodyMd.matchAll(WIKILINK_RE)) {
    const target = (m[1] ?? '').trim();
    if (target.length === 0 || seen.has(target)) continue;
    seen.add(target);
    out.push(target);
  }
  return out;
}

/** 标题 → 引用它的 note id 列表（键为所有被引用过的目标标题） */
export function buildBacklinkIndex(notes: Note[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const note of notes) {
    const targets = new Set<string>([...note.links, ...parseWikilinks(note.bodyMd)].map((t) => t.trim()));
    targets.delete('');
    for (const target of targets) {
      index.set(target, [...(index.get(target) ?? []), note.id]);
    }
  }
  return index;
}

export interface AnnotationDraft {
  id?: string;
  text?: string;
  quotedText?: string;
  paperId?: string;
  page: number;
}

export interface PaperRef {
  title: string;
  citekey: string;
}

const TITLE_MAX = 50;

function deriveTitle(annotation: AnnotationDraft): string {
  const base = annotation.text?.trim().split('\n')[0] || annotation.quotedText?.trim() || '';
  if (base.length === 0) return `论文批注（第 ${annotation.page} 页）`;
  return base.length > TITLE_MAX ? `${base.slice(0, TITLE_MAX)}…` : base;
}

function sourceLine(annotation: AnnotationDraft, paper?: PaperRef): string {
  if (paper) {
    return `来源：${paper.title} [${paper.citekey}]，第 ${annotation.page} 页`;
  }
  return `来源：论文 ${annotation.paperId ?? '未知'}，第 ${annotation.page} 页`;
}

/** 从 PDF 标注生成笔记草稿（含出处脚注） */
export function createNoteFromAnnotation(annotation: AnnotationDraft, paper?: PaperRef): Note {
  const now = Date.now();
  const lines: string[] = [];
  const text = annotation.text?.trim();
  const quoted = annotation.quotedText?.trim();
  if (text) lines.push(text, '');
  if (quoted) lines.push(`> ${quoted.replace(/\n+/g, '\n> ')}`, '');
  lines.push(`[^source]: ${sourceLine(annotation, paper)}`);
  return {
    id: createId(),
    title: deriveTitle(annotation),
    bodyMd: lines.join('\n'),
    links: [],
    originAnnotationId: annotation.id,
    paperId: annotation.paperId,
    createdAt: now,
    updatedAt: now,
  };
}
