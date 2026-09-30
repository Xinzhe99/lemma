/**
 * LaTeX 静态检查（lint）：纯函数、无副作用，供引用面板「问题」区与批处理使用。
 *
 * 规则集：
 *  - \begin/\end 环境不配对（栈匹配，含嵌套序号；跨行环境按全文扫描）；
 *  - 行内花括号不平衡（忽略转义 \{ \} 与注释行，复用 outline.ts 的 stripLineComment）；
 *  - \ref{X}/\eqref{X} 无对应 \label（对照 opts.labels，缺省用正文自身收集的 label）；
 *  - \cite{K} 的 K 不在 opts.citekeys（缺省用正文自身收集的 key，即不告警）；
 *  - TODO/FIXME 标记（hint；在原始行上检查，注释内的标记同样可发现）；
 *  - 连续 3 个及以上空行（hint）。
 *
 * 输出按行号升序稳定排序；同一行内同类发现去重。
 */

import { CITE_COMMANDS, collectCitekeys, collectLabels, stripLineComment } from './latex/outline';

export type LintSeverity = 'error' | 'warning' | 'hint';

export interface LintIssue {
  /** 行号（1-based） */
  line: number;
  severity: LintSeverity;
  message: string;
}

export interface LintOptions {
  /** 全项目 \label 集合（跨 .tex 文件合并）；缺省时用正文自身收集，即不做跨文件校验 */
  labels?: Set<string>;
  /** 全项目 citekey 集合（.bib + 文献库合并）；缺省时用正文自身收集，即不做校验 */
  citekeys?: Set<string>;
}

/** \begin/\end 配对栈中的一帧 */
interface EnvFrame {
  env: string;
  /** \begin 所在行（1-based） */
  line: number;
  /** 嵌套序号（1 = 最外层） */
  depth: number;
}

/** 与 outline.ts 的 CITE_ARGS_RE 同构（每个 lintLatex 调用重建，避免 lastIndex 串扰） */
function makeCiteRe(): RegExp {
  return new RegExp(
    `\\\\(?:${CITE_COMMANDS.join('|')})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)*\\{([^}]*)\\}`,
    'g',
  );
}

/** 花括号扫描结果：missing = 缺少的 "}" 数；extra = 多余的 "}" 数 */
function scanBraces(code: string): { missing: number; extra: number } {
  let depth = 0;
  let extra = 0;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '\\') {
      i++; // 跳过转义字符（\{ \} \% \\ 等）
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth < 0) {
        extra++;
        depth = 0;
      }
    }
  }
  return { missing: depth, extra };
}

/** 在栈中自栈顶向下找指定环境名的帧下标；找不到返回 -1 */
function findEnvIndex(stack: EnvFrame[], env: string): number {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i]!.env === env) return i;
  }
  return -1;
}

export function lintLatex(text: string, opts?: LintOptions): LintIssue[] {
  const issues: LintIssue[] = [];
  const add = (line: number, severity: LintSeverity, message: string): void => {
    issues.push({ line, severity, message });
  };

  const labels = opts?.labels ?? new Set(collectLabels(text).map((l) => l.name));
  const citekeys = opts?.citekeys ?? new Set(collectCitekeys(text));

  // 全局正则在每次调用时重建（g 标志的 lastIndex 与并发/重入无关，纯函数更安全）
  const beginEndRe = /\\(begin|end)\s*\{([^}]*)\}/g;
  const refRe = /\\(ref|eqref)\s*\{([^}]*)\}/g;
  const citeRe = makeCiteRe();

  const lines = text.split('\n');
  const stack: EnvFrame[] = [];
  let blankRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const code = stripLineComment(raw);
    const lineNo = i + 1;

    // 规则 1：\begin/\end 环境配对（栈匹配）
    beginEndRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = beginEndRe.exec(code))) {
      const kind = m[1]!;
      const env = m[2]!.trim();
      if (!env) continue;
      if (kind === 'begin') {
        stack.push({ env, line: lineNo, depth: stack.length + 1 });
      } else {
        const idx = findEnvIndex(stack, env);
        if (idx === -1) {
          add(lineNo, 'error', `多余的 \\end{${env}}：没有对应的 \\begin{${env}}`);
        } else {
          // 被当前 \end 提前跳过的更内层环境视为未闭合
          for (let j = stack.length - 1; j > idx; j--) {
            const f = stack[j]!;
            add(
              f.line,
              'error',
              `\\begin{${f.env}} 未闭合（第 ${f.depth} 层，被 \\end{${env}} 提前结束）`,
            );
          }
          stack.length = idx; // 弹出 idx 帧及其上方全部帧
        }
      }
    }

    // 规则 2：行内花括号不平衡（忽略转义与注释）
    const { missing, extra } = scanBraces(code);
    if (extra > 0 && missing > 0) {
      add(lineNo, 'warning', `行内花括号不平衡：多 ${extra} 个 }、缺 ${missing} 个 }`);
    } else if (extra > 0) {
      add(lineNo, 'warning', `行内花括号不平衡：多余的 }（${extra} 个）`);
    } else if (missing > 0) {
      add(lineNo, 'warning', `行内花括号不平衡：缺少 ${missing} 个 }`);
    }

    // 规则 3：\ref/\eqref 悬空引用
    refRe.lastIndex = 0;
    const seenRefs = new Set<string>();
    while ((m = refRe.exec(code))) {
      const cmd = m[1]!;
      const name = m[2]!.trim();
      if (!name || seenRefs.has(name)) continue;
      seenRefs.add(name);
      if (!labels.has(name)) {
        add(lineNo, 'warning', `\\${cmd}{${name}} 没有对应的 \\label`);
      }
    }

    // 规则 4：\cite 未知引用键
    citeRe.lastIndex = 0;
    const seenCite = new Set<string>();
    while ((m = citeRe.exec(code))) {
      for (const part of m[1]!.split(',')) {
        const key = part.trim();
        if (!key || seenCite.has(key)) continue;
        seenCite.add(key);
        if (!citekeys.has(key)) {
          add(lineNo, 'warning', `\\cite{${key}}：未知引用键（不在 .bib / 文献库中）`);
        }
      }
    }

    // 规则 5：TODO/FIXME 标记 —— 在原始行上检查（TODO 恰恰多写在注释里，不先剥离注释）
    const todo = /\b(TODO|FIXME)\b/.exec(raw);
    if (todo) {
      add(lineNo, 'hint', `发现 ${todo[1]} 标记`);
    }

    // 规则 6：连续 3 个及以上空行（首个空行处报一次）
    if (raw.trim() === '') {
      blankRun++;
      if (blankRun === 3) {
        add(lineNo - 2, 'hint', '连续 3 个以上空行（建议最多保留 1 个）');
      }
    } else {
      blankRun = 0;
    }
  }

  // 扫描结束时仍留在栈中的环境均未闭合
  for (const f of stack) {
    add(f.line, 'error', `\\begin{${f.env}} 未闭合（第 ${f.depth} 层）：缺少 \\end{${f.env}}`);
  }

  return issues.sort((a, b) => a.line - b.line);
}
