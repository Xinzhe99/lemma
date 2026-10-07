/**
 * 论文模板本地化（v7.5.0）：模板 name/description 的单一来源在
 * packages/compile 的模板注册表（中文），UI 层经本表按界面语言覆盖英文显示；
 * 未命中的 id 原样回退。TemplateWizard 两处列表共用。
 */
import type { Language } from './state/settingsStore';

interface TemplateNames {
  name: string;
  description: string;
}

/** 模板 id → 英文显示（zh 走注册表原文） */
const EN: Record<string, TemplateNames> = {
  'generic-article': {
    name: 'Generic academic paper',
    description: 'article class + natbib numeric citations; intro / related work / method / experiments / conclusion skeleton.',
  },
  'generic-report': {
    name: 'Generic long report',
    description: 'report class with \\chapter-level structure and table of contents; suited to longer reports.',
  },
  'conference-ieee-like': {
    name: 'Conference paper (two-column)',
    description: 'Compact two-column layout with roman-numeral sections and spanning masthead — a common conference look (self-written styles, not an official cls).',
  },
  'conference-acm-like': {
    name: 'ACM conference look (compact two-column)',
    description: 'Compact two columns, bold section headings, footnote author marks — approximates the ACM conference look (self-written).',
  },
  'journal-twocolumn': {
    name: 'Generic two-column journal',
    description: 'Two columns with a spanning abstract: a general STEM journal look.',
  },
  'preprint-ml-like': {
    name: 'ML preprint style',
    description: 'Single column, 11pt, 1-inch margins, natbib author-year citations and theorem environments — close to an ML preprint.',
  },
  'preprint-arxiv-like': {
    name: 'arXiv preprint look (single column)',
    description: 'Single relaxed column, a preprint badge in the top-left, and line numbers (review-friendly).',
  },
  'journal-elsevier-like': {
    name: 'Elsevier journal look (single column)',
    description: 'Single column with relaxed leading, a large title block, and corresponding-author footnote — approximates the Elsevier look.',
  },
  'journal-math-like': {
    name: 'Math journal look (theorem environments)',
    description: 'Full theorem / lemma / proposition / proof numbering, single-column serif typesetting.',
  },
  'journal-springer-like': {
    name: 'Journal article style (generic single column)',
    description: 'Generic single-column journal: running head, abstract and keywords, numeric citations (self-written styles, not an official cls).',
  },
  'survey-article': {
    name: 'Survey (TOC + appendix)',
    description: 'Long-form structure: table of contents, multi-level sections, appendix and notation table skeleton.',
  },
  'thesis-phd-like': {
    name: 'PhD thesis skeleton (book, multi-chapter)',
    description: 'Book class with multiple chapters: title page, declaration, abstract, TOC, list of figures, chapters, and appendix.',
  },
  'chinese-ctex': {
    name: 'Chinese academic paper (ctex)',
    description: 'ctexart class with Chinese sample content; tectonic compiles out of the box via its default XeTeX engine.',
  },
  'chinese-journal': {
    name: 'Chinese journal paper',
    description: 'Single-column ctexart: Chinese and English abstracts, keywords, and bibliography (GBK compatibility note).',
  },
  'presentation-beamer': {
    name: 'Academic slides (Beamer light)',
    description: 'Standard light Beamer theme: title page, TOC, sections, two-column figures, and acknowledgements skeleton.',
  },
  'presentation-beamer-dark': {
    name: 'Academic slides (Beamer dark)',
    description: 'Dark Beamer color variant (self-written palette, no extra theme packages).',
  },
  'letter-cover': {
    name: 'Cover letter',
    description: 'One-page cover letter: recipient, manuscript summary, contribution list, and conflict-of-interest statement.',
  },
  'report-technical': {
    name: 'Technical report / project docs',
    description: 'report class: cover page, TOC, figure/table numbering, chapter structure.',
  },
  'poster-a0': {
    name: 'Academic poster (A0 landscape)',
    description: 'Three-column A0 landscape poster drawn in plain TikZ (no a0poster/tcolorbox needed).',
  },
  'lecture-notes': {
    name: 'Lecture notes / assignments',
    description: 'Per-section exercise + solution environments and theorem boxes — a teaching skeleton.',
  },
};

/** 按界面语言取模板显示名（zh 回退注册表原文） */
export function templateName(id: string, zhName: string, lang: Language): string {
  if (lang === 'en') return EN[id]?.name ?? zhName;
  return zhName;
}

/** 按界面语言取模板描述 */
export function templateDescription(id: string, zhDescription: string, lang: Language): string {
  if (lang === 'en') return EN[id]?.description ?? zhDescription;
  return zhDescription;
}
