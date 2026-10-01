/** @scholarforge/editor —— WS-A：LaTeX 编辑器（CodeMirror 6） */
export const EDITOR_PACKAGE_VERSION = '1.0.0';

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

// 学术同义词悬停建议（写作用词升级：good→favorable…）
export {
  THESAURUS,
  lookupThesaurus,
  thesaurusAtPosition,
  thesaurusExtension,
  type ThesaurusLookup,
  type ThesaurusHit,
} from './thesaurus';

// 拼写与学术用词检查（词表 + 纯函数 + 编辑器扩展）
export {
  checkText,
  spellcheckExtension,
  MISSPELLINGS,
  CONFUSABLES,
  CHINGLISH,
  type SpellIssue,
  type Confusable,
  type ChinglishRule,
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

// 外部表格数据导入：CSV/TSV 文本与 .xlsx 工作簿 → 字符串网格（表格编辑器数据源层）
export { parseCsv, parseXlsx } from './tabularData';

// 主题
export { scholarforgeTheme, EDITOR_COLORS } from './latex/theme';

// 组件
export { LatexEditor, type LatexEditorProps } from './components/LatexEditor';
export { DiffView, type DiffViewProps } from './components/DiffView';

// 宿主跳转（SyncTeX / 大纲定位）需要的底层句柄
export { EditorView } from '@codemirror/view';
