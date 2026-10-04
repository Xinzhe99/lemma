/**
 * 文献库 → BibTeX 导出（v2.6.0 ①）：数据可携带性——库不锁死在应用里。
 *
 * 输出口径：
 *  - 条目类型映射：Paper 无显式 type，默认 article（journal/conference 均可用）；
 *  - 字段：citekey / author / title / year / journal（venue.name）/ booktitle（会议）/
 *    volume / pages / doi / url / abstract / keywords（tags）；
 *  - author 格式：family, given AND family, given（BibTeX 标准 AND 分隔）；
 *  - 转义：& % # _ 严格转义（BibTeX 特殊字符）；
 *  - 可选 filter：只导出被稿件引用的条目（citedKeys 传入时）。
 */

import type { Paper } from '@lemma/shared';

/** BibTeX 特殊字符转义 */
function esc(s: string): string {
  return s.replace(/([&%#_])/g, '\\$1');
}

/** PaperAuthor[] → "Family, Given AND Family, Given" */
function formatAuthors(authors: Paper['authors']): string {
  return authors
    .map((a) => {
      const family = a.family ?? '';
      const given = a.given ?? '';
      return given ? `${family}, ${given}` : family;
    })
    .join(' AND ');
}

/** venue 类型 → BibTeX 条目类型 + booktitle/journal 字段 */
function venueFields(p: Paper): { entryType: string; journal?: string; booktitle?: string } {
  const v = p.venue;
  if (!v) return { entryType: 'article' };
  if (v.type === 'conference' || v.type === 'workshop') {
    return { entryType: 'inproceedings', booktitle: v.name };
  }
  if (v.type === 'book') return { entryType: 'book' };
  if (v.type === 'thesis') return { entryType: 'phdthesis' };
  return { entryType: 'article', journal: v.name };
}

/**
 * 把文献列表导出为 BibTeX 文本。
 * citedKeys 非空时只导出被引用的条目（配合稿件 \cite 分析做精准导出）。
 */
export function toBibtex(papers: Paper[], options?: { citedKeys?: Set<string> }): string {
  const filter = options?.citedKeys;
  const entries: string[] = [];

  for (const p of papers) {
    if (filter && filter.size > 0 && !filter.has(p.citekey)) continue;

    const { entryType, journal, booktitle } = venueFields(p);
    const fields: [string, string][] = [];
    fields.push(['author', formatAuthors(p.authors)]);
    fields.push(['title', esc(p.title)]);
    if (p.year) fields.push(['year', String(p.year)]);
    if (journal) fields.push(['journal', esc(journal)]);
    if (booktitle) fields.push(['booktitle', esc(booktitle)]);
    if (p.venue?.volume) fields.push(['volume', p.venue.volume]);
    if (p.venue?.pages) fields.push(['pages', p.venue.pages]);
    if (p.doi) fields.push(['doi', p.doi]);
    if (p.arxivId) fields.push(['eprint', p.arxivId]);
    if (p.abstract) fields.push(['abstract', esc(p.abstract.slice(0, 500))]);
    if (p.tags.length > 0) fields.push(['keywords', p.tags.map(esc).join(', ')]);

    const body = fields.map(([k, v]) => `  ${k} = {${v}}`).join(',\n');
    entries.push(`@${entryType}{${p.citekey},\n${body}\n}`);
  }

  return `%% BibTeX export from Lemma — ${entries.length} entries\n%% Generated: ${new Date().toISOString().slice(0, 10)}\n\n${entries.join('\n\n')}\n`;
}
