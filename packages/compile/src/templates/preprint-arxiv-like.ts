import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const preprintArxivLike: TemplateModule = {
  descriptor: {
    id: 'preprint-arxiv-like',
    name: 'arXiv 预印本观感（单栏）',
    venue: '预印本 / 早期草稿',
    category: 'preprint',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '单栏宽松、左上角预印本标注框、行号（投稿审稿友好）。',
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
% Lemma 模板：preprint-arxiv-like
\documentclass[11pt]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{setspace}\onehalfspacing
\usepackage{lineno}\linenumbers
\usepackage{epigraph}
\title{\Large {TITLE}}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\maketitle
\begin{abstract}
{ABSTRACT}
\end{abstract}
\section{Introduction}
\section{Related work}
\section{Method}
\section{Experiments}
\section{Conclusion}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
