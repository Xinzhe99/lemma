/**
 * 内联 AI 补全（v3.5.0 A）：Cursor 级 ghost text 体验。
 * 用户停止输入 → AI 续写建议（灰色幽灵文本）→ Tab 接受 / Esc 关闭。
 */

import { EditorView, Decoration, keymap, WidgetType, ViewPlugin } from '@codemirror/view';
import { StateEffect, StateField, type Extension } from '@codemirror/state';

export interface CompletionSuggestion {
  text: string;
  pos: number;
}

export const setSuggestion = StateEffect.define<CompletionSuggestion | null>();
export const clearSuggestion = StateEffect.define<null>();

const suggestionField = StateField.define<CompletionSuggestion | null>({
  create: () => null,
  update(value, tr) {
    if (tr.docChanged) return null;
    for (const e of tr.effects) {
      if (e.is(setSuggestion)) return e.value;
      if (e.is(clearSuggestion)) return null;
    }
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v) => {
      if (!v) return Decoration.none;
      return Decoration.set([
        Decoration.widget({ widget: new GhostTextWidget(v.text), side: 1 }).range(v.pos),
      ]);
    }),
});

class GhostTextWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: GhostTextWidget): boolean {
    return other.text === this.text;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-ghost-text';
    span.textContent = this.text;
    span.style.cssText = 'color:var(--fg-2,#999);opacity:0.6;pointer-events:none;white-space:pre-wrap;';
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function acceptSuggestion(view: EditorView): boolean {
  const sug = view.state.field(suggestionField, false);
  if (!sug) return false;
  view.dispatch({
    changes: { from: sug.pos, to: sug.pos, insert: sug.text },
    selection: { anchor: sug.pos + sug.text.length },
    effects: clearSuggestion.of(null),
  });
  return true;
}

function dismissSuggestion(view: EditorView): boolean {
  const sug = view.state.field(suggestionField, false);
  if (!sug) return false;
  view.dispatch({ effects: clearSuggestion.of(null) });
  return true;
}

export type CompletionRequester = (
  beforeCursor: string,
  signal: AbortSignal,
) => Promise<string | null>;

export interface InlineCompletionOptions {
  requestCompletion?: CompletionRequester;
  delayMs?: number;
  contextLength?: number;
  enabled?: () => boolean;
}

export function inlineCompletionExtension(opts: InlineCompletionOptions = {}): Extension {
  const delay = opts.delayMs ?? 1500;
  const contextLen = opts.contextLength ?? 500;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let abortController: AbortController | null = null;

  const cancel = (): void => {
    if (timer) clearTimeout(timer);
    if (abortController) abortController.abort();
    timer = null;
    abortController = null;
  };

  return [
    suggestionField,
    keymap.of([
      { key: 'Tab', run: acceptSuggestion },
      { key: 'Escape', run: dismissSuggestion },
    ]),
    EditorView.updateListener.of((update) => {
      if (!update.docChanged) return;
      if (opts.enabled && !opts.enabled()) return;
      if (!opts.requestCompletion) return;
      cancel();
      const view = update.view;
      const pos = view.state.selection.main.head;
      const from = Math.max(0, pos - contextLen);
      const before = view.state.sliceDoc(from, pos);
      if (before.trim().length < 30) return;
      const lineText = view.state.doc.lineAt(pos).text;
      if (lineText.trim().startsWith('%')) return;
      if (!lineText.trim()) return;

      timer = setTimeout(() => {
        abortController = new AbortController();
        const signal = abortController.signal;
        opts
          .requestCompletion!(before, signal)
          .then((text) => {
            if (signal.aborted) return;
            if (!text || text.trim().length < 2) return;
            const curPos = view.state.selection.main.head;
            if (curPos !== pos) return;
            view.dispatch({ effects: setSuggestion.of({ text, pos }) });
          })
          .catch(() => undefined);
      }, delay);
    }),
    ViewPlugin.fromClass(
      class {
        destroy(): void {
          cancel();
        }
      },
    ),
  ];
}

export function dismissInlineCompletion(view: EditorView): void {
  view.dispatch({ effects: clearSuggestion.of(null) });
}
