import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const journalElsevierLike: TemplateModule = {
  descriptor: {
    id: 'journal-elsevier-like',
    name: 'Elsevier 期刊观感（单栏）',
    venue: '理工期刊投稿草稿',
    category: 'journal',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '单栏宽松行距、大标题区、通讯作者脚注，模拟 Elsevier 期刊观感。',
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
% Lemma 模板：journal-elsevier-like
\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.5cm]{geometry}
\usepackage{setspace}\onehalfspacing
\title{\Large {TITLE}}
\author{{AUTHORS}\thanks{Corresponding author. Email: tbd@example.com}}
\date{}
\begin{document}
\maketitle
\begin{abstract}
{ABSTRACT}
\end{abstract}
\noindent\textbf{Keywords:} keyword1; keyword2
\section{Introduction}
\section{Related work}
\section{Method}
\section{Results and discussion}
\section{Conclusion}
\bibliographystyle{plainnat}
\bibliography{refs}
\end{document}
`,
  },
};
