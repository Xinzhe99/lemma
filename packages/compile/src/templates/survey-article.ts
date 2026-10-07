import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const surveyArticle: TemplateModule = {
  descriptor: {
    id: 'survey-article',
    name: '综述长文（目录+附录）',
    venue: '文献综述 / 调研报告',
    category: 'journal',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '长文结构：目录、多级节、附录与符号表骨架。',
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
% Lemma 模板：survey-article
\documentclass[11pt]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.5cm]{geometry}
\title{\Large {TITLE}: A Survey}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\maketitle
\begin{abstract}
{ABSTRACT}
\end{abstract}
\tableofcontents
\newpage
\section{Introduction}
\section{Taxonomy of methods}
\subsection{Category A}
\subsection{Category B}
\section{Comparison and open problems}
\appendix
\section{Notation}
\section{Extended results}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
