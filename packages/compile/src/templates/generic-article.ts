import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const genericArticle: TemplateModule = {
  descriptor: {
    id: 'generic-article',
    name: '通用学术论文',
    venue: '通用期刊 / 课程论文 / 目标未定',
    category: 'generic',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'article 文类 + natbib 数字引用，含引言/相关工作/方法/实验/结论的基本节构。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐：自动下载依赖并完成必要的重跑）',
    'latexmk -pdf -interaction=nonstopmode main.tex（系统 TeX Live / MiKTeX）',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% Lemma 模板：generic-article —— 通用学术论文（article + natbib）
\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

\title{{TITLE}}
\author{{AUTHORS}}
\date{{DATE}\\ \small Submitted to: {VENUE}}

\begin{document}
\maketitle

\begin{abstract}
{ABSTRACT}
\end{abstract}

\section{Introduction}
State the research problem, motivation, and contributions. Typesetting with
LaTeX goes back to \citet{knuth1984literate}, and the classic user guide is
\citet{lamport1994latex}.

\section{Related Work}
Summarize prior work and position your contribution. Additional resources are
indexed by \citet{greenwade1993ctan}.

\section{Method}
Describe the proposed approach. An equation example:
\begin{equation}
  \mathcal{L}(\theta) = \sum_{i=1}^{n} \ell(f_\theta(x_i), y_i).
  \label{eq:objective}
\end{equation}

\section{Experiments}
Report setups, datasets, baselines, and results. Reference tables and figures
with \verb|\ref|, e.g., Equation~\ref{eq:objective}.

\section{Conclusion}
Summarize findings and outline future work.

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`,
  },
};
