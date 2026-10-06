import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const chineseJournal: TemplateModule = {
  descriptor: {
    id: 'chinese-journal',
    name: '中文期刊论文',
    venue: '中文期刊投稿',
    category: 'chinese',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'ctexart 单栏中文排版：中英文摘要、关键词、参考文献（GBK 兼容提示）。',
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
% Lemma 模板：chinese-journal
\documentclass[11pt]{ctexart}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[UTF8]{ctex}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\title{\Large {TITLE}}
\author{{AUTHORS}}
\date{}
\begin{document}
\maketitle
\begin{abstract}
{ABSTRACT}
\end{abstract}
\noindent\textbf{关键词：}关键词一；关键词二；关键词三
\section{引言}
引用示例~\cite{vaswani2017attention}。
\section{相关工作}
\section{方法}
\section{实验}
\section{结论}
\begin{thebibliography}{9}
\bibitem{vaswani2017attention} Vaswani A, et al. Attention is all you need. NeurIPS, 2017.
\end{thebibliography}
\end{document}
`,
  },
};
