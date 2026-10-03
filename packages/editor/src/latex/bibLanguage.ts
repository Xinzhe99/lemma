/**
 * BibTeX 语法支持：StreamLanguage 手写 tokenizer。
 *
 * 识别：`@article` 等条目类型（tagName）、条目类型后首个逗号前的 citekey（atom）、
 * 字段名（propertyName）、值（{...} 花括号平衡 / "…" 引号 / 裸词与数字）、`%` 行注释
 * （值的花括号/引号内的 % 不算注释，保护含 % 的标题等）。
 * 仅在 .bib 文件模式启用（见 LatexEditor 的 filePath prop），不影响既有 stex 行为。
 */

import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';
import type { StringStream } from '@codemirror/language';

/** 字段名：字母开头，后接字母/数字/._+-:（lookahead 要求其后是 =） */
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_.+:-]*(?=\s*=)/;
const NUMBER_RE = /^\d+$/;

type BibMode = 'idle' | 'afterType' | 'citekey' | 'fields' | 'value' | 'valueBrace' | 'valueQuote';

/** tokenizer 跨行状态（值内换行、花括号深度） */
export interface BibState {
  mode: BibMode;
  /** 值内花括号深度（title = {{GPT-4} report} 等嵌套） */
  braceDepth: number;
}

/** 初始状态（独立导出，供测试直接驱动 tokenizer） */
export function bibStartState(): BibState {
  return { mode: 'idle', braceDepth: 0 };
}

/**
 * 单行 token 化；跨行状态经 state 传递。返回 legacy token 名
 * （tagName/atom/propertyName/string/number/comment/bracket，由 StreamLanguage 映射到 tag）。
 * 独立导出，供测试与调试直接驱动（不经 StreamLanguage 包装）。
 */
export function bibToken(stream: StringStream, state: BibState): string | null {
  const ch = stream.peek();

  // % 行注释：值的花括号/引号内不算（{50% off} 是值内容）
  if (ch === '%' && state.mode !== 'valueBrace' && state.mode !== 'valueQuote') {
    stream.skipToEnd();
    return 'comment';
  }

  switch (state.mode) {
    case 'idle': {
      // 条目起点：@type（junk 文本不加 tag）
      if (stream.match(/^@[A-Za-z]+/)) {
        state.mode = 'afterType';
        return 'tagName';
      }
      if (!stream.eatWhile(/[^@%]/)) stream.next();
      return null;
    }
    case 'afterType': {
      if (stream.eatSpace()) return null;
      if (stream.match(/^[{(]/)) {
        state.mode = 'citekey';
        return 'bracket';
      }
      state.mode = 'idle';
      stream.next();
      return null;
    }
    case 'citekey': {
      // 首个逗号前是 citekey，闭括号（无字段条目）直接收尾
      if (stream.eatSpace()) return null;
      if (stream.match(/^,/)) {
        state.mode = 'fields';
        return 'bracket';
      }
      if (stream.match(/^[})]/)) {
        state.mode = 'idle';
        return 'bracket';
      }
      if (stream.eatWhile(/[^,%\s})]/)) return 'atom';
      stream.next();
      return null;
    }
    case 'fields': {
      if (stream.eatSpace()) return null;
      if (stream.match(/^,/)) return 'bracket';
      if (stream.match(/^[})]/)) {
        state.mode = 'idle';
        return 'bracket';
      }
      if (stream.match(FIELD_NAME_RE)) return 'propertyName';
      if (stream.match(/^=/)) {
        state.mode = 'value';
        return null;
      }
      stream.next();
      return null;
    }
    case 'value': {
      if (stream.eatSpace()) return null;
      if (stream.match(/^{/)) {
        state.mode = 'valueBrace';
        state.braceDepth = 1;
        return 'bracket';
      }
      if (stream.match(/^"/)) {
        state.mode = 'valueQuote';
        return 'string';
      }
      // 裸值：数字或单词（month = jan / year = 2017）
      state.mode = 'fields';
      if (stream.eatWhile(/[^\s,%}]/)) {
        return NUMBER_RE.test(stream.current()) ? 'number' : 'string';
      }
      stream.next();
      return null;
    }
    case 'valueBrace': {
      if (stream.match(/^{/)) {
        state.braceDepth++;
        return 'string';
      }
      if (stream.match(/^}/)) {
        state.braceDepth--;
        if (state.braceDepth <= 0) {
          state.mode = 'fields';
          return 'bracket';
        }
        return 'string';
      }
      if (stream.eatWhile(/[^{}]/)) return 'string';
      stream.next();
      return 'string';
    }
    case 'valueQuote': {
      // 引号值：\" 与 \\ 转义对不闭合引号
      if (stream.match(/^[^"\\]+/)) return 'string';
      if (stream.match(/^\\["\\]/)) return 'string';
      if (stream.match(/^"/)) {
        state.mode = 'fields';
        return 'string';
      }
      stream.next();
      return 'string';
    }
  }
}

export const bibLanguage: StreamLanguage<BibState> = StreamLanguage.define<BibState>({
  name: 'bibtex',
  startState: bibStartState,
  token: bibToken,
  languageData: {
    // BibTeX 习惯用 % 注释；值为 {..}/".."，补全括号配对
    commentTokens: { line: '%' },
    closeBrackets: { brackets: ['(', '[', '{', '"'] },
    wordCharacters: '-_.',
  },
});

/**
 * BibTeX 高亮样式（与 lemmaTheme 深色主题协调）：
 * 条目类型紫、citekey 绿、字段名橙、值蓝、注释灰。
 */
export const bibHighlightStyle: HighlightStyle = HighlightStyle.define(
  [
    { tag: t.tagName, color: '#c792ea' },
    { tag: t.atom, color: '#7ee2a8' },
    { tag: t.propertyName, color: '#ffab70' },
    { tag: t.string, color: '#9ecbff' },
    { tag: t.number, color: '#e8b96a' },
    { tag: t.comment, color: '#6b7385', fontStyle: 'italic' },
    { tag: t.bracket, color: '#8b93a7' },
  ],
  { themeType: 'dark' },
);

/** BibTeX 语法层扩展（语言 + 高亮 + 括号配对 + 自动闭合） */
export function bibBase(): Extension[] {
  return [bibLanguage, syntaxHighlighting(bibHighlightStyle), bracketMatching(), closeBrackets()];
}
