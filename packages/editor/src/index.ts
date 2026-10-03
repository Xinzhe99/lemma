/** @lemma/editor —— WS-A：LaTeX 编辑器（CodeMirror 6） */
export const EDITOR_PACKAGE_VERSION = '1.1.0';

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

// 快速修复（spellcheck 命中的一键替换：候选解析纯函数 + hover 浮层扩展 + 会话级忽略集合）
export {
  buildFixOptions,
  quickFixExtension,
  quickFixPanelAt,
  applyQuickFix,
  ignoreWord,
  getIgnoredWords,
  clearIgnoredWords,
  isWordIgnored,
  type QuickFixIssue,
  type QuickFixTarget,
} from './quickFix';

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
export { lemmaTheme, EDITOR_COLORS } from './latex/theme';

// 组件
export { LatexEditor, type LatexEditorProps } from './components/LatexEditor';
export { DiffView, type DiffViewProps } from './components/DiffView';

// 宿主跳转（SyncTeX / 大纲定位）需要的底层句柄
export { EditorView } from '@codemirror/view';

// 学术风格分析（v1.3.0）
export {
  analyzeStyle,
  prepareText,
  splitSentences,
  findPassiveHits,
  findSentenceLine,
  LONG_SENTENCE_WORDS,
  LONG_PARAGRAPH_WORDS,
  FK_TARGET_RANGE,
  WEASEL_WORDS,
  type StyleReport,
  type LongSentence,
  type PassiveHit,
} from './styleReport';

// 编译诊断标注（v1.5.1）
export {
  compileDiagnosticsExtension,
  setCompileDiagnosticsList,
  getCompileDiagnosticsList,
  normalizeDiagFile,
  diagHitsForFile,
  type CompileDiagnostic,
  type DiagLineHit,
} from './compileDiagnostics';

// 引用悬停文献卡（v1.6.0）
export {
  citationHoverExtension,
  citeKeyAt,
  type CitationCard,
  type PaperLookup,
} from './citationHover';
