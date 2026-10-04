/**
 * 选区右键菜单（v2.9.0 ④）：编辑器选中文字后右键弹出快捷操作。
 * 包含：粗体、斜体、AI 润色、AI 扩写、AI 缩写。
 */

import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

export interface SelectionMenuOptions {
  onAIPolish?: (text: string) => void;
  onAIExpand?: (text: string) => void;
  onAICondense?: (text: string) => void;
  onPasteTable?: () => void;
}

interface MenuItem {
  label: string;
  kbd?: string;
  run: (view: EditorView, text: string) => void;
}

function wrapSelection(view: EditorView, cmd: string): void {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: `\\${cmd}{${text}}` },
    selection: { anchor: sel.from + cmd.length + 2, head: sel.to + cmd.length + 2 },
  });
}

export function selectionContextMenu(opts: SelectionMenuOptions = {}): Extension {
  return EditorView.domEventHandlers({
    contextmenu(event, view) {
      const sel = view.state.selection.main;
      if (sel.empty) return false;

      event.preventDefault();

      const items: MenuItem[] = [
        { label: '粗体', kbd: 'Ctrl+B', run: (v) => wrapSelection(v, 'textbf') },
        { label: '斜体', kbd: 'Ctrl+I', run: (v) => wrapSelection(v, 'emph') },
      ];
      if (opts.onAIPolish) items.push({ label: '✦ AI 润色', run: (_, t) => opts.onAIPolish?.(t) });
      if (opts.onAIExpand) items.push({ label: '✦ AI 扩写', run: (_, t) => opts.onAIExpand?.(t) });
      if (opts.onAICondense) items.push({ label: '✦ AI 缩写', run: (_, t) => opts.onAICondense?.(t) });
      if (opts.onPasteTable) items.push({ label: '📋 粘贴为表格', run: () => opts.onPasteTable?.() });

      // 移除旧菜单
      document.querySelectorAll('.sf-context-menu').forEach((el) => el.remove());

      const menu = document.createElement('div');
      menu.className = 'sf-context-menu';
      menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;z-index:10000;background:var(--bg-0,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.15);padding:4px;min-width:160px;font-size:13px;`;

      for (const item of items) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = item.label;
        btn.style.cssText = 'display:flex;justify-content:space-between;width:100%;padding:5px 10px;border:none;border-radius:5px;background:transparent;color:var(--fg-0,#1a1a1a);font-size:12.5px;cursor:pointer;text-align:left;';
        if (item.kbd) {
          const kbd = document.createElement('span');
          kbd.textContent = item.kbd;
          kbd.style.cssText = 'font-size:10px;color:var(--fg-2,#999);';
          btn.append(kbd);
        }
        btn.addEventListener('mouseenter', () => (btn.style.background = 'var(--bg-2,#f0f0f0)'));
        btn.addEventListener('mouseleave', () => (btn.style.background = 'transparent'));
        btn.addEventListener('click', () => {
          menu.remove();
          const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
          item.run(view, text);
        });
        menu.append(btn);
      }

      const close = (e: Event): void => {
        if (!menu.contains(e.target as Node)) {
          menu.remove();
          document.removeEventListener('mousedown', close);
        }
      };
      document.addEventListener('mousedown', close);
      document.body.append(menu);
      return true;
    },
  });
}
