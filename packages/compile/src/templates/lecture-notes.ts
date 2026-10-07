import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const lectureNotes: TemplateModule = {
  descriptor: {
    id: 'lecture-notes',
    name: '课堂讲义 / 作业',
    venue: '教学讲义 / 习题',
    category: 'other',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '每节练习+答案环境、定理盒子，教学场景骨架。',
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
% Lemma 模板：lecture-notes
\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.4cm]{geometry}
\usepackage{tcolorbox}
\newtheorem{exercise}{Exercise}[section]
\newtheorem{solution}{Solution}[section]
\title{\Large {TITLE}\ \large Lecture Notes}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\maketitle
\section{Topic one}
\begin{exercise}
Prove something.
\end{exercise}
\begin{solution}
Sketch.
\end{solution}
\section{Topic two}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
