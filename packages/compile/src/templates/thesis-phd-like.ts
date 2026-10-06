import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const thesisPhdLike: TemplateModule = {
  descriptor: {
    id: 'thesis-phd-like',
    name: '博士论文骨架（Book 多章）',
    venue: '学位论文草稿',
    category: 'thesis',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'Book 类多章结构：扉页、声明、摘要、目录、图目录、多章与附录骨架。',
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
% Lemma 模板：thesis-phd-like
\documentclass[11pt,oneside]
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[numbers,sort&compress]{natbib}
\usepackage[colorlinks=true,linkcolor=blue,citecolor=blue,urlcolor=blue]{hyperref}
\usepackage[a4paper,margin=2.6cm]{geometry}
\usepackage{setspace}\onehalfspacing
\title{\Large {TITLE}}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\maketitle
\chapter*{Declaration}
I declare that this thesis is my own work.
\chapter*{Abstract}
{ABSTRACT}
\tableofcontents
\listoffigures
\chapter{Introduction}
\chapter{Literature review}
\chapter{Method}
\chapter{Experiments}
\chapter{Conclusion and future work}
\appendix
\chapter{Derivations}
\bibliographystyle{unsrt}
\bibliography{refs}
\end{document}
`,
  },
};
