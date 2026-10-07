import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const reportTechnical: TemplateModule = {
  descriptor: {
    id: 'report-technical',
    name: '技术报告 / 项目文档',
    venue: '课程报告 / 项目结题',
    category: 'report',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'Report 类：封面页、目录、图表编号、章节结构。',
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
% Lemma 模板：report-technical
\documentclass[11pt]{article}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.5cm]{geometry}
\title{\Large {TITLE}\ \large Technical Report}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\maketitle
\tableofcontents
\newpage
\section{Overview}
\section{Background}
\section{Design}
\section{Implementation}
\section{Evaluation}
\section{Summary}
\appendix
\section{Data sheets}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
