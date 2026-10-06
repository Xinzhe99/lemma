import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const presentationBeamerDark: TemplateModule = {
  descriptor: {
    id: 'presentation-beamer-dark',
    name: '学术幻灯（Beamer 深色）',
    venue: '组会 / 会议报告（深色投影）',
    category: 'presentation',
    engine: 'tectonic',
    entry: 'main.tex',
    description: 'Beamer 深色配色版（自写配色，无需额外主题包）。',
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
% Lemma 模板：presentation-beamer-dark
\documentclass[aspectratio=169]{beamer}
\usetheme{default}
\setbeamercolor{background canvas}{bg=black!95}
\setbeamercolor{normal text}{fg=white}
\setbeamercolor{frametitle}{fg=cyan!70!white}
\setbeamercolor{title}{fg=white}
\title{{TITLE}}
\author{{AUTHORS}}
\date{{DATE}}
\begin{document}
\begin{frame}
\titlepage
\end{frame}
\begin{frame}{Outline}
\tableofcontents
\end{frame}
\section{Idea}
\begin{frame}{Idea}
One idea per slide.
\end{frame}
\begin{frame}{Thanks}
Questions?
\end{frame}
\end{document}
`,
  },
};
