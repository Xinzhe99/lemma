/**
 * 行注释切换（v2.9.0 ③）：Ctrl/Cmd+/ 在行首添加/移除 % 注释。
 * 选区多行时批量切换。
 */

import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

function toggleComment(view: EditorView): boolean {
  const { state } = view;
  const sel = state.selection.main;
  const startLine = state.doc.lineAt(sel.from);
  const endLine = state.doc.lineAt(sel.to);

  // 检测首行是否已注释
  const firstText = startLine.text;
  const isCommented = firstText.trimStart().startsWith('%');

  const changes: { from: number; to: number; insert: string }[] = [];

  for (let ln = startLine.number; ln <= endLine.number; ln++) {
    const line = state.doc.line(ln);
    const text = line.text;
    const indent = text.length - text.trimStart().length;
    const body = text.slice(indent);

    if (isCommented) {
      // 移除注释：% 或 % 后跟空格
      const stripped = body.replace(/^%\s?/, '');
      changes.push({ from: line.from + indent, to: line.to, insert: stripped });
    } else {
      // 添加注释
      if (body.trim()) {
        changes.push({ from: line.from + indent, to: line.from + indent, insert: '% ' });
      }
    }
  }

  if (changes.length === 0) return false;
  view.dispatch({ changes });
  return true;
}

export function commentToggleKeymap(): Extension {
  return keymap.of([
    {
      key: 'Mod-/',
      run: toggleComment,
    },
  ]);
}
