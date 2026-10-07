// @vitest-environment jsdom
/**
 * 环境自动闭合测试（v2.4.0 ①）：输入 \begin{env 后的 `}` 自动补 \end{env}。
 *
 * 用真实 EditorView + keydown 事件驱动 keymap（与用户敲 `}` 同路径）：
 * jsdom 不会执行浏览器的默认文本插入，因此「命中」时文档里出现的 `}` 只可能
 * 来自本扩展插入的文本；未命中时 defaultPrevented 为 false（交回默认输入）。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { EditorView } from '@codemirror/view';
import { envAutoCloseExtension } from './envAutoClose';

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

/** 造一个文档末尾带光标的编辑器，并模拟敲下 `}` */
function pressClosingBrace(doc: string): { view: EditorView; prevented: boolean } {
  view = new EditorView({ doc, extensions: [envAutoCloseExtension()], parent: document.body });
  view.dispatch({ selection: { anchor: doc.length } });
  const event = new KeyboardEvent('keydown', { key: '}', bubbles: true, cancelable: true });
  view.contentDOM.dispatchEvent(event);
  return { view, prevented: event.defaultPrevented };
}

describe('envAutoCloseExtension', () => {
  it('首个未闭合环境：补 `}`、空行与 \\end，光标落在空行', () => {
    const { view: v, prevented } = pressClosingBrace('\\begin{itemize');
    expect(prevented).toBe(true);
    expect(v.state.doc.toString()).toBe('\\begin{itemize}\n\n\\end{itemize}');
    expect(v.state.selection.main.head).toBe('\\begin{itemize'.length + 2);
  });

  it('已闭合过的同名环境：再次输入仍自动闭合（回归：此前永不触发）', () => {
    const before = '\\begin{itemize}\n  \\item a\n\\end{itemize}\n\n\\begin{enumerate';
    const { view: v, prevented } = pressClosingBrace(before);
    expect(prevented).toBe(true);
    expect(v.state.doc.toString()).toBe(`${before}}\n\n\\end{enumerate}`);
  });

  it('嵌套同名环境（外层未闭合）：不自动闭合，交回用户手控', () => {
    const before = '\\begin{itemize}\n  \\item a\n  \\begin{itemize';
    const { view: v, prevented } = pressClosingBrace(before);
    expect(prevented).toBe(false);
    expect(v.state.doc.toString()).toBe(before);
  });

  it('document 环境与普通文本不触发', () => {
    expect(pressClosingBrace('\\begin{document').prevented).toBe(false);
    expect(pressClosingBrace('plain {').prevented).toBe(false);
  });
});
