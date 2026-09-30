/**
 * ScholarForge 编辑器主题：结构色全部经 CSS 变量（--cm-*）引用，变量由宿主
 * styles.css 在 :root（亮色，默认）与 [data-theme='dark']（暗色）提供，
 * 编辑器随应用主题实时切换，无需重建 EditorView。
 *
 * 主题标记为亮色（dark: false）：language.ts 中 themeType='dark' 的旧高亮
 * 样式随之失效，由下方不限定 themeType 的 latexTokenHighlight（变量取色，
 * 亮底重调：命令深蓝紫/环境绿/注释浅灰/数学橙棕）统一接管两种主题的配色。
 */
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/** 默认（亮色）取色表：仅供旧引用兼容，实际渲染一律走上方 CSS 变量。 */
export const EDITOR_COLORS = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  muted: '#a0a0aa',
  border: '#e9e9ec',
  accent: '#10a37f',
  addedGreen: '#157347',
  removedRed: '#b03a36',
} as const;

/** 引用 --cm-* 变量并附亮色 fallback（独立于宿主使用时仍可渲染） */
const cv = (name: string, fallback: string): string => `var(${name}, ${fallback})`;

/**
 * 语法高亮（stex StreamLanguage 映射：命令=tagName、环境/label=atom、
 * 注释=comment、数学定界符=keyword）。不限定 themeType，配合亮色主题
 * 标记成为唯一生效的高亮样式，颜色经变量随明暗主题切换。
 */
export const latexTokenHighlight: HighlightStyle = HighlightStyle.define([
  { tag: t.tagName, color: cv('--cm-tok-command', '#5e35b1') },
  { tag: t.atom, color: cv('--cm-tok-env', '#1a7f37') },
  { tag: t.comment, color: cv('--cm-tok-comment', '#a0a0aa'), fontStyle: 'italic' },
  { tag: t.keyword, color: cv('--cm-tok-math', '#b45309') },
  { tag: t.number, color: cv('--cm-tok-number', '#a16207') },
  { tag: t.string, color: cv('--cm-tok-string', '#0e7490') },
  { tag: t.bracket, color: cv('--cm-tok-bracket', '#83838f') },
  {
    tag: [t.variableName, t.special(t.variableName)],
    color: cv('--cm-tok-var', '#3d3d47'),
    fontStyle: 'italic',
  },
  { tag: t.invalid, color: cv('--cm-tok-invalid', '#d9534f'), textDecoration: 'underline' },
]);

/** 编辑器结构主题（变量驱动）+ 滚动条基础样式 + 语法高亮 */
export const scholarforgeTheme: Extension = [
  EditorView.theme(
    {
      '&': {
        color: cv('--cm-fg', '#1a1a1a'),
        backgroundColor: cv('--cm-bg', '#ffffff'),
        fontSize: '14px',
      },
      '.cm-content': {
        caretColor: cv('--cm-caret', '#0d0d0d'),
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
        lineHeight: '1.6',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeft: `2px solid ${cv('--cm-caret', '#0d0d0d')}`,
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: cv('--cm-sel', 'rgba(16, 163, 127, 0.13)'),
      },
      // gutter 与编辑区融为一体
      '.cm-gutters': {
        backgroundColor: cv('--cm-bg', '#ffffff'),
        color: cv('--cm-muted', '#a0a0aa'),
        border: 'none',
      },
      '.cm-activeLineGutter': {
        backgroundColor: cv('--cm-active-line', 'rgba(0, 0, 0, 0.028)'),
        color: cv('--cm-active-gutter', '#70707a'),
      },
      '.cm-activeLine': {
        backgroundColor: cv('--cm-active-line', 'rgba(0, 0, 0, 0.028)'),
      },
      '.cm-selectionMatch': {
        backgroundColor: cv('--cm-sel-match', 'rgba(16, 163, 127, 0.16)'),
      },
      '.cm-foldPlaceholder': {
        backgroundColor: cv('--cm-border', '#e9e9ec'),
        border: 'none',
        color: cv('--cm-active-gutter', '#70707a'),
        padding: '0 6px',
        margin: '0 4px',
        borderRadius: '4px',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 12px 0 16px',
      },
      '.cm-scroller': {
        overflow: 'auto',
      },
      // 搜索面板 / 补全 / tooltip 跟随主题变量
      '.cm-panels': {
        backgroundColor: cv('--cm-panel', '#ffffff'),
        color: cv('--cm-fg', '#1a1a1a'),
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: `1px solid ${cv('--cm-border', '#e9e9ec')}`,
      },
      '.cm-searchMatch': {
        backgroundColor: cv('--cm-search', 'rgba(16, 163, 127, 0.22)'),
        outline: `1px solid ${cv('--cm-sel-match', 'rgba(16, 163, 127, 0.16)')}`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: cv('--cm-search-selected', 'rgba(16, 163, 127, 0.42)'),
      },
      '.cm-tooltip': {
        backgroundColor: cv('--cm-panel', '#ffffff'),
        border: `1px solid ${cv('--cm-border', '#e9e9ec')}`,
        borderRadius: '8px',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.12)',
        color: cv('--cm-fg', '#1a1a1a'),
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'inherit',
        maxHeight: '220px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: cv('--cm-sel-match', 'rgba(16, 163, 127, 0.16)'),
        color: cv('--cm-fg', '#1a1a1a'),
      },
      '.cm-searchField, .cm-panel input, .cm-panel button, .cm-textfield': {
        backgroundColor: cv('--cm-bg', '#ffffff'),
        color: cv('--cm-fg', '#1a1a1a'),
        border: `1px solid ${cv('--cm-border', '#e9e9ec')}`,
        borderRadius: '4px',
      },
    },
    // 亮色标记：themeType='dark' 的旧高亮样式失效，语法色统一由
    // latexTokenHighlight（变量取色）在明暗两种主题下提供
    { dark: false },
  ),
  EditorView.baseTheme({
    '.cm-scroller::-webkit-scrollbar': {
      width: '10px',
      height: '10px',
    },
    '.cm-scroller::-webkit-scrollbar-track': {
      background: 'transparent',
    },
    '.cm-scroller::-webkit-scrollbar-thumb': {
      backgroundColor: cv('--cm-scrollbar', '#d9d9de'),
      borderRadius: '5px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      backgroundColor: cv('--cm-scrollbar-hover', '#c2c2c9'),
    },
    '.cm-scroller': {
      scrollbarWidth: 'thin',
      scrollbarColor: `${cv('--cm-scrollbar', '#d9d9de')} transparent`,
    },
  }),
  syntaxHighlighting(latexTokenHighlight),
];
