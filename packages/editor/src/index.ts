/** @scholarforge/editor —— WS-A：LaTeX 编辑器（CodeMirror 6） */
export const EDITOR_PACKAGE_VERSION = '0.12.0';

// 语法支持
export {
  latexLanguage,
  latexFoldService,
  latexHighlightStyle,
  latexBase,
} from './latex/language';

// BibTeX 语法支持（.bib 文件模式）
export {
  bibLanguage,
  bibHighlightStyle,
  bibBase,
  bibStartState,
  bibToken,
  type BibState,
} from './latex/bibLanguage';

// 数学公式实时预览（KaTeX）
export {
  extractMathSpans,
  renderMathPreview,
  clearMathPreviewCache,
  createMathPreviewElement,
  type MathSpan,
  type MathPreviewResult,
  type RenderToStringFn,
} from './latex/mathPreview';

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

// 静态检查（lint）
export { lintLatex } from './lint';
export type { LintIssue, LintSeverity, LintOptions } from './lint';

// 拼写与学术用词检查（词表 + 纯函数 + 编辑器扩展）
export {
  checkText,
  spellcheckExtension,
  MISSPELLINGS,
  CONFUSABLES,
  type SpellIssue,
  type Confusable,
} from './spellcheck';

// 可视化表格：tabular 解析/生成（表格编辑器数据层）
export {
  parseTabular,
  gridToTabular,
  escapeCell,
  type TabularGrid,
  type TabularParseError,
  type TabularParseResult,
} from './tablegen';

// 主题
export { scholarforgeTheme, EDITOR_COLORS } from './latex/theme';

// 组件
export { LatexEditor, type LatexEditorProps } from './components/LatexEditor';
export { DiffView, type DiffViewProps } from './components/DiffView';

// 宿主跳转（SyncTeX / 大纲定位）需要的底层句柄
export { EditorView } from '@codemirror/view';
