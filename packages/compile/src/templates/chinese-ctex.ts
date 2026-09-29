import { chineseRefsBib } from './bib';
import type { TemplateModule } from './types';

/**
 * 中文模板：ctexart。引擎为 tectonic（内部即 XeTeX，等价 xelatex 语义，原生支持中文）；
 * 系统 TeX 用户请用 latexmk -xelatex 编译。
 */
export const chineseCtex: TemplateModule = {
  descriptor: {
    id: 'chinese-ctex',
    name: '中文学术论文（ctex）',
    venue: '中文期刊 / 学位论文草稿 / 课程论文',
    category: 'chinese',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'ctexart 文类 + 中文示例内容；tectonic 默认 XeTeX 引擎（xelatex 语义）即可编译。',
  },
  compileHints: [
    'tectonic -X compile main.tex（tectonic 内部使用 XeTeX 引擎，即 xelatex 语义，原生支持 ctex 与中文）',
    'latexmk -xelatex main.tex（系统 TeX Live / MiKTeX，需 xelatex 语义编译）',
  ],
  notes: ['中文文献条目在 refs.bib 中维护；引用使用 \\cite（上标数字风格）。'],
  files: {
    'refs.bib': chineseRefsBib,
    'main.tex': String.raw`% !TeX program = xelatex
% ScholarForge 模板：chinese-ctex —— 中文学术论文（ctexart）
% 编译：tectonic -X compile main.tex（XeTeX/xelatex 语义）
%   或系统 TeX：latexmk -xelatex main.tex
\documentclass[UTF8,zihao=-4,a4paper]{ctexart}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage[margin=2.5cm]{geometry}
\usepackage[super,square,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

\title{{TITLE}}
\author{{AUTHORS}}
\date{{DATE}\\ \small 投稿目标：{VENUE}}

\begin{document}
\maketitle

\begin{abstract}
{ABSTRACT}
\end{abstract}

\noindent\textbf{关键词：}机器学习；科研写作；LaTeX

\section{引言}
说明研究背景、动机与主要贡献。领域研究现状可参见综述\cite{zhang2023survey}。

\section{相关工作}
概述已有方法并指出不足\cite{wang2020method,liu2024assistant}。

\section{方法}
给出问题定义与所提方法。公式示例：
\begin{equation}
  \mathcal{L}(\theta) = \mathbb{E}_{(x,y)\sim\mathcal{D}}
    \left[ \ell\left(f_\theta(x), y\right) \right].
  \label{eq:objective}
\end{equation}

\section{实验}
介绍实验设置与分析，公式参见式~\ref{eq:objective}，结果见表~\ref{tab:example}。

\begin{table}[htbp]
  \centering
  \caption{示例表格}
  \label{tab:example}
  \begin{tabular}{lcc}
    \toprule
    方法 & 指标一 & 指标二 \\
    \midrule
    基线 & 0.72 & 0.81 \\
    本文 & \textbf{0.79} & \textbf{0.86} \\
    \bottomrule
  \end{tabular}
\end{table}

\section{结论}
总结全文并展望后续工作。

\bibliographystyle{unsrtnat}
\bibliography{refs}

\end{document}
`,
  },
};
