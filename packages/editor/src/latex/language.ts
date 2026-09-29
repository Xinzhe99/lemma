/**
 * LaTeX 语法支持：StreamLanguage(stex) + 折叠 + 括号配对 + 高亮样式。
 */
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldService,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets } from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import type { EditorState, Extension } from '@codemirror/state';
import { SECTION_COMMANDS, stripLineComment } from './outline';

export const latexLanguage: StreamLanguage<unknown> = StreamLanguage.define({
  ...stex,
  languageData: {
    ...stex.languageData,
    // 让 \command 成为双击选中的整体词
    wordCharacters: '\\',
    // closeBrackets 扩展从此读取配置：为 LaTeX 增加 $ 自动配对
    closeBrackets: { brackets: ['(', '[', '{', '$'] },
  },
});

const HEADING_RE = /^(\s*)\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*[\[{]/;
const BEGIN_RE = /^\s*\\begin\{([^}]+)\}/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 找 \begin{env} 对应 \end{env} 的起始位置；同名环境嵌套计数 */
function findEnvEnd(state: EditorState, beginLine: number, env: string): number | null {
  const begin = new RegExp(`\\\\begin\\{${escapeRegExp(env)}\\}`);
  const end = new RegExp(`\\\\end\\{${escapeRegExp(env)}\\}`);
  let depth = 1;
  for (let n = beginLine + 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const text = stripLineComment(line.text);
    const endMatch = end.exec(text);
    if (endMatch && --depth === 0) return line.from + endMatch.index;
    if (begin.test(text)) depth++;
  }
  return null;
}

/** 找下一个“同级或更高级”标题行的行首位置 */
function findNextHeading(state: EditorState, fromLine: number, level: number): number | null {
  for (let n = fromLine + 1; n <= state.doc.lines; n++) {
    const m = HEADING_RE.exec(stripLineComment(state.doc.line(n).text));
    if (m && SECTION_COMMANDS[m[2]!]! <= level) return state.doc.line(n).from;
  }
  return null;
}

/** 对 \begin...\end 块与 \section 系标题提供折叠（保留首行可见） */
export const latexFoldService: Extension = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const text = stripLineComment(line.text);

  const begin = BEGIN_RE.exec(text);
  if (begin) {
    const endPos = findEnvEnd(state, line.number, begin[1]!);
    if (endPos != null && endPos > line.to) return { from: line.to, to: endPos };
    return null;
  }

  const heading = HEADING_RE.exec(text);
  if (heading) {
    const level = SECTION_COMMANDS[heading[2]!]!;
    const end = findNextHeading(state, line.number, level) ?? state.doc.length;
    if (end > line.to) return { from: line.to, to: end };
    return null;
  }
  return null;
});

/**
 * 高亮样式（与 scholarforgeTheme 深色主题协调）：
 * 命令蓝紫、环境绿、注释灰、数学橙。stex 模式输出的 legacy style
 * 经 StreamLanguage 映射：命令=tagName、环境名/label=atom、注释=comment、数学定界符=keyword。
 */
export const latexHighlightStyle: HighlightStyle = HighlightStyle.define(
  [
    { tag: t.tagName, color: '#a5b0ff' },
    { tag: t.atom, color: '#7ee2a8' },
    { tag: t.comment, color: '#6b7385', fontStyle: 'italic' },
    { tag: t.keyword, color: '#ffab70' },
    { tag: t.number, color: '#e8b96a' },
    { tag: t.string, color: '#9ecbff' },
    { tag: t.bracket, color: '#8b93a7' },
    { tag: [t.variableName, t.special(t.variableName)], color: '#d7dce8', fontStyle: 'italic' },
    { tag: t.invalid, color: '#ff7a85', textDecoration: 'underline' },
  ],
  { themeType: 'dark' },
);

/** 语法层基础扩展（语言 + 折叠 + 括号配对 + 自动闭合 + 高亮） */
export function latexBase(): Extension[] {
  return [
    latexLanguage,
    latexFoldService,
    syntaxHighlighting(latexHighlightStyle),
    bracketMatching(),
    closeBrackets(),
  ];
}
