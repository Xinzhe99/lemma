import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

/** 通用期刊单栏观感：衬线标题、页眉running head、摘要 + 关键词 */
export const journalSpringerLike: TemplateModule = {
  descriptor: {
    id: 'journal-springer-like',
    name: '期刊论文风格（通用单栏）',
    venue: '期刊投稿草稿 / 长文评审',
    category: 'journal',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '通用期刊单栏排版：running head 页眉、摘要与关键词、数字引用（自写样式，非官方 cls）。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐：自动下载依赖并完成必要的重跑）',
    'latexmk -pdf -interaction=nonstopmode main.tex（系统 TeX Live / MiKTeX）',
  ],
  notes: [
    '本模板为自写的通用期刊观感（非 Springer 官方 sn-jnl.cls）；正式投稿请使用期刊提供的模板。',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% Lemma 模板：journal-springer-like —— 通用期刊单栏风格（自写样式）
\documentclass[11pt,a4paper]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{mathptmx}
\usepackage[margin=2.4cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage{fancyhdr}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\small\itshape {TITLE}}
\fancyhead[R]{\small\thepage}
\renewcommand{\headrulewidth}{0.4pt}

\title{{TITLE}}
\author{{AUTHORS}\thanks{Manuscript prepared with Lemma. Target venue: {VENUE}.}}
\date{{DATE}}

\begin{document}
\maketitle

\begin{abstract}
{ABSTRACT}
\end{abstract}

\vspace{0.4em}
\noindent\textbf{Keywords:} keyword one; keyword two; keyword three

\section{Introduction}
Introduce the problem and contributions \citep{knuth1984literate}.

\section{Related Work}
Review the literature \citep{lamport1994latex,greenwade1993ctan}.

\section{Materials and Methods}
Describe the methodology in reproducible detail.

\section{Results}
Present findings with figures and tables.

\section{Discussion}
Interpret results, limitations, and implications.

\section{Conclusion}
Conclude the study.

\bibliographystyle{abbrvnat}
\bibliography{refs}

\end{document}
`,
  },
};
