/**
 * LaTeX 补全：引用（\cite 系）、交叉引用（\ref 系）、命令/环境 snippet。
 */
import {
  autocompletion,
  snippet,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { CITE_COMMANDS, collectLabels } from './outline';
import { latexBase } from './language';

/** 引用条目（共享包未定义此形状，WS-A 内定义并导出） */
export interface CitationEntry {
  citekey: string;
  title: string;
  authors?: string;
  year?: number;
}

export interface LatexCompletionOptions {
  getCitations?: () => CitationEntry[];
  /** 跨文件 \label 收集（v2.3.0：\ref 补全覆盖全项目 label，不限当前文件） */
  getProjectLabels?: () => { name: string; line: number; file?: string }[];
}

/** 大小写不敏感的子序列匹配：query 为空恒真 */
export function fuzzyMatch(query: string, target: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let ti = 0;
  for (let i = 0; i < q.length; i++) {
    const idx = t.indexOf(q[i]!, ti);
    if (idx < 0) return false;
    ti = idx + 1;
  }
  return true;
}

/** 命令/环境 snippet 定义（label 即触发词） */
export interface LatexSnippet {
  label: string;
  detail: string;
  template: string;
}

export const LATEX_SNIPPETS: readonly LatexSnippet[] = [
  {
    label: 'figure',
    detail: '插图环境（含 caption 与 label）',
    template: '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=${1:0.8}\\linewidth]{${2:图像文件}}\n  \\caption{${3:图题}}\n  \\label{fig:${4:标签}}\n\\end{figure}',
  },
  {
    label: 'table',
    detail: '表格环境（含 tabular）',
    template: '\\begin{table}[htbp]\n  \\centering\n  \\caption{${1:表题}}\n  \\label{tab:${2:标签}}\n  \\begin{tabular}{${3:列格式}}\n    ${4:表体} \\\\\n  \\end{tabular}\n\\end{table}',
  },
  {
    label: 'equation',
    detail: '编号公式',
    template: '\\begin{equation}\n  \\label{eq:${1:标签}}\n  ${2:公式}\n\\end{equation}',
  },
  {
    label: 'align',
    detail: '多行对齐公式（编号）',
    template: '\\begin{align}\n  ${1:公式} &= ${2:表达式} \\\\\n  &= ${3:表达式}\n\\end{align}',
  },
  {
    label: 'itemize',
    detail: '无序列表',
    template: '\\begin{itemize}\n  \\item ${1:条目}\n\\end{itemize}',
  },
  {
    label: 'enumerate',
    detail: '有序列表',
    template: '\\begin{enumerate}\n  \\item ${1:条目}\n\\end{enumerate}',
  },
  {
    label: 'theorem',
    detail: '定理环境',
    template: '\\begin{theorem}[${1:名称}]\n  ${2:定理陈述}\n\\end{theorem}',
  },
  {
    label: 'lemma',
    detail: '引理环境',
    template: '\\begin{lemma}[${1:名称}]\n  ${2:引理陈述}\n\\end{lemma}',
  },
  {
    label: 'definition',
    detail: '定义环境',
    template: '\\begin{definition}[${1:名称}]\n  ${2:定义内容}\n\\end{definition}',
  },
  {
    label: 'corollary',
    detail: '推论环境',
    template: '\\begin{corollary}[${1:名称}]\n  ${2:推论内容}\n\\end{corollary}',
  },
  {
    label: 'proof',
    detail: '证明环境',
    template: '\\begin{proof}\n  ${1:证明过程}\n\\end{proof}',
  },
  {
    label: 'abstract',
    detail: '摘要',
    template: '\\begin{abstract}\n  ${1:摘要内容}\n\\end{abstract}',
  },
  {
    label: 'frame',
    detail: 'Beamer 幻灯片',
    template: '\\begin{frame}{${1:标题}}\n  ${2:内容}\n\\end{frame}',
  },
  {
    label: 'part',
    detail: '部分（\\part）',
    template: '\\part{${1:标题}}',
  },
  {
    label: 'chapter',
    detail: '章（\\chapter）',
    template: '\\chapter{${1:标题}}\n\\label{chp:${2:标签}}',
  },
  {
    label: 'section',
    detail: '节（\\section）',
    template: '\\section{${1:标题}}\n\\label{sec:${2:标签}}',
  },
  {
    label: 'subsection',
    detail: '小节（\\subsection）',
    template: '\\subsection{${1:标题}}\n\\label{ssec:${2:标签}}',
  },
  // —— 数学命令片段（v1.8.0：高频数学排版操作） ——
  {
    label: 'frac',
    detail: '分式 \\frac{}{}',
    template: '\\frac{${1:分子}}{${2:分母}}',
  },
  {
    label: 'dfrac',
    detail: '大分式 \\dfrac{}{}',
    template: '\\dfrac{${1:分子}}{${2:分母}}',
  },
  {
    label: 'sqrt',
    detail: '根号 \\sqrt{}',
    template: '\\sqrt{${1:表达式}}',
  },
  {
    label: 'sum',
    detail: '求和 \\sum_{i=1}^{n}',
    template: '\\sum_{${1:i}=1}^{${2:n}}',
  },
  {
    label: 'prod',
    detail: '连乘 \\prod_{i=1}^{n}',
    template: '\\prod_{${1:i}=1}^{${2:n}}',
  },
  {
    label: 'int',
    detail: '积分 \\int_{a}^{b}',
    template: '\\int_{${1:a}}^{${2:b}}',
  },
  {
    label: 'lim',
    detail: '极限 \\lim_{n\\to\\infty}',
    template: '\\lim_{${1:n} \\to ${2:\\infty}}',
  },
  {
    label: 'inf',
    detail: '下确界 \\inf',
    template: '\\inf_{${1:x} \\in ${2:S}}',
  },
  {
    label: 'sup',
    detail: '上确界 \\sup',
    template: '\\sup_{${1:x} \\in ${2:S}}',
  },
  {
    label: 'max',
    detail: '最大值 \\max',
    template: '\\max_{${1:x} \\in ${2:S}}',
  },
  {
    label: 'min',
    detail: '最小值 \\min',
    template: '\\min_{${1:x} \\in ${2:S}}',
  },
  {
    label: 'bigcup',
    detail: '大并集 \\bigcup',
    template: '\\bigcup_{${1:i} \\in ${2:I}}',
  },
  {
    label: 'bigcap',
    detail: '大交集 \\bigcap',
    template: '\\bigcap_{${1:i} \\in ${2:I}}',
  },
  {
    label: 'overline',
    detail: '上划线 \\overline{}',
    template: '\\overline{${1:表达式}}',
  },
  {
    label: 'underline',
    detail: '下划线 \\underline{}',
    template: '\\underline{${1:表达式}}',
  },
  {
    label: 'widehat',
    detail: '宽帽子 \\widehat{}',
    template: '\\widehat{${1:表达式}}',
  },
  {
    label: 'widetilde',
    detail: '宽波浪 \\widetilde{}',
    template: '\\widetilde{${1:表达式}}',
  },
  {
    label: 'vec',
    detail: '向量箭头 \\vec{}',
    template: '\\vec{${1:符号}}',
  },
  {
    label: 'hat',
    detail: '帽子 \\hat{}',
    template: '\\hat{${1:符号}}',
  },
  {
    label: 'bar',
    detail: '横线 \\bar{}',
    template: '\\bar{${1:符号}}',
  },
  {
    label: 'tilde',
    detail: '波浪 \\tilde{}',
    template: '\\tilde{${1:符号}}',
  },
  {
    label: 'mathbf',
    detail: '粗体 \\mathbf{}',
    template: '\\mathbf{${1:符号}}',
  },
  {
    label: 'mathcal',
    detail: '花体 \\mathcal{}',
    template: '\\mathcal{${1:符号}}',
  },
  {
    label: 'mathbb',
    detail: '黑板粗体 \\mathbb{}',
    template: '\\mathbb{${1:符号}}',
  },
  // —— 数学环境 ——
  {
    label: 'cases',
    detail: '分段函数环境',
    template: '\\begin{cases}\n  ${1:条件1}, & \\text{if } ${2:条件} \\\\\n  ${3:条件2}, & \\text{otherwise}\n\\end{cases}',
  },
  {
    label: 'split',
    detail: '公式内换行对齐',
    template: '\\begin{split}\n  ${1:表达式} &= ${2:推导} \\\\\n  &= ${3:结果}\n\\end{split}',
  },
  {
    label: 'gather',
    detail: '居中多行公式（不对齐）',
    template: '\\begin{gather}\n  ${1:公式1} \\\\\n  ${2:公式2}\n\\end{gather}',
  },
  {
    label: 'multline',
    detail: '长公式换行',
    template: '\\begin{multline}\n  ${1:长公式第一段} \\\\\n  = ${2:第二段} \\\\\n  = ${3:结果}\n\\end{multline}',
  },
  {
    label: 'pmatrix',
    detail: '圆括号矩阵',
    template: '\\begin{pmatrix}\n  ${1:a} & ${2:b} \\\\\n  ${3:c} & ${4:d}\n\\end{pmatrix}',
  },
  {
    label: 'bmatrix',
    detail: '方括号矩阵',
    template: '\\begin{bmatrix}\n  ${1:a} & ${2:b} \\\\\n  ${3:c} & ${4:d}\n\\end{bmatrix}',
  },
  {
    label: 'aligned',
    detail: '公式内对齐（无编号）',
    template: '\\begin{aligned}\n  ${1:表达式} &= ${2:推导} \\\\\n  &= ${3:结果}\n\\end{aligned}',
  },
  // —— 文本格式 ——
  {
    label: 'textbf',
    detail: '粗体 \\textbf{}',
    template: '\\textbf{${1:文本}}',
  },
  {
    label: 'textit',
    detail: '斜体 \\textit{}',
    template: '\\textit{${1:文本}}',
  },
  {
    label: 'emph',
    detail: '强调 \\emph{}',
    template: '\\emph{${1:文本}}',
  },
  {
    label: 'texttt',
    detail: '等宽 \\texttt{}',
    template: '\\texttt{${1:文本}}',
  },
  {
    label: 'underline',
    detail: '下划线 \\underline{}',
    template: '\\underline{${1:文本}}',
  },
  {
    label: 'footnote',
    detail: '脚注 \\footnote{}',
    template: '\\footnote{${1:脚注内容}}',
  },
  {
    label: 'citep',
    detail: '括号引用 \\citep{}',
    template: '\\citep{${1:citekey}}',
  },
  {
    label: 'citet',
    detail: '叙述引用 \\citet{}',
    template: '\\citet{${1:citekey}}',
  },
];

/** 从文档中解析 \\newcommand 定义的用户自定义命令（v2.6.0 ②） */
const NEWCOMMAND_RE = /\\newcommand\*?\s*(?:\{\\([a-zA-Z@]+)\}|\\([a-zA-Z@]+))\s*\{([^}]*)\}/g;

export interface UserCommand {
  name: string;
  definition: string;
}

export function parseUserCommands(text: string): UserCommand[] {
  const out: UserCommand[] = [];
  for (const m of text.matchAll(NEWCOMMAND_RE)) {
    const name = m[1] ?? m[2];
    const definition = m[3] ?? '';
    if (name) out.push({ name, definition });
  }
  return out;
}

/** 预构建 snippet 补全项（apply 为 snippet 展开函数） */
const SNIPPET_COMPLETIONS: ReadonlyMap<string, Completion> = new Map(
  LATEX_SNIPPETS.map((s) => [
    s.label,
    { label: s.label, detail: s.detail, type: 'snippet', apply: snippet(s.template) } satisfies Completion,
  ]),
);

/** 选中引用/label 后按需补上闭合花括号 */
function keyApplier(key: string): Completion['apply'] {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const after = view.state.doc.sliceString(to, to + 1);
    const insert = after === '}' || after === ',' ? key : `${key}}`;
    view.dispatch({ changes: { from, to, insert } });
  };
}

function citationDetail(e: CitationEntry): string {
  const year = e.year != null ? ` (${e.year})` : '';
  return `${e.title}${year}`;
}

const CITE_TRIGGER = new RegExp(
  `\\\\(?:${CITE_COMMANDS.join('|')})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)*\\{([^}]*)$`,
);

const REF_TRIGGER = /\\(?:ref|eqref|autoref|pageref)\*?\s*\{([^},]*)$/;

/** \cite 系命令内的 citekey 补全 */
function citeCompletion(
  context: CompletionContext,
  getCitations: (() => CitationEntry[]) | undefined,
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const m = CITE_TRIGGER.exec(before);
  if (!m) return null;
  const tail = m[1]!.slice(m[1]!.lastIndexOf(',') + 1);
  const query = tail.trim();
  const from = context.pos - query.length;
  const entries = getCitations?.() ?? [];
  const options = entries
    .filter((e) => fuzzyMatch(query, e.citekey))
    .map<Completion>((e) => ({
      label: e.citekey,
      detail: citationDetail(e),
      type: 'constant',
      apply: keyApplier(e.citekey),
    }));
  return { from, options, validFor: /^[a-zA-Z0-9_.:+\-]*$/ };
}

/** \ref 系命令内的 label 补全（v2.3.0：当前文件 + 全项目跨文件） */
function refCompletion(
  context: CompletionContext,
  getProjectLabels?: () => { name: string; line: number; file?: string }[],
): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const m = REF_TRIGGER.exec(before);
  if (!m) return null;
  const query = m[1]!.trim();
  const from = context.pos - query.length;

  // 本文件 label（优先展示，detail 带行号）
  const localLabels = collectLabels(context.state.doc.toString());
  // 跨文件 label（宿主注入；同名的本地 label 已覆盖，去重后追加）
  const projectLabels = getProjectLabels?.() ?? [];
  const localNames = new Set(localLabels.map((l) => l.name));
  const crossFile = projectLabels.filter((l) => !localNames.has(l.name));

  const mk = (l: { name: string; line: number; file?: string }, cross: boolean): Completion => ({
    label: l.name,
    detail: cross
      ? `${l.file}:${l.line}（跨文件）`
      : `第 ${l.line} 行定义`,
    type: 'variable',
    apply: keyApplier(l.name),
  });

  const options = [
    ...localLabels.filter((l) => fuzzyMatch(query, l.name)).map((l) => mk(l, false)),
    ...crossFile.filter((l) => fuzzyMatch(query, l.name)).map((l) => mk(l, true)),
  ];
  return { from, options, validFor: /^[a-zA-Z0-9_.:+\-]*$/ };
}

/** \command 触发的 snippet 补全 */
export function latexSnippetCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/\\[a-zA-Z@]*/);
  if (!m) return null;
  if (m.from === m.to && !context.explicit) return null;
  const query = m.text.slice(1).toLowerCase();
  const options: Completion[] = [];
  for (const s of LATEX_SNIPPETS) {
    if (!fuzzyMatch(query, s.label)) continue;
    options.push(SNIPPET_COMPLETIONS.get(s.label)!);
  }
  // 用户自定义命令（\newcommand 定义，detail 显示展开体）（v2.6.0 ②）
  const userCmds = parseUserCommands(context.state.doc.toString());
  for (const uc of userCmds) {
    if (!fuzzyMatch(query, uc.name)) continue;
    if (options.some((o) => o.label === uc.name)) continue; // 与内置重名跳过
    options.push({
      label: uc.name,
      detail: uc.definition.slice(0, 50) || '(user command)',
      type: 'keyword',
      boost: 10, // 用户自定义优先于内置
    });
  }
  // 前缀命中优先，其余按字母序
  const rank = (label: string) => (label.startsWith(query) ? 0 : 1);
  options.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  return { from: m.from, to: m.to, options, validFor: /^\\[a-zA-Z@]*$/ };
}

/** 组合补全源：引用 -> 交叉引用 -> snippet */
export function latexCompletionSource(opts: LatexCompletionOptions = {}): CompletionSource {
  return (context) =>
    citeCompletion(context, opts.getCitations)
    ?? refCompletion(context, opts.getProjectLabels)
    ?? latexSnippetCompletions(context);
}

/** LaTeX 全量语言支持：语法、折叠、配对、高亮 + 补全 */
export function latexSupport(opts: LatexCompletionOptions = {}): Extension[] {
  return [
    ...latexBase(),
    autocompletion({ override: [latexCompletionSource(opts)] }),
  ];
}
