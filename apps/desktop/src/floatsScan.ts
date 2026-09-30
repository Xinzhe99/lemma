/**
 * 浮动体扫描（图表导航器数据源）：跨全部 .tex 文件识别 figure / table / equation / algorithm
 * 环境及其体内的 \label / \caption，供大纲面板「图表」视图分组展示与点击跳转。
 *
 * 纯函数、无副作用，可独立测试。注释行忽略：参考 editor 包 stripLineComment 语义的
 * 简化实现——去掉行内首个未被反斜杠转义的 % 及其后内容（\% 是字面百分号，不算注释）。
 */

export type FloatKind = 'figure' | 'table' | 'equation' | 'algorithm';

export interface FloatItem {
  kind: FloatKind;
  /** 所在 .tex 文件（相对项目根路径） */
  file: string;
  /** 环境起始行（1-based） */
  line: number;
  /** 体内首个 \label{...} 的键名 */
  label?: string;
  /** 体内首个 \caption{...} 的纯文本（去 TeX 命令） */
  caption?: string;
}

/** 环境名 → 浮动体类型（星号变体归并；algorithm2e 环境名含数字） */
const ENV_KIND: Readonly<Record<string, FloatKind>> = {
  figure: 'figure',
  'figure*': 'figure',
  table: 'table',
  'table*': 'table',
  equation: 'equation',
  'equation*': 'equation',
  align: 'equation',
  'align*': 'equation',
  algorithm: 'algorithm',
  algorithm2e: 'algorithm',
};

/**
 * 依序匹配：环境起止（env 名支持字母数字与星号）、\label、\caption（支持 * 与 [短标题] 可选参）。
 * caption 分支以 '{' 结尾——花括号参数体需跨行配对提取。
 */
const TOKEN_RE =
  /\\(begin|end)\s*\{([a-zA-Z0-9*]+)\}|\\label\s*\{([^{}]*)\}|\\caption\*?\s*(?:\[[^\]\n]*\]\s*)?\{/g;

/** 行内注释剥离（editor 包 stripLineComment 的简化版：按前导反斜杠个数的奇偶判断 % 是否转义）。
 *  性能：indexOf 定位 '%'，无注释行原样返回（零分配），语义与逐字符扫描版一致。 */
export function stripComment(line: string): string {
  let from = 0;
  for (;;) {
    const i = line.indexOf('%', from);
    if (i === -1) return line;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) backslashes++;
    if (backslashes % 2 === 0) return line.slice(0, i);
    from = i + 1; // \% 是转义百分号，继续找下一个 %
  }
}

/** caption 等原始片段 → 纯文本：去 TeX 命令与花括号、还原转义字符、压缩空白 */
export function plainText(raw: string): string {
  return raw
    .replace(/\\\\/g, ' ') // \\ 换行命令
    .replace(/\\[a-zA-Z]+\*?/g, ' ') // 控制词（\textbf / \emph / \cite 等）
    .replace(/\\([&%$#_{}~^])/g, '$1') // 转义字符还原（\% → %）
    .replace(/[{}]/g, '')
    .replace(/~/g, ' ') // 不断行空格
    .replace(/\s+/g, ' ')
    .trim();
}

interface Frame {
  env: string;
  kind: FloatKind;
  /** \begin 所在行（1-based） */
  line: number;
  label?: string;
  caption?: string;
}

/** 花括号参数体提取：从 lines[startLi] 的 startCol（指向最外层 '{'）出发配对到闭括号。
 *  支持嵌套（至少一层）、\{ \} 转义、跨行。返回原始内容与收尾位置；未闭合返回 null。 */
function extractBracedArg(
  lines: string[],
  startLi: number,
  startCol: number,
): { text: string; endLi: number; endCol: number } | null {
  let depth = 0;
  let text = '';
  for (let li = startLi; li < lines.length; li++) {
    const code = lines[li]!;
    for (let col = li === startLi ? startCol : 0; col < code.length; col++) {
      const ch = code[col]!;
      if (ch === '\\') {
        // 转义序列原样保留（\{ \} 不参与配对）；行尾孤立反斜杠也保留
        if (col + 1 < code.length) {
          text += code.slice(col, col + 2);
          col++;
        } else {
          text += '\\';
        }
        continue;
      }
      if (ch === '{') {
        depth++;
        if (depth > 1) text += ch;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) return { text, endLi: li, endCol: col };
        text += ch;
        continue;
      }
      text += ch;
    }
    text += '\n'; // 未在本行闭合则并入换行继续找
  }
  return null;
}

/** 单文件扫描：cursor 式遍历注释剥离后的行，按出现顺序处理环境起止 / label / caption */
function scanDoc(file: string, doc: string, out: FloatItem[]): void {
  const lines = doc.split('\n').map(stripComment);
  const stack: Frame[] = [];
  let li = 0;
  let col = 0;

  const emit = (frame: Frame): void => {
    const item: FloatItem = { kind: frame.kind, file, line: frame.line };
    if (frame.label) item.label = frame.label;
    if (frame.caption) item.caption = frame.caption;
    out.push(item);
  };

  while (li < lines.length) {
    const code = lines[li]!;
    if (col >= code.length) {
      li++;
      col = 0;
      continue;
    }
    TOKEN_RE.lastIndex = col;
    const m = TOKEN_RE.exec(code);
    if (!m) {
      li++;
      col = 0;
      continue;
    }
    col = m.index + m[0].length;

    if (m[1]) {
      // 环境起止（仅浮动体环境入栈/出栈，其余环境忽略）
      const env = m[2]!;
      if (!(env in ENV_KIND)) continue;
      if (m[1] === 'begin') {
        stack.push({ env, kind: ENV_KIND[env]!, line: li + 1 });
      } else {
        // 从栈顶向下找同名环境闭合；其上的未闭合帧一并收尾（畸形文档容错）
        let k = stack.length - 1;
        while (k >= 0 && stack[k]!.env !== env) k--;
        if (k < 0) continue; // 多余的 \end
        for (let i = stack.length - 1; i >= k; i--) emit(stack[i]!);
        stack.length = k;
      }
    } else if (m[3] !== undefined) {
      // \label：归属当前最内层浮动体
      const top = stack[stack.length - 1];
      const name = m[3].trim();
      if (top && !top.label && name) top.label = name;
    } else {
      // \caption：花括号参数体可跨行；提取后游标跳到闭括号之后
      const top = stack[stack.length - 1];
      const braceStart = m.index + m[0].length - 1;
      const arg = extractBracedArg(lines, li, braceStart);
      if (arg) {
        li = arg.endLi;
        col = arg.endCol + 1;
        const text = plainText(arg.text);
        if (top && top.caption === undefined && text) top.caption = text;
      }
    }
  }
  // 文件结束仍未闭合的环境也输出（导航器应显示实际存在的内容）
  for (const frame of stack) emit(frame);
}

/** 跨全部 .tex 文件扫描浮动体，结果按 file + line 升序排序 */
export function scanFloats(files: Record<string, string>): FloatItem[] {
  const out: FloatItem[] = [];
  for (const file of Object.keys(files)
    .filter((f) => f.endsWith('.tex'))
    .sort()) {
    scanDoc(file, files[file] ?? '', out);
  }
  return out.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
