import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const conferenceAcmLike: TemplateModule = {
  descriptor: {
    id: 'conference-acm-like',
    name: 'ACM 会议观感（双栏紧凑）',
    venue: 'CS 会议投稿草稿',
    category: 'conference',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '双栏紧凑、加粗节标、脚注作者标记，模拟 ACM 会议观感（自写样式）。',
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
% Lemma 模板：conference-acm-like
\documentclass[10pt,twocolumn]{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[letterpaper,margin=1.8cm,columnsep=0.7cm]{geometry}
\usepackage{titlesec}
\titleformat{\section}{\normalsize\bfseries}{\thesection}{0.6em}{}
\titleformat{\subsection}{\normalsize\bfseries}{\thesubsection}{0.6em}{}
\title{\bfseries {TITLE}}
\author{\normalsize {AUTHORS}\ \ \small Affiliation, City, Country}
\date{}
\begin{document}
\maketitle
\begin{abstract}
\small {ABSTRACT}
\end{abstract}
\section{Introduction}
Intro with citation~\cite{knuth1984literate}.
\section{Method}
\section{Experiments}
\section{Conclusion}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
