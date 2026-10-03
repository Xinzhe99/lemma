import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

/**
 * 会议风格模拟：双栏、小字号、罗马数字节标。
 * 注意：不使用任何真实 IEEE/ACM 版权 cls，全部样式为 Lemma 自写的相似观感。
 */
export const conferenceIeeeLike: TemplateModule = {
  descriptor: {
    id: 'conference-ieee-like',
    name: '会议论文风格（双栏）',
    venue: '会议投稿草稿 / 双栏排版需求',
    category: 'conference',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '双栏紧凑排版、罗马数字节标、跨栏题头，模拟常见会议论文观感（自写样式，非官方 cls）。',
  },
  compileHints: [
    'tectonic -X compile main.tex（推荐：自动下载依赖并完成必要的重跑）',
    'latexmk -pdf -interaction=nonstopmode main.tex（系统 TeX Live / MiKTeX）',
  ],
  notes: [
    '本模板不包含任何真实 IEEE/ACM 版权 class 文件，样式为自写的相似观感，仅供草稿与内部评审使用；正式投稿请改用主办方提供的官方模板。',
  ],
  files: {
    'refs.bib': standardRefsBib,
    'main.tex': String.raw`% !TeX program = tectonic
% Lemma 模板：conference-ieee-like —— 自写样式的双栏会议观感
% 注意：不使用真实 IEEE/ACM cls，样式由下方自写命令构成。
\documentclass[10pt,twocolumn]{article}
\usepackage[T1]{fontenc}
\usepackage{times}
\usepackage[letterpaper,margin=1.9cm,columnsep=0.6cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[font=small,labelfont=bf,skip=4pt]{caption}
\usepackage{titlesec}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}

% ---- 会议观感的自写样式（罗马数字节标 + 紧凑间距） ----
\renewcommand{\thesection}{\Roman{section}}
\renewcommand{\thesubsection}{\Alph{subsection}}
\titleformat{\section}{\normalsize\bfseries}{\thesection.}{0.5em}{}
\titleformat{\subsection}{\normalsize\itshape}{\thesubsection.}{0.5em}{}
\titlespacing*{\section}{0pt}{8pt plus 2pt}{4pt}
\titlespacing*{\subsection}{0pt}{6pt plus 2pt}{3pt}
\setlength{\parindent}{1em}
\pagestyle{empty} % 投稿常用无页码，定稿可改为 plain

\begin{document}

\twocolumn[{%
  \begin{center}
    {\LARGE\bfseries {TITLE}\par}
    \vspace{0.8em}
    {\normalsize {AUTHORS}\par}
    {\small {VENUE} \textbullet\ {DATE}\par}
    \vspace{1em}
    \begin{minipage}{0.92\textwidth}
      \small\textbf{Abstract}---{ABSTRACT}
    \end{minipage}
    \vspace{1.2em}
  \end{center}
}]

\section{Introduction}
Introduce the problem and contributions; cite with \cite{knuth1984literate}.

\section{Related Work}
Position the work among prior approaches \cite{lamport1994latex,greenwade1993ctan}.

\section{Proposed Method}
Describe the method; keep paragraphs short for two-column typesetting.

\section{Experiments}
Report results with tables and figures sized to one column.

\section{Conclusion}
Conclude and point to future work.

\bibliographystyle{unsrtnat}
\bibliography{refs}

\end{document}
`,
  },
};
