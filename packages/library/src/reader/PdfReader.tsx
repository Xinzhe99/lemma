import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { createId, type Annotation, type HighlightSemantic } from '@scholarforge/shared';

/**
 * PDF 阅读器组件：
 * - pdfjs 渲染当前页到 canvas（缩放 0.75 / 1 / 1.5）；
 * - 透明文本层支持选中文字；
 * - 标注覆盖层按 bbox 画半透明色块（四色语义：方法蓝/发现绿/质疑橙/引用紫）；
 * - 选中后浮动工具条：四色高亮按钮 + 笔记输入 + askActions 自定义按钮（WF-4 L3，
 *   「PDF 选中即问」的 prop 注入契约——组件不感知 AI 动作，只渲染并回调选中文本）；
 * - 可折叠标注侧栏（WF-4 L4）：全部标注列表、四色筛选、删除（onDeleteAnnotation）、点击跳页。
 *
 * 精度限制：以“选区包围盒”近似换算 PDF 用户空间坐标 —— 跨行/跨栏选区的
 * 包围盒会大于实际文本范围，且未处理页面旋转与裁剪，仅适用于常规正立页面。
 */

/** L3 集成契约：App 层注入的「选中即问」动作（如 { label: '解释', run: text => aiActions... }）。 */
export interface PdfAskAction {
  label: string;
  run: (text: string) => void;
}

/** UI 语言（WF-4 L5 双语；组件包不依赖应用层 settingsStore，由宿主注入）。 */
export type PdfReaderLang = 'zh' | 'en';

export interface PdfReaderProps {
  data: ArrayBuffer;
  annotations?: Annotation[];
  onCreateAnnotation?: (annotation: Annotation) => void;
  /** L4：删除标注回调（与 onCreateAnnotation 同源宿主存储；未传则侧栏不显示删除按钮）。 */
  onDeleteAnnotation?: (id: string) => void;
  /** L3：选中浮条尾部渲染的自定义动作按钮。 */
  askActions?: PdfAskAction[];
  /** UI 文案语言，默认中文。 */
  language?: PdfReaderLang;
  className?: string;
}

const SCALES = [0.75, 1, 1.5] as const;

const SEMANTIC_STYLES: Record<HighlightSemantic, { solid: string; translucent: string; label: Record<PdfReaderLang, string> }> = {
  method: { solid: '#3b82f6', translucent: 'rgba(59, 130, 246, 0.28)', label: { zh: '方法', en: 'Method' } },
  finding: { solid: '#22c55e', translucent: 'rgba(34, 197, 94, 0.28)', label: { zh: '发现', en: 'Finding' } },
  question: { solid: '#f59e0b', translucent: 'rgba(245, 158, 11, 0.32)', label: { zh: '质疑', en: 'Question' } },
  citation: { solid: '#a855f7', translucent: 'rgba(168, 85, 247, 0.28)', label: { zh: '引用', en: 'Citation' } },
};
const SEMANTIC_ORDER = Object.keys(SEMANTIC_STYLES) as HighlightSemantic[];
const NEUTRAL_HIGHLIGHT = 'rgba(250, 204, 21, 0.30)';
const NEUTRAL_DOT = '#facc15';

const COPY: Record<PdfReaderLang, Record<string, string>> = {
  zh: {
    prevPage: '上一页',
    nextPage: '下一页',
    zoomOut: '缩小',
    zoomIn: '放大',
    notePlaceholder: '笔记…',
    saveNote: '保存笔记',
    toggleAnnotations: '标注',
    annotationsTitle: '标注',
    filterAll: '全部',
    noAnnotations: '暂无标注',
    deleteAnnotation: '删除标注',
    jumpToPage: '跳转到此页',
    noExcerpt: '（未摘录文字）',
    loadFailed: 'PDF 加载失败，请确认文件未损坏。',
    renderFailed: 'PDF 页面渲染失败。',
  },
  en: {
    prevPage: 'Previous',
    nextPage: 'Next',
    zoomOut: 'Zoom out',
    zoomIn: 'Zoom in',
    notePlaceholder: 'Note…',
    saveNote: 'Save note',
    toggleAnnotations: 'Annotations',
    annotationsTitle: 'Annotations',
    filterAll: 'All',
    noAnnotations: 'No annotations yet',
    deleteAnnotation: 'Delete annotation',
    jumpToPage: 'Jump to this page',
    noExcerpt: '(no excerpt)',
    loadFailed: 'Failed to load PDF. Please check the file is not corrupted.',
    renderFailed: 'Failed to render PDF page.',
  },
};

interface TextSpan {
  text: string;
  left: number;
  top: number;
  size: number;
}

interface SelectionToolbar {
  x: number;
  y: number;
  text: string;
  /** 相对画布左上角的选区包围盒（CSS 像素，与视口坐标一致） */
  rect: { left: number; top: number; width: number; height: number };
}

/** 两个 6 元仿射矩阵相乘（viewport.transform × item.transform）。 */
function multiplyTransform(m1: readonly number[], m2: readonly number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

export function PdfReader({
  data,
  annotations,
  onCreateAnnotation,
  onDeleteAnnotation,
  askActions,
  language = 'zh',
  className,
}: PdfReaderProps) {
  const t = (key: string): string => COPY[language][key] ?? COPY.zh[key] ?? key;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [viewport, setViewport] = useState<pdfjsLib.PageViewport | null>(null);
  const [pageNum, setPageNum] = useState(1);
  const [scaleIndex, setScaleIndex] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [textSpans, setTextSpans] = useState<TextSpan[]>([]);
  const [toolbar, setToolbar] = useState<SelectionToolbar | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [semanticFilter, setSemanticFilter] = useState<HighlightSemantic | 'all'>('all');
  const scale = SCALES[scaleIndex] ?? 1;

  // 加载文档（getDocument 会转移 buffer，复制一份）
  useEffect(() => {
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    setError(null);
    setDoc(null);
    setPageNum(1);
    setToolbar(null);
    const bytes = new Uint8Array(data.slice(0));
    pdfjsLib.getDocument({ data: bytes }).promise.then(
      document => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        loaded = document;
        setDoc(document);
      },
      () => {
        if (!cancelled) setError(t('loadFailed'));
      },
    );
    return () => {
      cancelled = true;
      if (loaded) void loaded.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // 渲染当前页 + 重建文本层
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    setToolbar(null);
    (async () => {
      const page = await doc.getPage(pageNum);
      if (cancelled) return;
      const pageViewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;
      canvas.width = Math.floor(pageViewport.width);
      canvas.height = Math.floor(pageViewport.height);
      renderTask = page.render({ canvasContext: context, viewport: pageViewport });
      await renderTask.promise;
      if (cancelled) return;
      setViewport(pageViewport);
      const content = await page.getTextContent();
      if (cancelled) return;
      const spans: TextSpan[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        const tx = multiplyTransform(pageViewport.transform, item.transform);
        const size = Math.hypot(tx[2]!, tx[3]!) || 10;
        spans.push({ text: item.str, left: tx[4]!, top: tx[5]! - size, size });
      }
      setTextSpans(spans);
      page.cleanup();
    })().catch(() => {
      if (!cancelled) setError(t('renderFailed'));
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNum, scale]);

  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (toolbarRef.current?.contains(event.target as Node)) return; // 工具条内部点击不收起
    const selection = window.getSelection();
    const text = selection ? selection.toString().replace(/\s+/g, ' ').trim() : '';
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !text ||
      !canvasRect ||
      !containerRect
    ) {
      setToolbar(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setToolbar(null);
      return;
    }
    setToolbar({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 10,
      text,
      rect: {
        left: rect.left - canvasRect.left,
        top: rect.top - canvasRect.top,
        width: rect.width,
        height: rect.height,
      },
    });
  };

  const dismissSelection = (): void => {
    window.getSelection()?.removeAllRanges();
    setToolbar(null);
    setNoteDraft('');
  };

  const emitAnnotation = (semantic: HighlightSemantic | undefined, note: string): void => {
    if (!onCreateAnnotation || !toolbar || !viewport) return;
    const { rect, text } = toolbar;
    // 选区包围盒（视口坐标）→ PDF 用户空间坐标（左下/右上两点换算）
    // pdfjs 类型将换算结果声明为 any[]，此处按 Point 结构取用
    const p1 = viewport.convertToPdfPoint(rect.left, rect.top + rect.height) as unknown as { x: number; y: number };
    const p2 = viewport.convertToPdfPoint(rect.left + rect.width, rect.top) as unknown as { x: number; y: number };
    const bbox: [number, number, number, number] = [
      Math.min(p1.x, p2.x),
      Math.min(p1.y, p2.y),
      Math.max(p1.x, p2.x),
      Math.max(p1.y, p2.y),
    ];
    onCreateAnnotation({
      id: createId(),
      paperId: '', // 组件不感知所属文献，由宿主补全
      page: pageNum,
      kind: note ? 'note' : 'highlight',
      semantic: note ? undefined : semantic,
      bbox,
      quotedText: text,
      text: note || undefined,
      createdAt: Date.now(),
    });
    dismissSelection();
  };

  const highlights = viewport
    ? (annotations ?? [])
        .filter(a => a.page === pageNum && a.bbox)
        .map(annotation => {
          const rect = viewport.convertToViewportRectangle(annotation.bbox!);
          const left = Math.min(rect[0]!, rect[2]!);
          const top = Math.min(rect[1]!, rect[3]!);
          const width = Math.abs(rect[2]! - rect[0]!);
          const height = Math.abs(rect[3]! - rect[1]!);
          const color = annotation.semantic
            ? SEMANTIC_STYLES[annotation.semantic].translucent
            : NEUTRAL_HIGHLIGHT;
          const style: CSSProperties = {
            position: 'absolute',
            left,
            top,
            width,
            height,
            backgroundColor: color,
            pointerEvents: 'none',
          };
          return <div key={annotation.id} data-annotation-id={annotation.id} style={style} />;
        })
    : [];

  // L4：侧栏标注列表（按页码、创建时间升序；筛选只作用于列表，不影响覆盖层）
  const sidebarAnnotations = useMemo(() => {
    const list = [...(annotations ?? [])].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    return semanticFilter === 'all' ? list : list.filter(a => a.semantic === semanticFilter);
  }, [annotations, semanticFilter]);

  const pageWidth = viewport?.width ?? 0;
  const pageHeight = viewport?.height ?? 0;

  const sidebar = sidebarOpen ? (
    <aside
      style={{
        flex: '0 0 240px',
        width: 240,
        maxHeight: 480,
        overflow: 'auto',
        border: '1px solid #d1d5db',
        borderRadius: 8,
        padding: 8,
        fontSize: 12,
        background: '#f9fafb',
      }}
      aria-label={t('annotationsTitle')}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
        <strong style={{ fontSize: 11 }}>{t('annotationsTitle')} · {sidebarAnnotations.length}</strong>
        <button
          type="button"
          style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#6b7280' }}
          onClick={() => setSemanticFilter('all')}
          className={semanticFilter === 'all' ? 'sf-pdf-filter-active' : undefined}
        >
          {t('filterAll')}
        </button>
        {SEMANTIC_ORDER.map(semantic => (
          <button
            key={semantic}
            type="button"
            title={SEMANTIC_STYLES[semantic].label[language]}
            aria-label={SEMANTIC_STYLES[semantic].label[language]}
            aria-pressed={semanticFilter === semantic}
            onClick={() => setSemanticFilter(prev => (prev === semantic ? 'all' : semantic))}
            style={{
              width: 14,
              height: 14,
              borderRadius: '50%',
              background: SEMANTIC_STYLES[semantic].solid,
              border: semanticFilter === semantic ? '2px solid #111827' : '1px solid rgba(0,0,0,0.2)',
              cursor: 'pointer',
              padding: 0,
            }}
          />
        ))}
      </div>
      {sidebarAnnotations.length === 0 ? (
        <p style={{ color: '#6b7280', fontSize: 11, margin: 0 }}>{t('noAnnotations')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sidebarAnnotations.map(annotation => {
            const excerpt = (annotation.text || annotation.quotedText || '').replace(/\s+/g, ' ').trim();
            const truncated = excerpt.length > 60 ? `${excerpt.slice(0, 60)}…` : excerpt;
            return (
              <li
                key={annotation.id}
                style={{ display: 'flex', alignItems: 'flex-start', gap: 4, borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }}
              >
                <button
                  type="button"
                  onClick={() => setPageNum(annotation.page)}
                  title={t('jumpToPage')}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    textAlign: 'left',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    color: '#111827',
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    aria-hidden
                    style={{
                      flex: '0 0 auto',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: annotation.semantic ? SEMANTIC_STYLES[annotation.semantic].solid : NEUTRAL_DOT,
                      display: 'inline-block',
                    }}
                  />
                  <span style={{ color: '#6b7280', flex: '0 0 auto' }}>p.{annotation.page}</span>
                  <span>{truncated || t('noExcerpt')}</span>
                </button>
                {onDeleteAnnotation && (
                  <button
                    type="button"
                    title={t('deleteAnnotation')}
                    aria-label={`${t('deleteAnnotation')} p.${annotation.page}`}
                    onClick={() => onDeleteAnnotation(annotation.id)}
                    style={{ border: 'none', background: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 12, padding: 0 }}
                  >
                    ×
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  ) : null;

  return (
    <div className={className} ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => setPageNum(p => Math.max(1, p - 1))} disabled={!doc || pageNum <= 1}>
              {t('prevPage')}
            </button>
            <span aria-live="polite">{doc ? `${pageNum} / ${doc.numPages}` : '…'}</span>
            <button
              type="button"
              onClick={() => setPageNum(p => Math.min(doc?.numPages ?? 1, p + 1))}
              disabled={!doc || pageNum >= doc.numPages}
            >
              {t('nextPage')}
            </button>
            <button type="button" onClick={() => setScaleIndex(i => Math.max(0, i - 1))} disabled={scaleIndex <= 0}>
              {t('zoomOut')}
            </button>
            <span>{Math.round(scale * 100)}%</span>
            <button
              type="button"
              onClick={() => setScaleIndex(i => Math.min(SCALES.length - 1, i + 1))}
              disabled={scaleIndex >= SCALES.length - 1}
            >
              {t('zoomIn')}
            </button>
            <button
              type="button"
              aria-pressed={sidebarOpen}
              onClick={() => setSidebarOpen(v => !v)}
              style={{ marginLeft: 'auto' }}
            >
              {t('toggleAnnotations')} ({(annotations ?? []).length})
            </button>
          </div>

          {error ? (
            <div
              role="alert"
              style={{
                padding: 32,
                border: '1px solid #fca5a5',
                background: '#fef2f2',
                color: '#b91c1c',
                borderRadius: 8,
                textAlign: 'center',
              }}
            >
              {error}
            </div>
          ) : (
            <div
              style={{ position: 'relative', width: pageWidth || undefined }}
              onMouseUp={handleMouseUp}
            >
              <canvas ref={canvasRef} style={{ display: 'block', border: '1px solid #d1d5db' }} />
              {viewport && (
                <>
                  <div style={{ position: 'absolute', left: 0, top: 0, width: pageWidth, height: pageHeight, zIndex: 1 }}>
                    {highlights}
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: pageWidth,
                      height: pageHeight,
                      zIndex: 2,
                      overflow: 'hidden',
                      color: 'transparent',
                      cursor: 'text',
                      userSelect: 'text',
                      WebkitUserSelect: 'text',
                    }}
                  >
                    {textSpans.map((span, index) => (
                      <span
                        key={index}
                        style={{
                          position: 'absolute',
                          left: span.left,
                          top: span.top,
                          fontSize: `${span.size}px`,
                          fontFamily: 'sans-serif',
                          whiteSpace: 'pre',
                          lineHeight: 1,
                        }}
                      >
                        {span.text}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {toolbar && (
                <div
                  ref={toolbarRef}
                  style={{
                    position: 'absolute',
                    left: toolbar.x,
                    top: toolbar.y,
                    transform: 'translate(-50%, 0)',
                    zIndex: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 8px',
                    background: '#ffffff',
                    border: '1px solid #d1d5db',
                    borderRadius: 8,
                    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                  }}
                >
                  {SEMANTIC_ORDER.map(semantic => (
                    <button
                      key={semantic}
                      type="button"
                      title={SEMANTIC_STYLES[semantic].label[language]}
                      aria-label={SEMANTIC_STYLES[semantic].label[language]}
                      onClick={() => emitAnnotation(semantic, '')}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        background: SEMANTIC_STYLES[semantic].solid,
                        border: '1px solid rgba(0, 0, 0, 0.2)',
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                  <input
                    value={noteDraft}
                    onChange={event => setNoteDraft(event.target.value)}
                    placeholder={t('notePlaceholder')}
                    style={{ width: 120, fontSize: 12, padding: '2px 6px' }}
                  />
                  <button type="button" onClick={() => emitAnnotation(undefined, noteDraft.trim())} disabled={!noteDraft.trim()}>
                    {t('saveNote')}
                  </button>
                  {(askActions ?? []).map(action => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => {
                        action.run(toolbar.text);
                        dismissSelection();
                      }}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
