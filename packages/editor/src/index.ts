/** @scholarforge/editor —— WS-A：LaTeX 编辑器（CodeMirror 6） */
export const EDITOR_PACKAGE_VERSION = '0.1.0';

// 语法支持
export {
  latexLanguage,
  latexFoldService,
  latexHighlightStyle,
  latexBase,
} from './latex/language';

// 纯函数解析器
export {
  parseOutline,
  collectLabels,
  collectCitekeys,
  stripLineComment,
  SECTION_COMMANDS,
  CITE_COMMANDS,
  type OutlineNode,
  type LabelEntry,
} from './latex/outline';

// 补全
export {
  latexSupport,
  latexCompletionSource,
  latexSnippetCompletions,
  fuzzyMatch,
  LATEX_SNIPPETS,
  type CitationEntry,
  type LatexSnippet,
  type LatexCompletionOptions,
} from './latex/completion';

// 主题
export { scholarforgeTheme, EDITOR_COLORS } from './latex/theme';

// 组件
export { LatexEditor, type LatexEditorProps } from './components/LatexEditor';
export { DiffView, type DiffViewProps } from './components/DiffView';
