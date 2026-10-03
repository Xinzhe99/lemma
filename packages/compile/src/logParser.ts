import type { Diagnostic, DiagnosticSeverity } from '@lemma/shared';

/**
 * 解析 (pdf/Xe/Lua)LaTeX 编译日志为结构化诊断列表。
 *
 * 覆盖的格式子集（TeX Live / tectonic 常见输出）：
 * - `! <message>` 错误行，配合其后若干行内的 `l.<num>` 上下文行定位行号；
 * - `-file-line-error` 风格 `<file>:<line>: <message>`（latexmk 传入该参数时出现）；
 * - `LaTeX Warning: ...`，含 Citation/Reference undefined、multiply defined、
 *   Label(s) may have changed / Rerun to get 等重跑提示；
 * - `Overfull/Underfull \hbox (<n>pt ...) ... at lines N--M`。
 *
 * 文件归属采用简化的括号栈推断：`(./path/file.tex` 入栈、`)` 出栈；
 * 非文件形态的括号（如 `(preloaded format=pdflatex)`）只计入深度不入栈；
 * 归因时只取栈顶最近的 .tex 文件。日志可能被折行/截断，归属为尽力而为。
 */
export function parseLatexLog(log: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = log.split(/\r?\n/);
  const stack: { file: string; depth: number }[] = [];
  let depth = 0;

  const currentTexFile = (): string | undefined => {
    for (let i = stack.length - 1; i >= 0; i--) {
      if (/\.tex$/i.test(stack[i].file)) return stack[i].file;
    }
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1) 括号栈维护（行内逐字符扫描，兼容一行多个括号）
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '(') {
        depth++;
        const m = /^([^()\s]+)/.exec(line.slice(c + 1));
        if (m && SOURCE_FILE_RE.test(m[1])) {
          stack.push({ file: normalizeFile(m[1]), depth });
        }
      } else if (ch === ')') {
        if (stack.length > 0 && stack[stack.length - 1].depth === depth) stack.pop();
        depth = Math.max(0, depth - 1);
      }
    }

    // 2) -file-line-error 风格：./main.tex:12: message
    const fle = /^(\.?\/?[^\s:][^:\s]*):(\d+):\s?(.*)$/.exec(line);
    if (fle && !fle[1].startsWith('(') && fle[3]) {
      const message = fle[3].trim();
      diagnostics.push({
        severity: /^LaTeX Warning/.test(message) ? 'warning' : 'error',
        message,
        file: normalizeFile(fle[1]),
        line: Number(fle[2]),
      });
      continue;
    }

    // 3) `! <message>` 错误（nonstopmode 下的经典格式）
    const err = /^!\s(.*)$/.exec(line);
    if (err) {
      const d: Diagnostic = { severity: 'error', message: err[1].trim(), file: currentTexFile() };
      // 向后短距离查找 `l.<num>` 行取行号；遇到下一个错误则停止
      for (let j = i + 1; j < Math.min(i + 8, lines.length); j++) {
        if (lines[j].startsWith('!')) break;
        const lm = /^l\.(\d+)/.exec(lines[j]);
        if (lm) {
          d.line = Number(lm[1]);
          break;
        }
      }
      diagnostics.push(d);
      continue;
    }

    // 4) LaTeX Warning
    const warn = /^LaTeX Warning:\s?(.*)$/.exec(line);
    if (warn) {
      const d: Diagnostic = { severity: 'warning', message: warn[1].trim(), file: currentTexFile() };
      const lm = /on input line (\d+)/.exec(warn[1]);
      if (lm) d.line = Number(lm[1]);
      diagnostics.push(d);
      continue;
    }

    // 5) Overfull / Underfull box（消息保留原文，便于展示 pt 数值）
    const box = /^(Overfull|Underfull) \\[hv]box \(([^)]+)\)/.exec(line);
    if (box) {
      const severity: DiagnosticSeverity = box[1] === 'Overfull' ? 'warning' : 'info';
      const d: Diagnostic = { severity, message: line.trim(), file: currentTexFile() };
      const lm = /lines (\d+)--(\d+)/.exec(line);
      if (lm) d.line = Number(lm[1]);
      diagnostics.push(d);
    }
  }

  return diagnostics;
}

const SOURCE_FILE_RE = /\.(tex|sty|cls|bib|dtx|ltx|cfg|def|fd|clo|aux|bbl|toc|lof|lot|out)$/i;

function normalizeFile(p: string): string {
  let s = p.trim();
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}
