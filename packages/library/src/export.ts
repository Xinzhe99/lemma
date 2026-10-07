/**
 * 知识导出（质量检查与知识导出特性集）：
 *  - papersToBibtex：全库 Paper → 合法 BibTeX（article/inproceedings/misc 等按 venue.type 选型）；
 *  - annotationsToMarkdown：PDF 标注 → Markdown（按页码分组、语义标签、引文块 + 备注）。
 *
 * 均为纯函数，无副作用，可独立测试。
 */

import type {
  Annotation,
  HighlightSemantic,
  Paper,
  PaperAuthor,
  Venue,
} from '@lemma/shared';

// ---------------------------------------------------------------------------
// BibTeX 导出
// ---------------------------------------------------------------------------

/**
 * 丢弃无法配对的大括号：`{` `}` 是 BibTeX 字段值的定界符，值内出现不平衡括号会让
 * 该字段“吃掉”后面的条目（整份 .bib 失效：重新导入时全部条目丢失）。
 * 成对括号（如题名中的 {Convolutional} 保护性大写）原样保留。
 */
function balanceBraces(value: string): string {
  const out: string[] = [];
  const unclosed: number[] = [];
  for (const ch of value) {
    if (ch === '{') {
      unclosed.push(out.length);
      out.push(ch);
    } else if (ch === '}') {
      if (unclosed.length > 0) {
        unclosed.pop();
        out.push(ch);
      }
    } else {
      out.push(ch);
    }
  }
  for (const index of unclosed) out[index] = '';
  return out.join('');
}

/** BibTeX 特殊字符转义：& % # _（另有无法配对的大括号清理，见 balanceBraces） */
export function escapeBibtex(value: string): string {
  return balanceBraces(value)
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_');
}

/** 作者 → "Family, Given"；无名（given）缺失时只写 Family */
function formatBibtexAuthor(author: PaperAuthor): string {
  const family = author.family.trim();
  const given = author.given?.trim();
  return given ? `${family}, ${given}` : family;
}

/** venue.type → BibTeX 条目类型（preprint/unknown 落 misc） */
function bibtexTypeFor(venue: Venue | undefined): 'article' | 'inproceedings' | 'phdthesis' | 'book' | 'misc' {
  switch (venue?.type) {
    case 'journal':
      return 'article';
    case 'conference':
    case 'workshop':
      return 'inproceedings';
    case 'thesis':
      return 'phdthesis';
    case 'book':
      return 'book';
    default:
      return 'misc';
  }
}

/** 场所名称在 BibTeX 中的字段名（按条目类型） */
function venueFieldName(type: ReturnType<typeof bibtexTypeFor>): string {
  switch (type) {
    case 'article':
      return 'journal';
    case 'inproceedings':
      return 'booktitle';
    case 'phdthesis':
      return 'school';
    case 'book':
      return 'publisher';
    default:
      return 'howpublished';
  }
}

/** 单条 Paper → BibTeX 条目文本（末尾无空行） */
export function paperToBibtex(paper: Paper): string {
  const type = bibtexTypeFor(paper.venue);
  const venue = paper.venue;

  const fields: Array<[string, string]> = [];
  if (paper.authors.length > 0) {
    fields.push(['author', escapeBibtex(paper.authors.map(formatBibtexAuthor).join(' and '))]);
  }
  fields.push(['title', escapeBibtex(paper.title)]);
  if (paper.year !== undefined) fields.push(['year', String(paper.year)]);
  if (venue?.name) fields.push([venueFieldName(type), escapeBibtex(venue.name)]);
  if (venue?.volume) fields.push(['volume', escapeBibtex(venue.volume)]);
  if (venue?.issue) fields.push(['number', escapeBibtex(venue.issue)]);
  if (venue?.pages) fields.push(['pages', escapeBibtex(venue.pages)]);
  if (paper.doi) fields.push(['doi', paper.doi]);
  if (paper.arxivId) {
    fields.push(['eprint', paper.arxivId]);
    fields.push(['archivePrefix', 'arXiv']);
  }
  if (paper.abstract) fields.push(['abstract', escapeBibtex(paper.abstract)]);

  const citekey = paper.citekey.trim() || paper.id;
  // 每个字段统一带尾逗号（BibTeX 合法语法，便于条目间增删字段与 diff）
  const body = fields.map(([name, value]) => `  ${name} = {${value}},`).join('\n');
  return `@${type}{${citekey},\n${body}\n}`;
}

/** 全库 Paper 列表 → .bib 文件内容（条目间空行分隔，文件以单个换行结尾） */
export function papersToBibtex(papers: Paper[]): string {
  if (papers.length === 0) return '';
  return `${papers.map((p) => paperToBibtex(p)).join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// PDF 标注导出
// ---------------------------------------------------------------------------

/** 高亮四色语义的展示标签（与标注即笔记的 SEMANTIC_LABELS 同口径） */
const SEMANTIC_LABELS: Record<HighlightSemantic, string> = {
  method: '方法',
  finding: '发现',
  question: '质疑',
  citation: '引用',
};

const KIND_LABELS: Record<Annotation['kind'], string> = {
  highlight: '高亮',
  note: '批注',
  area: '区域',
};

/**
 * 标注列表 → Markdown 导出文本：
 * 按页码升序分组（## 第 N 页），每组内逐条输出引文块（>）与语义/备注列表；
 * paperTitle 给定时输出一级标题。
 */
export function annotationsToMarkdown(annotations: Annotation[], paperTitle?: string): string {
  if (annotations.length === 0) return '';

  const sorted = [...annotations].sort((a, b) => a.page - b.page);
  const lines: string[] = [];
  if (paperTitle) lines.push(`# ${paperTitle}`, '');

  let currentPage: number | null = null;
  for (const annotation of sorted) {
    if (annotation.page !== currentPage) {
      currentPage = annotation.page;
      lines.push(`## 第 ${annotation.page} 页`, '');
    }

    const quote = (annotation.quotedText ?? '').trim();
    if (quote) lines.push(`> ${quote.replace(/\r?\n/g, '\n> ')}`, '');

    const bullets: string[] = [];
    if (annotation.semantic) bullets.push(`- 语义：${SEMANTIC_LABELS[annotation.semantic]}`);
    const note = (annotation.text ?? '').trim();
    if (note) bullets.push(`- 备注：${note.replace(/\s*\n\s*/g, ' ')}`);
    if (bullets.length === 0 && !quote) {
      bullets.push(`- （第 ${annotation.page} 页的${KIND_LABELS[annotation.kind]}标注）`);
    }
    lines.push(...bullets, '');
  }

  return `${lines.join('\n').replace(/\n+$/, '\n')}`;
}
