import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const posterA0: TemplateModule = {
  descriptor: {
    id: 'poster-a0',
    name: '学术海报（A0 横版）',
    venue: '会议海报展示',
    category: 'other',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'TikZ 自绘三栏海报版式（无需 a0poster/tcolorbox 特殊包），A0 横向。',
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
% Lemma 模板：poster-a0
\documentclass[landscape]{article}
\usepackage[a0paper,margin=1.2cm,landscape]{geometry}
\usepackage{tikz}
\usetikzlibrary{positioning,calc,fit,backgrounds}
\usepackage{amsmath,amssymb}
\usepackage{helvet}\renewcommand{\familydefault}{\sfdefault}
\pagestyle{empty}
\begin{document}
\noindent
\begin{tikzpicture}[x=1cm,y=1cm,
  block/.style={draw=black!60, rounded corners=6pt, inner sep=10pt, align=left, font=\Large}]
  \node[block, text width=112cm, minimum height=8cm, fill=black!8, font=\huge\bfseries] (title)
    {{TITLE}\\[6pt] \LARGE {AUTHORS}};
  \node[block, below=8mm of title.south west, anchor=north west, text width=37cm, minimum height=68cm] (col1)
    {\textbf{\LARGE Introduction}\\[8pt] \Large Motivation and context.\\[16pt]
     \textbf{\LARGE Method}\\[8pt] \Large Key idea with equation $E=mc^2$.};
  \node[block, right=8mm of col1.north east, anchor=north west, text width=37cm, minimum height=68cm] (col2)
    {\textbf{\LARGE Results}\\[8pt] \Large Main findings and figure placeholder.};
  \node[block, right=8mm of col2.north east, anchor=north west, text width=37cm, minimum height=68cm] (col3)
    {\textbf{\LARGE Conclusion}\\[8pt] \Large Take-home messages.\\[16pt]
     \textbf{\LARGE References}\\[8pt] \Large Vaswani et al., 2017.};
\end{tikzpicture}
\end{document}
`,
  },
};
