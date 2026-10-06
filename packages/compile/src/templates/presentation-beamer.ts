import { standardRefsBib } from './bib';
import type { TemplateModule } from './types';

export const presentationBeamer: TemplateModule = {
  descriptor: {
    id: 'presentation-beamer',
    name: '学术幻灯（Beamer 明亮）',
    venue: '组会 / 会议报告',
    category: 'presentation',
    engine: 'tectonic',
    entry: 'main.tex',
    description: '标准 Beamer 明亮主题：标题页、目录、分节、双栏图示与致谢页骨架。',
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
% Lemma 模板：presentation-beamer
\documentclass[aspectratio=169]{beamer}
\usetheme{Madrid}
\usepackage{amsmath,amssymb}
\usepackage{booktabs}
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
\section{Background}
\begin{frame}{Background}
Motivation and context.
\end{frame}
\section{Method}
\begin{frame}{Method}
\begin{columns}
\column{0.5\textwidth}
Key idea
\column{0.5\textwidth}
Result sketch
\end{columns}
\end{frame}
\section{Conclusion}
\begin{frame}{Conclusion}
Summary. Thanks!
\end{frame}
\end{document}
`,
  },
};
