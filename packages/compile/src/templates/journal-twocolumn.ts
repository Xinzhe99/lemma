import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const journalTwoColumn: TemplateModule = {
  descriptor: {
    id: 'journal-twocolumn',
    name: '通用双栏期刊',
    venue: '双栏期刊投稿',
    category: 'journal',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '双栏 + 首栏跨栏摘要：通用理工期刊观感。',
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
% Lemma 模板：journal-twocolumn
\documentclass[10pt,twocolumn]
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2cm,columnsep=0.8cm]{geometry}
\usepackage{abstract}
\renewcommand{\abstractnamefont}{\normalsize\bfseries}
\title{\Large\bfseries {TITLE}}
\author{{AUTHORS}\ \small Affiliation}
\date{}
\begin{document}
\maketitle
\begin{onecolabstract}
{ABSTRACT}
\end{onecolabstract}
\section{Introduction}
\section{Method}
\section{Results}
\section{Conclusion}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
