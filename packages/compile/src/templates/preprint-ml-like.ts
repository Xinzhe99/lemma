import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

/** 机器学习预印本观感：单栏、1in 版心、作者年份引用、定理环境、Preprint 页脚 */
export const preprintMlLike: TemplateModule = {
  descriptor: {
    id: 'preprint-ml-like',
    name: '机器学习预印本风格',
    venue: 'arXiv / OpenReview 预印本',
    category: 'generic',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '单栏 11pt、1 英寸版心、natbib 作者-年份引用与定理环境，接近 ML 预印本观感。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐：自动下载依赖并完成必要的重跑）',
    'latexmk -pdf -interaction=nonstopmode main.tex（系统 TeX Live / MiKTeX）',
  ],
  notes: [
    '本模板为自写的预印本观感（非 NeurIPS/ICML 官方样式）；正式投稿请切换到主办方提供的模板。',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% ScholarForge 模板：preprint-ml-like —— 机器学习预印本观感（单栏）
\documentclass[11pt]{article}
\usepackage[T1]{fontenc}
\usepackage{mathptmx}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[round,authoryear]{natbib}
\usepackage{fancyhdr}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

\newtheorem{theorem}{Theorem}
\newtheorem{definition}{Definition}

\pagestyle{fancy}
\fancyhf{}
\fancyfoot[C]{\small Preprint --- {VENUE}, {DATE}}
\renewcommand{\headrulewidth}{0pt}

\begin{document}

\begin{center}
  {\LARGE\bfseries {TITLE}\par}
  \vspace{0.5em}
  {\large {AUTHORS}\par}
  \vspace{0.3em}
  {\small Preprint --- {VENUE}, {DATE}\par}
\end{center}

\vspace{0.6em}
\begin{quote}\small
{ABSTRACT}
\end{quote}
\noindent\textbf{Keywords:} deep learning; scientific writing; reproducibility

\section{Introduction}
State the problem and contributions \citep{knuth1984literate,lamport1994latex}.

\section{Related Work}
Survey related approaches \citep{greenwade1993ctan}.

\section{Method}
Introduce notation and the proposed method.

\begin{definition}[Smoothness]
A function $f$ is $L$-smooth if its gradient is $L$-Lipschitz.
\end{definition}

\begin{theorem}[Informal]
Under standard assumptions, the proposed estimator is consistent.
\end{theorem}

\section{Experiments}
Describe setups and results.

\section{Conclusion}
Summarize contributions and limitations.

\bibliographystyle{plainnat}
\bibliography{refs}

\end{document}
`,
  },
};
