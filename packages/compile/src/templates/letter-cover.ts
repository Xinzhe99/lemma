import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const letterCover: TemplateModule = {
  descriptor: {
    id: 'letter-cover',
    name: '投稿信（Cover Letter）',
    venue: '期刊/会议投稿信',
    category: 'other',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '一页式投稿信：收件人、稿件说明、贡献列表、利益冲突声明。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐）',
    'latexmk -pdf main.tex（系统 TeX Live）',
  ],
  notes: [
    '自写观感模板，不含任何官方版权 class 文件；正式投稿请换用主办方官方模板。',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% Lemma 模板：letter-cover
\documentclass[11pt]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage[colorlinks=true]{hyperref}
\begin{document}
\begin{flushright}
{AUTHORS}\
Affiliation\
{DATE}
\end{flushright}
\bigskip
\noindent Dear Editors,
\medskip
We submit our manuscript entitled \textbf{\textquotedblleft {TITLE}\textquotedblright} for consideration in your journal.
\medskip
\noindent Our main contributions are:
\begin{itemize}
\item Contribution one.
\item Contribution two.
\item Contribution three.
\end{itemize}
\medskip
\noindent {ABSTRACT}
\medskip
\noindent This manuscript is original and not under consideration elsewhere. The authors declare no conflict of interest.
\bigskip
\noindent Sincerely,\
{AUTHORS}
\end{document}
`,
  },
};
