/**
 * ScholarForge 深色主题：与 LaTeX 高亮配色（命令蓝紫/环境绿/注释灰/数学橙）协调。
 */
import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export const EDITOR_COLORS = {
  background: '#14161d',
  foreground: '#e8eaf0',
  muted: '#6b7385',
  border: '#262a36',
  accent: '#7aa2f7',
  addedGreen: '#7ee2a8',
  removedRed: '#ff7a85',
} as const;

/** 深色主题（EditorView.theme）+ 滚动条基础样式（EditorView.baseTheme） */
export const scholarforgeTheme: Extension = [
  EditorView.theme(
    {
      '&': {
        color: EDITOR_COLORS.foreground,
        backgroundColor: EDITOR_COLORS.background,
        fontSize: '14px',
      },
      '.cm-content': {
        caretColor: EDITOR_COLORS.accent,
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
        lineHeight: '1.6',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeft: `2px solid ${EDITOR_COLORS.accent}`,
      },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'rgba(122, 162, 247, 0.28)',
      },
      // gutter 与编辑区融为一体
      '.cm-gutters': {
        backgroundColor: EDITOR_COLORS.background,
        color: '#4a5160',
        border: 'none',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'rgba(255, 255, 255, 0.045)',
        color: '#9aa3b8',
      },
      '.cm-activeLine': {
        backgroundColor: 'rgba(255, 255, 255, 0.035)',
      },
      '.cm-selectionMatch': {
        backgroundColor: 'rgba(126, 226, 168, 0.18)',
      },
      '.cm-foldPlaceholder': {
        backgroundColor: '#262a36',
        border: 'none',
        color: '#9aa3b8',
        padding: '0 6px',
        margin: '0 4px',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 12px 0 16px',
      },
      '.cm-scroller': {
        overflow: 'auto',
      },
      // 搜索面板 / 补全 / tooltip 也用深色
      '.cm-panels': {
        backgroundColor: '#1b1e28',
        color: EDITOR_COLORS.foreground,
      },
      '.cm-panels.cm-panels-bottom': {
        borderTop: `1px solid ${EDITOR_COLORS.border}`,
      },
      '.cm-searchMatch': {
        backgroundColor: 'rgba(126, 226, 168, 0.22)',
        outline: `1px solid rgba(126, 226, 168, 0.5)`,
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'rgba(122, 162, 247, 0.45)',
      },
      '.cm-tooltip': {
        backgroundColor: '#1b1e28',
        border: `1px solid ${EDITOR_COLORS.border}`,
        borderRadius: '6px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul': {
        fontFamily: 'inherit',
        maxHeight: '220px',
      },
      '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'rgba(122, 162, 247, 0.25)',
        color: EDITOR_COLORS.foreground,
      },
      '.cm-searchField, .cm-panel input, .cm-panel button, .cm-textfield': {
        backgroundColor: '#14161d',
        color: EDITOR_COLORS.foreground,
        border: `1px solid ${EDITOR_COLORS.border}`,
        borderRadius: '4px',
      },
    },
    { dark: true },
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
      backgroundColor: '#2a2f3d',
      borderRadius: '5px',
    },
    '.cm-scroller::-webkit-scrollbar-thumb:hover': {
      backgroundColor: '#3a4150',
    },
    '.cm-scroller': {
      scrollbarWidth: 'thin',
      scrollbarColor: '#2a2f3d transparent',
    },
  }),
];
