/**
 * LaTeX 编辑器 React 组件：CodeMirror 6 完整 setup，受控 value 增量同步。
 */
import { useCallback, useEffect, useRef } from 'react';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { Annotation, Compartment, type Extension } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { latexSupport, type CitationEntry } from '../latex/completion';
import { scholarforgeTheme } from '../latex/theme';

/** 标记来自外部 value 同步的事务，避免 onChange 回声 */
const External = Annotation.define<boolean>();

const heightTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto' },
});

export interface LatexEditorProps {
  value: string;
  onChange?: (v: string) => void;
  getCitations?: () => CitationEntry[];
  extraExtensions?: Extension[];
  onCursorLine?: (line: number) => void;
  className?: string;
  /** 挂载/卸载时回调 EditorView 句柄（供 SyncTeX 跳转等宿主逻辑使用） */
  onEditorReady?: (view: EditorView | null) => void;
}

/** 保持 ref 始终指向最新 props，避免为回调 prop 重建编辑器 */
function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

export function LatexEditor(props: LatexEditorProps) {
  const { value, extraExtensions, className, onEditorReady } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const extraCompRef = useRef(new Compartment());
  const lastLineRef = useRef(0);

  const onChangeRef = useLatest(props.onChange);
  const onCursorLineRef = useLatest(props.onCursorLine);
  const onReadyRef = useLatest(onEditorReady);
  const getCitationsRef = useLatest(props.getCitations);
  const extraRef = useLatest(extraExtensions);
  const valueRef = useLatest(value);

  // 稳定引用的引用数据代理，使 latexSupport 无需重建
  const citationsProxy = useCallback(() => getCitationsRef.current?.() ?? [], []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      doc: valueRef.current,
      parent: host,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...completionKeymap,
          indentWithTab,
        ]),
        indentOnInput(),
        latexSupport({ getCitations: citationsProxy }),
        scholarforgeTheme,
        heightTheme,
        EditorView.updateListener.of((vu) => {
          if (vu.docChanged) {
            const external = vu.transactions.some((tr) => tr.annotation(External));
            if (!external) onChangeRef.current?.(vu.state.doc.toString());
          }
          if (vu.docChanged || vu.selectionSet) {
            const line = vu.state.doc.lineAt(vu.state.selection.main.head).number;
            if (line !== lastLineRef.current) {
              lastLineRef.current = line;
              onCursorLineRef.current?.(line);
            }
          }
        }),
        extraCompRef.current.of(extraRef.current ?? []),
      ],
    });
    viewRef.current = view;
    lastLineRef.current = view.state.doc.lineAt(view.state.selection.main.head).number;
    onCursorLineRef.current?.(lastLineRef.current);
    onReadyRef.current?.(view);
    return () => {
      view.destroy();
      viewRef.current = null;
      onReadyRef.current?.(null);
    };
    // 仅挂载一次；回调与数据经 ref/latest 代理
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citationsProxy]);

  // 外部 value 变化时按公共前后缀做最小替换，避免整篇重建破坏光标/撤销栈
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value === current) return;
    let start = 0;
    const maxPrefix = Math.min(current.length, value.length);
    while (start < maxPrefix && current.charCodeAt(start) === value.charCodeAt(start)) start++;
    let endOld = current.length;
    let endNew = value.length;
    while (
      endOld > start &&
      endNew > start &&
      current.charCodeAt(endOld - 1) === value.charCodeAt(endNew - 1)
    ) {
      endOld--;
      endNew--;
    }
    view.dispatch({
      changes: { from: start, to: endOld, insert: value.slice(start, endNew) },
      annotations: External.of(true),
    });
  }, [value]);

  // extraExtensions 热更新
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: extraCompRef.current.reconfigure(extraExtensions ?? []) });
  }, [extraExtensions]);

  return <div ref={hostRef} className={className} style={{ height: '100%' }} />;
}
