/**
 * 文本格式化快捷键（v2.4.0 ②）：
 *   Ctrl/Cmd+B → \\textbf{选中}（粗体）
 *   Ctrl/Cmd+I → \\emph{选中}（斜体/强调）
 *
 * 有选中文字 → 包裹（\\textbf{hello}）；无选中 → 插入空壳并光标进花括号。
 * LaTeX 语义：粗体 = \\textbf，斜体 = \\emph（学术惯例不用 \\textit 做强调）。
 */

import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** 包裹选中文字为 \cmd{...}；无选中则插入 \cmd{} 并光标进花括号 */
function wrapSelection(view: EditorView, cmd: string): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const text = state.sliceDoc(sel.from, sel.to);

  if (text.length > 0) {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `\\${cmd}{${text}}` },
      selection: { anchor: sel.from + cmd.length + 2, head: sel.to + cmd.length + 2 },
    });
  } else {
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `\\${cmd}{}` },
      selection: { anchor: sel.from + cmd.length + 2 },
    });
  }
  return true;
}

/** Ctrl+B 粗体 / Ctrl+I 斜体 */
export function textFormatKeymap(): Extension {
  return keymap.of([
    {
      key: 'Mod-b',
      run: (view) => wrapSelection(view, 'textbf'),
    },
    {
      key: 'Mod-i',
      run: (view) => wrapSelection(view, 'emph'),
    },
  ]);
}
