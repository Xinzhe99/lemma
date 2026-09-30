/**
 * LaTeX 编辑器 React 组件：CodeMirror 6 完整 setup，受控 value 增量同步。
 * filePath 以 .bib 结尾时经 Compartment 切换 BibTeX 高亮；LaTeX 模式下悬停
 * 数学定界符（$...$ / \(...\) / $$...$$ / \[...\]）显示 KaTeX 实时预览浮层。
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
  hoverTooltip,
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
import { bibBase } from '../latex/bibLanguage';
import { createMathPreviewElement, extractMathSpans } from '../latex/mathPreview';
import { scholarforgeTheme } from '../latex/theme';

/** 标记来自外部 value 同步的事务，避免 onChange 回声 */
const External = Annotation.define<boolean>();

const heightTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': { overflow: 'auto' },
});

/** .bib 文件走 BibTeX 高亮模式（大小写不敏感） */
function isBibPath(filePath: string | undefined): boolean {
  return (filePath ?? '').toLowerCase().endsWith('.bib');
}

/**
 * 数学公式 hover 预览：悬停位置落在公式 span 内时弹 KaTeX 渲染浮层；
 * 渲染失败回退为原始 TeX + 错误信息（createMathPreviewElement）。
 */
function mathHoverTooltip(): Extension {
  return hoverTooltip((view, pos) => {
    const spans = extractMathSpans(view.state.doc.toString());
    const span = spans.find((s) => pos >= s.from && pos < s.to);
    if (!span) return null;
    return {
      pos: span.from,
      end: span.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'sf-math-hover';
        // 内联样式承载浮层外观（不新增 CSS 文件）
        dom.style.maxWidth = '460px';
        dom.style.maxHeight = '300px';
        dom.style.overflow = 'auto';
        dom.style.padding = '6px 10px';
        dom.style.fontSize = '13px';
        dom.style.background = '#1c2029';
        dom.style.border = '1px solid #343b4a';
        dom.style.borderRadius = '6px';
        dom.style.color = '#d7dce8';
        dom.appendChild(createMathPreviewElement(span.tex, span.display));
        return { dom };
      },
    };
  });
}

export interface LatexEditorProps {
  value: string;
  onChange?: (v: string) => void;
  getCitations?: () => CitationEntry[];
  extraExtensions?: Extension[];
  onCursorLine?: (line: number) => void;
  className?: string;
  /** 当前文件路径：.bib 后缀切 BibTeX 高亮模式，缺省/其余为 LaTeX 模式 */
  filePath?: string;
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
  /** 语言侧扩展 compartment：LaTeX（含数学 hover 预览）与 BibTeX 之间切换 */
  const langCompRef = useRef(new Compartment());
  const lastLineRef = useRef(0);

  const onChangeRef = useLatest(props.onChange);
  const onCursorLineRef = useLatest(props.onCursorLine);
  const onReadyRef = useLatest(onEditorReady);
  const getCitationsRef = useLatest(props.getCitations);
  const extraRef = useLatest(extraExtensions);
  const valueRef = useLatest(value);

  // 稳定引用的引用数据代理，使 latexSupport 无需重建
  const citationsProxy = useCallback(() => getCitationsRef.current?.() ?? [], []);

  /** 按文件路径组装语言侧扩展：.bib → BibTeX；否则 LaTeX + 补全 + 数学 hover 预览 */
  const langSideFor = useCallback(
    (filePath: string | undefined): Extension[] =>
      isBibPath(filePath)
        ? bibBase()
        : [latexSupport({ getCitations: citationsProxy }), mathHoverTooltip()],
    [citationsProxy],
  );

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
        langCompRef.current.of(langSideFor(props.filePath)),
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

  // filePath 变化时切换语言侧（.bib ↔ LaTeX），不动编辑器实例与撤销栈
  const filePath = props.filePath;
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: langCompRef.current.reconfigure(langSideFor(filePath)) });
  }, [filePath, langSideFor]);

  return <div ref={hostRef} className={className} style={{ height: '100%' }} />;
}
