import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const genericReport: TemplateModule = {
  descriptor: {
    id: 'generic-report',
    name: '通用长报告',
    venue: '课程大作业 / 技术报告 / 实验报告',
    category: 'generic',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'report 文类，章（\\chapter）级结构 + 目录，适合篇幅较长的报告。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐：自动下载依赖并完成必要的重跑）',
    'latexmk -pdf -interaction=nonstopmode main.tex（系统 TeX Live / MiKTeX）',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% Lemma 模板：generic-report —— 通用长报告（report + chapter 结构）
\documentclass[12pt,a4paper]{report}
\usepackage[UTF8]{ctex} % 中文支持：真实引擎（lualatex/xelatex/tectonic）下中文不再静默丢字
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

\title{{TITLE}\\ \large Technical Report}
\author{{AUTHORS}}
\date{{DATE}\\ \small Venue: {VENUE}}

\begin{document}
\maketitle
\tableofcontents

\chapter{Introduction}
Introduce background, scope, and structure of the report. Foundational
typesetting ideas trace back to \citet{knuth1984literate}.

\chapter{Background and Related Work}
Review prior techniques and standards \citep{lamport1994latex,greenwade1993ctan}.

\chapter{Design}
Present the overall architecture and key design decisions.

\chapter{Implementation}
Describe implementation details, interfaces, and data flow.

\chapter{Evaluation}
Provide experiments, measurements, and discussion. A sample table:
\begin{table}[htbp]
  \centering
  \caption{Sample results}
  \label{tab:results}
  \begin{tabular}{lcc}
    \toprule
    Variant & Metric A & Metric B \\
    \midrule
    Baseline & 0.72 & 0.81 \\
    Ours     & \textbf{0.79} & \textbf{0.86} \\
    \bottomrule
  \end{tabular}
\end{table}

\chapter{Conclusion}
Summarize the report and point to future work.

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`,
  },
};
