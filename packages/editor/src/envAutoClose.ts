/**
 * LaTeX 环境自动闭合（v2.4.0 ①）：输入 \begin{xxx} 的 `}` 时自动补 \end{xxx}。
 *
 * 触发：光标前文本以 \begin{envname 结尾（`}` 即将输入）且该环境在全文档中未闭合。
 * 行为：插入 `}\n\n\end{env}`，光标落在 \begin 与 \end 之间的空行——
 *   \begin{itemize}
 *   ←光标在这里
 *   \end{itemize}
 * 跳过：document 环境（通常由模板骨架提供）、嵌套同名环境（用户手控）。
 */

import { EditorView, keymap } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/** 光标前以 \begin{envname 结尾（`}` 尚未输入） */
const BEGIN_OPEN_RE = /\\begin\{([a-zA-Z*]+)$/;

/** 正则特殊字符转义 */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 统计 \begin{env} - \end{env} 的差值（正 = 有未闭合的） */
function openCount(text: string, env: string): number {
  const begins = (text.match(new RegExp(`\\\\begin\\{${escapeRe(env)}\\}`, 'g')) ?? []).length;
  const ends = (text.match(new RegExp(`\\\\end\\{${escapeRe(env)}\\}`, 'g')) ?? []).length;
  return begins - ends;
}

/** 不自动闭合的环境 */
const SKIP_ENVS = new Set(['document']);

/** 环境 `}` 自动闭合 keymap */
export function envAutoCloseExtension(): Extension {
  return keymap.of([
    {
      key: '}',
      run: (view: EditorView): boolean => {
        const { state } = view;
        const pos = state.selection.main.head;
        const before = state.sliceDoc(0, pos);
        const m = BEGIN_OPEN_RE.exec(before);
        if (!m) return false;

        const env = m[1]!;
        if (SKIP_ENVS.has(env)) return false;
        // 只在首个未闭合的同名环境时触发（嵌套场景让用户手控）
        if (openCount(before, env) !== 1) return false;

        // `}` 闭合 begin，空行放内容，\end 自动补，光标在空行上
        view.dispatch({
          changes: { from: pos, to: pos, insert: `}\n\n\\end{${env}}` },
          selection: { anchor: pos + 2 },
        });
        return true;
      },
    },
  ]);
}
