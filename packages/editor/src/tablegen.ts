/**
 * tabular 纯函数解析/生成（可视化表格编辑器的数据层）。
 * parseTabular：抽取第一个 \begin{tabular}{colspec} 块为网格（容忍行尾空格、空行与 % 注释）；
 * gridToTabular：网格 → 完整 tabular 代码（头尾 \hline 惯例）；escapeCell：单元格特殊字符转义。
 * 全部为无副作用函数，可独立测试；复杂结构（嵌套环境、缺失 \end）返回中文 error。
 */

import { stripLineComment } from './latex/outline';

/** 解析成功：列规格 + 网格（单元格为转义还原后的原始文本）+ 是否检测到表头分隔线 */
export interface TabularGrid {
  colspec: string;
  rows: string[][];
  hasHeader: boolean;
}

/** 解析失败：中文错误信息（可直接展示给用户） */
export interface TabularParseError {
  error: string;
}

export type TabularParseResult = TabularGrid | TabularParseError;

const BEGIN = '\\begin{tabular}';
const END = '\\end{tabular}';

/** 仅由 \hline（可多个、可含空格）构成的行：水平分隔线 */
const PURE_RULE = /^(?:\\hline\s*)+$/;
/** 行尾一条或多条 \hline（常见写法 `a & b \\ \hline`） */
const TRAILING_RULES = /(?:\s*\\hline)+$/;
/** 行终止符：\\（容忍 \\* 与 \\[2pt] 变体） */
const TERMINATOR = /\s*\\\\(?:\[[^\]]*\]|\*)?$/;

/** 单元格转义：& % # _ 四字符前加反斜杠（供 gridToTabular 内部使用，亦可单独导出复用） */
export function escapeCell(cell: string): string {
  return cell.replace(/[&%#_]/g, (ch) => `\\${ch}`);
}

/** escapeCell 的逆变换：仅还原 \& \% \# \_ 四种转义，其余反斜杠序列原样保留 */
function unescapeCell(cell: string): string {
  let out = '';
  for (let i = 0; i < cell.length; i++) {
    const ch = cell[i];
    const next = i + 1 < cell.length ? cell[i + 1] : undefined;
    if (ch === '\\' && (next === '&' || next === '%' || next === '#' || next === '_')) {
      out += next;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** 按未转义的 & 拆分一行单元格（成对跳过反斜杠转义序列，\& 不切列） */
function splitCells(row: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '\\') {
      cur += row.slice(i, i + 2);
      i++;
      continue;
    }
    if (ch === '&') {
      cells.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** 从 start（指向 '{'）出发找匹配的 '}'，返回其索引；找不到返回 -1 */
function findMatchingBrace(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++; // 跳过转义字符
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 把一行内出现的多个行终止符 `\\` 拆成多行（v7.8.0）：同一行书写的表格
 * （`\begin{tabular}{cc}a & b \\ c & d\end{tabular}`）此前整行只按一个数据行解析，
 * `b \\ c` 被并进同一个单元格。`\\[2pt]` 与 `\\*` 变体连同其后可选参数一起保留。
 */
function splitRowTerminators(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== '\\') {
      cur += ch;
      continue;
    }
    if (line[i + 1] !== '\\') {
      cur += line.slice(i, i + 2); // 转义/命令整体保留（\% \& \hline …）
      i++;
      continue;
    }
    let j = i + 2;
    if (line[j] === '*') j++;
    const opt = /^\[[^\]]*\]/.exec(line.slice(j));
    if (opt) j += opt[0].length;
    out.push(cur + line.slice(i, j));
    cur = '';
    i = j - 1;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * 解析第一个 \begin{tabular}{colspec} 块。
 * - 单元格分隔 &（\& 为转义不切列）、行终止符 \\（容忍末行缺省、\\* / \\[2pt] 变体，
 *   以及同一行内写多个终止符的情况）；
 * - 容忍行尾空格、空行与 % 注释行/行尾注释（\% 转义不视为注释）；
 * - \hline 出现在首行数据后（独立行或行尾跟随）→ hasHeader=true，头尾惯例的线不影响判定；
 * - 嵌套环境（array/minipage 等）、缺失 \end、缺失列规格 → { error }（中文）。
 */
export function parseTabular(code: string): TabularParseResult {
  const beginIdx = code.indexOf(BEGIN);
  if (beginIdx < 0) return { error: '未找到 \\begin{tabular} 环境' };

  let i = beginIdx + BEGIN.length;
  while (i < code.length && /\s/.test(code[i])) i++;
  if (code[i] !== '{') return { error: '\\begin{tabular} 后缺少列规格 {…}' };
  const braceEnd = findMatchingBrace(code, i);
  if (braceEnd < 0) return { error: '列规格 {…} 未闭合' };
  const colspec = code.slice(i + 1, braceEnd).trim();
  if (!colspec) return { error: '列规格为空' };

  const bodyStart = braceEnd + 1;
  const endIdx = code.indexOf(END, bodyStart);
  if (endIdx < 0) return { error: `缺少 ${END}：tabular 环境未闭合` };

  // 逐行去注释（正确处理 \% 转义）并修剪，空行丢弃；行内多个 \\ 再拆成多行
  const cleaned = code
    .slice(bodyStart, endIdx)
    .split('\n')
    .map((line) => stripLineComment(line).trim())
    .flatMap(splitRowTerminators)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (cleaned.some((line) => line.includes('\\begin{'))) {
    return { error: '表格内包含嵌套环境（如 array/minipage），暂不支持可视化编辑' };
  }

  const rows: string[][] = [];
  let hasHeader = false;

  for (const line of cleaned) {
    if (PURE_RULE.test(line)) {
      // 首行数据之后的分隔线 → 表头分隔（顶部/底部惯例线不满足该条件）
      if (rows.length === 1) hasHeader = true;
      continue;
    }

    let rowSrc = line;
    let ruleAfter = false;
    const rule = TRAILING_RULES.exec(line);
    if (rule && rule.index > 0) {
      rowSrc = line.slice(0, rule.index);
      ruleAfter = true;
    }
    const term = TERMINATOR.exec(rowSrc);
    if (term) rowSrc = rowSrc.slice(0, term.index);

    if (!rowSrc.trim()) {
      // 仅剩终止符/分隔线（如独立一行 "\\ \\hline"）：视为分隔线，不产生数据行
      if (ruleAfter && rows.length === 1) hasHeader = true;
      continue;
    }
    rows.push(splitCells(rowSrc).map(unescapeCell));
    if (ruleAfter && rows.length === 1) hasHeader = true;
  }

  return { colspec, rows, hasHeader };
}

/**
 * 网格 → 完整 tabular 代码。惯例：首行前与末行后各一条 \hline；
 * 单元格经 escapeCell 转义（& % # _）。表头分隔线（首行数据后一条 \hline）的
 * hasHeader 语义由调用方处理：在产物首行数据之后自行插入 "\\hline"。
 */
export function gridToTabular(colspec: string, rows: string[][]): string {
  const lines: string[] = [`\\begin{tabular}{${colspec}}`, '\\hline'];
  for (const row of rows) {
    lines.push(`${row.map(escapeCell).join(' & ')} \\\\`);
  }
  lines.push('\\hline', '\\end{tabular}');
  return lines.join('\n');
}
