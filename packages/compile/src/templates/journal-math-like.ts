import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const journalMathLike: TemplateModule = {
  descriptor: {
    id: 'journal-math-like',
    name: '数学期刊观感（定理环境）',
    venue: '数学/理论类投稿',
    category: 'journal',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '定理/引理/命题/证明编号环境齐全，单栏衬线排版。',
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
% Lemma 模板：journal-math-like
\documentclass[11pt]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.8cm]{geometry}
\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\newtheorem{proposition}[theorem]{Proposition}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\newtheorem{remark}{Remark}[section]
\title{{TITLE}}
\author{{AUTHORS}}
\date{}
\begin{document}
\maketitle
\begin{abstract}
{ABSTRACT}
\end{abstract}
\section{Introduction}
\section{Main results}
\begin{theorem}\label{thm:main}
State the main result here.
\end{theorem}
\begin{proof}
Proof sketch.
\end{proof}
\bibliographystyle{amsplain}
\bibliography{refs}
\end{document}
`,
  },
};
