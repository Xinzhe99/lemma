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
];

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

/** \ref 系命令内的 label 补全（数据来自当前文档的 \label） */
function refCompletion(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const m = REF_TRIGGER.exec(before);
  if (!m) return null;
  const query = m[1]!.trim();
  const from = context.pos - query.length;
  const labels = collectLabels(context.state.doc.toString());
  const options = labels
    .filter((l) => fuzzyMatch(query, l.name))
    .map<Completion>((l) => ({
      label: l.name,
      detail: `第 ${l.line} 行定义`,
      type: 'variable',
      apply: keyApplier(l.name),
    }));
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
  // 前缀命中优先，其余按字母序
  const rank = (label: string) => (label.startsWith(query) ? 0 : 1);
  options.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  return { from: m.from, to: m.to, options, validFor: /^\\[a-zA-Z@]*$/ };
}

/** 组合补全源：引用 -> 交叉引用 -> snippet */
export function latexCompletionSource(opts: LatexCompletionOptions = {}): CompletionSource {
  return (context) =>
    citeCompletion(context, opts.getCitations)
    ?? refCompletion(context)
    ?? latexSnippetCompletions(context);
}

/** LaTeX 全量语言支持：语法、折叠、配对、高亮 + 补全 */
export function latexSupport(opts: LatexCompletionOptions = {}): Extension[] {
  return [
    ...latexBase(),
    autocompletion({ override: [latexCompletionSource(opts)] }),
  ];
}
