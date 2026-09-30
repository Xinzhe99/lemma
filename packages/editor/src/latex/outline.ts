/**
 * LaTeX 源码纯函数解析器：结构大纲、label、citekey。
 * 全部为无副作用函数，可独立测试与在 worker 中运行。
 */

/** 大纲层级：1=\part … 6=\paragraph */
export interface OutlineNode {
  level: number;
  /** 标题原文（花括号内，未做宏展开） */
  title: string;
  /** 起始行号（1-based） */
  line: number;
  /** 触发命令名，如 "section" */
  command: string;
}

export interface LabelEntry {
  name: string;
  /** 行号（1-based） */
  line: number;
}

/** 分级命令 -> 层级 */
export const SECTION_COMMANDS: Readonly<Record<string, number>> = {
  part: 1,
  chapter: 2,
  section: 3,
  subsection: 4,
  subsubsection: 5,
  paragraph: 6,
};

const SECTION_NAMES = Object.keys(SECTION_COMMANDS).join('|');
const SECTION_RE = new RegExp(`^\\s*\\\\(${SECTION_NAMES})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)?\\{`);

/**
 * 去掉一行中未被转义的行内注释（含其后内容）。
 * `\\%` 中反斜杠为转义输出；`\\\\%` 则 % 开启注释 —— 按前导反斜杠个数的奇偶判断。
 *
 * 性能：用 indexOf 定位 '%'（无注释行直接原样返回，零分配），
 * 语义与逐字符扫描版完全一致。
 */
export function stripLineComment(line: string): string {
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

/** 解析文档大纲；忽略注释行（% 开头，正确处理 \% 转义）。 */
export function parseOutline(doc: string): OutlineNode[] {
  const nodes: OutlineNode[] = [];
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // 快速跳过：首字符为 ASCII 可见字符且非反斜杠时，既非 \s 也非 '\\',
    // ^\s*\\(...) 必不匹配（注释剥离只会删字符、不会引入反斜杠），省掉剥离+正则
    const c0 = line.charCodeAt(0);
    if (c0 >= 33 && c0 <= 126 && c0 !== 92 /* \ */) continue;
    const stripped = stripLineComment(line);
    const m = SECTION_RE.exec(stripped);
    if (!m) continue;
    const command = m[1]!;
    // m[0] 以 '{' 结尾，其绝对位置即标题起始花括号
    const braceStart = m.index + m[0].length - 1;
    const braceEnd = findMatchingBrace(stripped, braceStart);
    if (braceEnd < 0) continue;
    const title = stripped.slice(braceStart + 1, braceEnd).trim();
    nodes.push({ level: SECTION_COMMANDS[command]!, title, line: i + 1, command });
  }
  return nodes;
}

const LABEL_RE = /\\label\{([^}]*)\}/g;

/** 收集全部 \label{...}（忽略注释） */
export function collectLabels(doc: string): LabelEntry[] {
  const labels: LabelEntry[] = [];
  const lines = doc.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const code = stripLineComment(lines[i]!);
    if (code.indexOf('\\') === -1) continue; // 无反斜杠的行不可能含 \label
    LABEL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = LABEL_RE.exec(code))) {
      const name = m[1]!.trim();
      if (name) labels.push({ name, line: i + 1 });
    }
  }
  return labels;
}

/** \cite 家族命令（natbib/biblatex/cleveref 常用） */
export const CITE_COMMANDS: readonly string[] = [
  'cite',
  'citep',
  'citet',
  'citealt',
  'citealp',
  'citeauthor',
  'citeyear',
  'citeyearpar',
  'citetext',
  'parencite',
  'textcite',
  'autocite',
  'footcite',
  'cref',
  'Cref',
];

const CITE_ARGS_RE = new RegExp(
  `\\\\(?:${CITE_COMMANDS.join('|')})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)*\\{([^}]*)\\}`,
  'g',
);

/** 收集引用命令参数里逗号分隔的 key，按出现顺序去重（忽略注释） */
export function collectCitekeys(doc: string): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const line of doc.split('\n')) {
    const code = stripLineComment(line);
    if (code.indexOf('\\') === -1) continue; // 无反斜杠的行不可能含 \cite 家族命令
    CITE_ARGS_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CITE_ARGS_RE.exec(code))) {
      for (const key of m[1]!.split(',')) {
        const k = key.trim();
        if (k && !seen.has(k)) {
          seen.add(k);
          keys.push(k);
        }
      }
    }
  }
  return keys;
}
