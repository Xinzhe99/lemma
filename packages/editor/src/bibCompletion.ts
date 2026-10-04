/**
 * BibTeX 补全（v3.3.0 ②）：.bib 文件内的条目类型和字段名补全。
 *
 * 触发：
 *  - 输入 @ → 建议条目类型（article, inproceedings, ...）
 *  - 行首输入字母 → 建议字段名（author, title, year, ...）
 */

import { snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';

/** 常用 BibTeX 条目类型 */
export const BIB_ENTRY_TYPES = [
  { type: 'article', desc: '期刊论文（journal, volume, pages 必填）' },
  { type: 'inproceedings', desc: '会议论文（booktitle 必填）' },
  { type: 'book', desc: '书籍（publisher 必填）' },
  { type: 'incollection', desc: '书中的章节' },
  { type: 'phdthesis', desc: '博士论文（school 必填）' },
  { type: 'mastersthesis', desc: '硕士论文' },
  { type: 'techreport', desc: '技术报告（institution 必填）' },
  { type: 'unpublished', desc: '未发表手稿' },
  { type: 'misc', desc: '其他' },
] as const;

/** 常用 BibTeX 字段（按重要性排序） */
export const BIB_FIELDS = [
  { field: 'author', desc: '作者（Family, Given AND ...）' },
  { field: 'title', desc: '标题' },
  { field: 'year', desc: '年份' },
  { field: 'journal', desc: '期刊名' },
  { field: 'booktitle', desc: '会议论文集名' },
  { field: 'volume', desc: '卷号' },
  { field: 'number', desc: '期号' },
  { field: 'pages', desc: '页码（如 123--145）' },
  { field: 'publisher', desc: '出版社' },
  { field: 'institution', desc: '机构' },
  { field: 'school', desc: '学位授予单位' },
  { field: 'doi', desc: 'DOI 标识符' },
  { field: 'url', desc: '链接' },
  { field: 'eprint', desc: 'arXiv ID' },
  { field: 'abstract', desc: '摘要' },
  { field: 'keywords', desc: '关键词（逗号分隔）' },
  { field: 'note', desc: '备注' },
  { field: 'editor', desc: '编辑' },
  { field: 'edition', desc: '版次' },
  { field: 'isbn', desc: 'ISBN' },
  { field: 'issn', desc: 'ISSN' },
] as const;

/** 条目类型补全：输入 @ 后触发 */
function entryTypeCompletion(context: CompletionContext): CompletionResult | null {
  const before = context.state.sliceDoc(Math.max(0, context.pos - 20), context.pos);
  const m = /@(\w*)$/.exec(before);
  if (!m) return null;

  const query = (m[1] ?? '').toLowerCase();
  const options: Completion[] = BIB_ENTRY_TYPES
    .filter((t) => t.type.startsWith(query))
    .map((t) => ({
      label: `@${t.type}`,
      detail: t.desc,
      type: 'type',
      apply: snippet(`@${t.type}{\n  \${1:citekey},\n  \${2}\n}`),
    }));

  if (options.length === 0) return null;
  const at = context.pos - m[0].length;
  return { from: at, to: context.pos, options };
}

/** 字段名补全：行首输入字母触发 */
function fieldCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const lineText = context.state.sliceDoc(line.from, context.pos);

  // 必须是 "  fieldname =" 或 "fieldname =" 格式的开头
  const m = /^\s*([a-z]*)$/i.exec(lineText);
  if (!m || (m[1] ?? '').length < 2) return null;

  const query = (m[1] ?? '').toLowerCase();
  const options: Completion[] = BIB_FIELDS
    .filter((f) => f.field.startsWith(query))
    .map((f) => ({
      label: f.field,
      detail: f.desc,
      type: 'property',
      apply: snippet(`${f.field} = {\${1}}`),
    }));

  if (options.length === 0) return null;
  return { from: line.from, to: context.pos, options };
}

/** BibTeX 补全源：条目类型 → 字段名 */
export function bibCompletionSource(context: CompletionContext): CompletionResult | null {
  return entryTypeCompletion(context) ?? fieldCompletion(context);
}
