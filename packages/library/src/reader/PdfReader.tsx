import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactElement } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { createId, type Annotation, type HighlightSemantic } from '@lemma/shared';
import {
  createDestPageResolver,
  flattenOutline,
  resolveOutlinePages,
  type PdfOutlineNode,
  type ResolvedOutlineItem,
} from './pdfOutline';

/**
 * PDF 阅读器组件：
 * - pdfjs 渲染当前页到 canvas（缩放 0.75 / 1 / 1.5）；
 * - 透明文本层支持选中文字；
 * - 标注覆盖层按 bbox 画半透明色块（四色语义：方法蓝/发现绿/质疑橙/引用紫）；
 * - 选中后浮动工具条：四色高亮按钮 + 笔记输入 + askActions 自定义按钮（WF-4 L3，
 *   「PDF 选中即问」的 prop 注入契约——组件不感知 AI 动作，只渲染并回调选中文本）；
 * - 可折叠侧栏（WF-4 L4 + 大纲增强）：「标注」「目录」两个 tab（切换状态记忆在组件内），
 *   标注列表支持四色筛选、删除（onDeleteAnnotation）、点击跳页；
 *   目录来自 doc.getOutline() 两步解析（先序展开 → dest 解析页码），点击跳页并闪烁提示。
 * - 阅读模式：单页（默认，行为与历史版本一致）⇄ 连续滚动（全部页 wrapper 按序排布，
 *   IntersectionObserver/滚动换算只渲染视口附近 ±1 页 canvas——远端页保留 wrapper + 占位，
 *   任意时刻挂载 canvas ≤ 5；滚动时同步视口中心所在页；翻页按钮改为滚动到目标页）。
 * - WS-2 编译同步闭环：画布点击经 onPagePoint 回调 PDF 用户空间坐标（PDF → 源码）；
 *   gotoTick 变化时跳到 gotoPage 并以全页半透明矩形闪烁提示（约 1s 褪去，源码 → PDF）。
 *
 * 精度限制：以“选区包围盒”近似换算 PDF 用户空间坐标 —— 跨行/跨栏选区的
 * 包围盒会大于实际文本范围，且未处理页面旋转与裁剪，仅适用于常规正立页面。
 * 连续模式（D10 修复）：每页 canvas 渲染完成后按单页同款算法（buildTextSpans）
 * 挂透明文本层，与 canvas 同生命周期（懒渲染窗口外的页无文本层）；选区 mouseup
 * 在滚动容器上检测 → 四色工具条/笔记/选中即问可用，标注 bbox 按选区锚点所在页的
 * viewport 换算；页 wrapper 点击 → 该页 convertToPdfPoint → onPagePoint（有选区时
 * 不触发；未渲染页尺寸未知，不回调）。覆盖层仍按“PDF 用户空间 × scale（y 翻转）”
 * 直接换算（与无旋转 viewport 一致），页高未知时按占位估计。
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
  /** v5.7.0：勾销/恢复一条批注（审阅逐条处理） */
  onToggleResolved?: (id: string, resolved: boolean) => void;
  /** v5.7.0：对未处理批注起草逐条回复（宿主收集并发给 AI） */
  onDraftResponse?: () => void;
  /** L4：删除标注回调（与 onCreateAnnotation 同源宿主存储；未传则侧栏不显示删除按钮）。 */
  onDeleteAnnotation?: (id: string) => void;
  /** L3：选中浮条尾部渲染的自定义动作按钮。 */
  askActions?: PdfAskAction[];
  /** WS-2：画布点击回调（PDF → 源码）——携带页码与 PDF 用户空间坐标；未传则点击不产生回调。 */
  onPagePoint?: (page: number, x: number, y: number) => void;
  /** WS-2：源码 → PDF 定位目标页（与 gotoTick 搭配；缺省或 <1 不生效）。 */
  gotoPage?: number;
  /** WS-2：定位触发计数 —— 变化时跳到 gotoPage 并闪烁高亮（约 1s 褪去）。 */
  gotoTick?: number;
  /** UI 文案语言，默认中文。 */
  language?: PdfReaderLang;
  className?: string;
}

const SCALES = [0.75, 1, 1.5] as const;

/** 阅读模式：single 保持历史单页行为；continuous 为连续滚动 + 懒渲染。 */
type ViewMode = 'single' | 'continuous';
/** 侧栏 tab（切换状态记忆在组件内 state）。 */
type SidebarTab = 'annotations' | 'outline';

/** 连续模式：相邻页 wrapper 的垂直间距（px）。 */
const PAGE_GAP = 12;
/** 连续模式：页面尺寸未知时的占位高宽比（A4 纵向）。 */
const A4_RATIO = 1.414;
/** 连续模式：任何已知页面尺寸前的默认页宽（px）。 */
const DEFAULT_PAGE_WIDTH = 600;

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
    sidebarTabs: '阅读器侧栏',
    outlineTab: '目录',
    noOutline: '本文档无书签',
    modeSingle: '单页',
    modeContinuous: '连续',
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
    sidebarTabs: 'Reader sidebar',
    outlineTab: 'Outline',
    noOutline: 'No bookmarks in this document',
    modeSingle: 'Single',
    modeContinuous: 'Continuous',
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
  /** 选区所在页（单页模式 = 当前页；连续模式 = 选区锚点所在页）。 */
  page: number;
  /** 相对该页画布左上角的选区包围盒（CSS 像素，与视口坐标一致） */
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

/** buildTextSpans 入参 items 元素的最小结构（pdfjs TextItem 携带 str/transform；TextMarkedContent 无）。 */
type PdfTextItemLike = { str: string; transform: number[] } | { type?: string };

/**
 * 文本内容 → 透明文本层 span 列表（单页/连续共用算法）：
 * viewport.transform × item.transform 仿射换算，平移分量为 span 定位（top 上移一个
 * 字号，使 span 基线与文本基线对齐），y 方向缩放分量为字号。
 */
function buildTextSpans(viewport: pdfjsLib.PageViewport, items: ReadonlyArray<PdfTextItemLike>): TextSpan[] {
  const spans: TextSpan[] = [];
  for (const item of items) {
    if (!('str' in item) || !item.str) continue;
    const tx = multiplyTransform(viewport.transform, item.transform);
    const size = Math.hypot(tx[2]!, tx[3]!) || 10;
    spans.push({ text: item.str, left: tx[4]!, top: tx[5]! - size, size });
  }
  return spans;
}

/** 透明文本层（单页/连续模式共用）：span 逐项绝对定位盖在画布上，供选中文字。 */
function TextSpanLayer({ spans, width, height }: { spans: TextSpan[]; width: number; height: number }) {
  return (
    <div
      data-testid="pdf-page-textlayer"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        zIndex: 2,
        overflow: 'hidden',
        color: 'transparent',
        cursor: 'text',
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
    >
      {spans.map((span, index) => (
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
  );
}

/**
 * 连续模式：单页画布 + 透明文本层（D10 修复）。挂载即渲染（由父级按视口 ±1 页窗口
 * 决定是否挂载），卸载即释放——远端页只保留 wrapper 与占位，保证任意时刻挂载
 * canvas 数有界。canvas 渲染完成后按 buildTextSpans（单页同款算法）挂该页文本层，
 * 与 canvas 同生命周期（懒渲染窗口外的页无文本层）；并上报该页实际 viewport，
 * 供父级修正 wrapper 高度、滚动换算与点击/选区坐标换算。
 */
function ContinuousPageCanvas({
  doc,
  pageNumber,
  scale,
  onRendered,
}: {
  doc: pdfjsLib.PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  onRendered: (page: number, viewport: pdfjsLib.PageViewport) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [textLayer, setTextLayer] = useState<{ spans: TextSpan[]; width: number; height: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;
    setTextLayer(null); // 重渲染（scale 变化）期间清掉旧文本层，避免与新画布错位
    (async () => {
      const page = await doc.getPage(pageNumber);
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
      onRendered(pageNumber, pageViewport);
      const content = await page.getTextContent();
      if (cancelled) return;
      setTextLayer({
        spans: buildTextSpans(pageViewport, content.items),
        width: pageViewport.width,
        height: pageViewport.height,
      });
      page.cleanup();
    })().catch(() => {
      // 单页渲染失败：保留占位（wrapper 高度不变），不中断其他页
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [doc, pageNumber, scale, onRendered]);
  return (
    <>
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {textLayer && <TextSpanLayer spans={textLayer.spans} width={textLayer.width} height={textLayer.height} />}
    </>
  );
}

export function PdfReader({
  data,
  annotations,
  onCreateAnnotation,
  onToggleResolved,
  onDraftResponse,
  onDeleteAnnotation,
  askActions,
  onPagePoint,
  gotoPage,
  gotoTick,
  language = 'zh',
  className,
}: PdfReaderProps) {
  const t = (key: string): string => COPY[language][key] ?? COPY.zh[key] ?? key;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
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
  /** v5.7.0 审阅往返：批注处理状态筛选（待处理/已处理） */
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'open' | 'done'>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('single');
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('annotations');
  const [outline, setOutline] = useState<ResolvedOutlineItem[]>([]);
  /** 连续模式：已渲染页的实际视口尺寸（px，随 scale 更新），滚动换算与覆盖层使用。 */
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number }>>({});
  /** 连续模式：最近一次已知页面尺寸（占位高度取其高度，否则按 A4 比例估计）。 */
  const [lastPageSize, setLastPageSize] = useState<{ width: number; height: number } | null>(null);
  /**
   * 连续模式：各页渲染时记录的 viewport（ref 而非 state——避免每页渲染多一次重渲染）。
   * 供点击/选区坐标换算（convertToPdfPoint）；随 data 重置，scale 变化后由页面
   * 重渲染覆盖（短暂窗口内可能滞后一档缩放，可接受）。
   */
  const pageViewportsRef = useRef<Record<number, pdfjsLib.PageViewport>>({});
  const scale = SCALES[scaleIndex] ?? 1;

  const fallbackPageWidth = lastPageSize?.width ?? DEFAULT_PAGE_WIDTH;
  const placeholderPageHeight = lastPageSize ? lastPageSize.height : Math.round(DEFAULT_PAGE_WIDTH * A4_RATIO);

  // —— 连续模式滚动换算：wrapper 高度 = 已知尺寸，否则占位高度（与 DOM 样式同源，保证估算一致） ——
  const pageWrapperHeight = (page: number): number => pageSizes[page]?.height ?? placeholderPageHeight;
  const getPageTop = (page: number): number => {
    let top = 0;
    for (let p = 1; p < page; p++) top += pageWrapperHeight(p) + PAGE_GAP;
    return top;
  };
  const pageAtOffset = (offset: number): number => {
    const max = doc?.numPages ?? 1;
    let acc = 0;
    for (let p = 1; p <= max; p++) {
      const advance = pageWrapperHeight(p) + PAGE_GAP;
      if (offset < acc + advance) return p;
      acc += advance;
    }
    return max;
  };

  // WS-2：gotoTick 变化 → 跳到 gotoPage + 全页半透明矩形闪烁（先立现，随后 1s 褪去）。
  // 大纲/标注点击的跳页也复用同一闪烁效果（goToPage → startFlash）。
  const [flashVisible, setFlashVisible] = useState(false);
  const [flashFading, setFlashFading] = useState(false);
  const flashTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const startFlash = (): void => {
    for (const timer of flashTimers.current) clearTimeout(timer);
    setFlashVisible(true);
    setFlashFading(false);
    const t1 = setTimeout(() => setFlashFading(true), 50);
    const t2 = setTimeout(() => {
      setFlashVisible(false);
      setFlashFading(false);
    }, 1100);
    flashTimers.current = [t1, t2];
  };

  /** 连续模式：滚动到目标页顶部（jsdom/未触发 scroll 事件时也直接同步 pageNum）。 */
  const scrollToPage = (target: number): void => {
    const max = doc?.numPages ?? 1;
    const page = Math.max(1, Math.min(target, max));
    const el = scrollRef.current;
    if (el) el.scrollTop = getPageTop(page);
    setPageNum(page);
  };

  /** 跳页（大纲/标注/gotoTick 等定位路径）：翻页 + 目标页闪烁提示。 */
  const goToPage = (target: number): void => {
    const max = doc?.numPages ?? 1;
    const page = Math.max(1, Math.min(Math.floor(target) || 1, max));
    if (viewMode === 'continuous') scrollToPage(page);
    else setPageNum(page);
    startFlash();
  };

  /** 翻页按钮：单页模式直接换页（不闪烁，保持历史行为）；连续模式滚动到目标页。 */
  const stepPage = (delta: number): void => {
    const max = doc?.numPages ?? 1;
    const target = Math.max(1, Math.min(pageNum + delta, max));
    if (viewMode === 'continuous') scrollToPage(target);
    else setPageNum(target);
  };

  // 连续模式：滚动时同步 pageNum = 视口中心所在页（换算按已知/占位页高估算）
  const handleScroll = (): void => {
    const el = scrollRef.current;
    if (!el || !doc || viewMode !== 'continuous') return;
    const center = el.scrollTop + el.clientHeight / 2;
    const page = pageAtOffset(center);
    if (page !== pageNum) setPageNum(page);
  };
  const scrollHandlerRef = useRef(handleScroll);
  useEffect(() => {
    scrollHandlerRef.current = handleScroll;
  });

  // 连续模式：滚动监听（addEventListener 而非 onScroll，确保各环境行为一致）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || viewMode !== 'continuous' || !doc) return;
    const listener = () => scrollHandlerRef.current();
    el.addEventListener('scroll', listener);
    return () => el.removeEventListener('scroll', listener);
  }, [viewMode, doc]);

  // 连续模式懒渲染：IntersectionObserver 观察各页 wrapper，按真实 DOM 几何校正
  // 视口中心所在页（页面尺寸更新后，滚动换算可能有累计误差）。渲染窗口（±1 页）
  // 由 pageNum 派生——pageNum 的更新源为滚动换算与本 observer。
  useEffect(() => {
    if (viewMode !== 'continuous' || !doc || typeof IntersectionObserver === 'undefined') return;
    const el = scrollRef.current;
    if (!el) return;
    const visible = new Map<number, boolean>();
    let observer: IntersectionObserver;
    try {
      observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) {
            const attr = (entry.target as HTMLElement).getAttribute?.('data-page');
            const page = attr ? Number(attr) : Number.NaN;
            if (Number.isFinite(page)) visible.set(page, entry.isIntersecting);
          }
          const centerY = el.clientHeight / 2;
          let centerPage: number | null = null;
          let nearest: number | null = null;
          let nearestDist = Number.POSITIVE_INFINITY;
          for (const [page, isIntersecting] of visible) {
            if (!isIntersecting) continue;
            const rect = el.querySelector(`[data-page="${page}"]`)?.getBoundingClientRect();
            if (!rect) continue;
            if (rect.top <= centerY && rect.bottom >= centerY) {
              centerPage = page;
              break;
            }
            const dist = Math.abs(rect.top - centerY);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = page;
            }
          }
          const target = centerPage ?? nearest;
          if (target !== null) setPageNum(prev => (prev === target ? prev : target));
        },
        { root: el, rootMargin: '0px', threshold: 0 },
      );
    } catch {
      return; // 环境不支持 IO：仅依赖滚动换算
    }
    for (const node of Array.from(el.querySelectorAll<HTMLElement>('[data-page]'))) observer.observe(node);
    return () => observer.disconnect();
  }, [viewMode, doc]);

  useEffect(() => {
    if (!gotoTick || gotoPage === undefined || !Number.isFinite(gotoPage) || gotoPage < 1) return;
    goToPage(gotoPage);
    return () => {
      for (const timer of flashTimers.current) clearTimeout(timer);
      flashTimers.current = [];
    };
  }, [gotoTick, gotoPage]);

  // 加载文档（getDocument 会转移 buffer，复制一份）。
  // v5.0.0 重编译不跳页：data 变化（重新编译产出新 PDF）时捕获重载前的当前页，
  // 文档就绪后恢复到 min(旧页, 新页数)——所见即所得，而不是每次都弹回第一页。
  // 首次加载（页为 1）行为不变。连续模式需在页占位 DOM 就绪后滚回目标页。
  useEffect(() => {
    let cancelled = false;
    let loaded: pdfjsLib.PDFDocumentProxy | null = null;
    const pageBeforeReload = pageNum;
    setError(null);
    setDoc(null);
    setToolbar(null);
    setOutline([]);
    setPageSizes({});
    setLastPageSize(null);
    pageViewportsRef.current = {};
    const bytes = new Uint8Array(data.slice(0));
    pdfjsLib.getDocument({ data: bytes }).promise.then(
      document => {
        if (cancelled) {
          void document.destroy();
          return;
        }
        loaded = document;
        setDoc(document);
        const restored = Math.max(1, Math.min(pageBeforeReload, document.numPages));
        setPageNum(restored);
        if (viewMode === 'continuous') {
          // 双 rAF：等新文档的页占位 wrapper 先挂载，再滚动归位
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              if (!cancelled) scrollToPage(restored);
            }),
          );
        }
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

  // 大纲（书签）：文档加载后 getOutline() → 先序展开 → dest 解析为 1-based 页码
  // （单项解析失败自动跳过，见 resolveOutlinePages）。无大纲/解析失败 → 空列表（显示占位）。
  useEffect(() => {
    if (!doc) {
      setOutline([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const raw = await doc.getOutline();
        if (cancelled) return;
        const nodes = (Array.isArray(raw) ? raw : []) as PdfOutlineNode[];
        if (nodes.length === 0) {
          setOutline([]);
          return;
        }
        const flat = flattenOutline(nodes);
        const resolved = await resolveOutlinePages(flat, { getPageIndex: createDestPageResolver(doc) });
        if (cancelled) return;
        setOutline(resolved);
      } catch {
        if (!cancelled) setOutline([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [doc]);

  // 渲染当前页 + 重建文本层（仅单页模式；连续模式由 ContinuousPageCanvas 按页渲染）
  useEffect(() => {
    if (!doc || viewMode !== 'single') return;
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
      setTextSpans(buildTextSpans(pageViewport, content.items));
      page.cleanup();
    })().catch(() => {
      if (!cancelled) setError(t('renderFailed'));
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageNum, scale, viewMode]);

  // 连续模式：进入时滚动定位到当前页（doc 变化后 pageNum 归 1 亦复用）
  useEffect(() => {
    if (viewMode === 'continuous' && doc) scrollToPage(pageNum);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, doc]);

  // 连续模式：单页渲染完成后上报 viewport（回调保持稳定，避免画布重复渲染）——
  // 父级据此修正 wrapper 尺寸并记录该页 viewport（点击/选区坐标换算用）
  const handleContinuousPageRendered = useCallback((page: number, viewport: pdfjsLib.PageViewport) => {
    setPageSizes(prev =>
      prev[page] && prev[page]!.width === viewport.width && prev[page]!.height === viewport.height
        ? prev
        : { ...prev, [page]: { width: viewport.width, height: viewport.height } },
    );
    setLastPageSize(prev =>
      prev && prev.width === viewport.width && prev.height === viewport.height ? prev : { width: viewport.width, height: viewport.height },
    );
    pageViewportsRef.current[page] = viewport;
  }, []);

  // 选中检测（单页容器与连续滚动容器共用）：mouseup 时读取 window 选区，非空则
  // 浮现工具条；坐标相对外层 containerRef。连续模式下按选区锚点定位所在页
  // （[data-page] wrapper），选区包围盒换算为相对该页画布的坐标（供 bbox 换算）；
  // 跨页选区按锚点页近似（文本层只存在于已渲染页）。
  const handleMouseUp = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (toolbarRef.current?.contains(event.target as Node)) return; // 工具条内部点击不收起
    const selection = window.getSelection();
    const text = selection ? selection.toString().replace(/\s+/g, ' ').trim() : '';
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (
      !selection ||
      selection.isCollapsed ||
      selection.rangeCount === 0 ||
      !text ||
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
    // 选区所在页与画布原点：单页 = 当前页画布；连续 = 锚点所在 wrapper 内的画布
    let page = pageNum;
    let originRect = canvasRef.current?.getBoundingClientRect() ?? null;
    if (viewMode === 'continuous') {
      const anchorNode = selection.anchorNode;
      const anchorEl = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement ?? null;
      const pageEl = anchorEl?.closest('[data-page]') ?? null;
      const attr = pageEl?.getAttribute('data-page') ?? null;
      const parsed = attr === null ? Number.NaN : Number(attr);
      if (Number.isFinite(parsed)) page = parsed;
      if (pageEl) originRect = (pageEl.querySelector('canvas') ?? pageEl).getBoundingClientRect();
    }
    if (!originRect) {
      setToolbar(null);
      return;
    }
    setToolbar({
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 10,
      text,
      page,
      rect: {
        left: rect.left - originRect.left,
        top: rect.top - originRect.top,
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

  // WS-2：画布点击 → PDF 用户空间坐标回调（PDF → 源码同步；由宿主接 synctexBridge）
  const handleCanvasClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (!onPagePoint || !viewport) return;
    if (toolbarRef.current?.contains(event.target as Node)) return; // 工具条内部点击不参与定位
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // 拖选文字（标注/即问）不触发定位
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const px = event.clientX - canvasRect.left;
    const py = event.clientY - canvasRect.top;
    if (px < 0 || py < 0 || px > canvasRect.width || py > canvasRect.height) return; // 画布外点击忽略
    const point = viewport.convertToPdfPoint(px, py) as unknown as { x: number; y: number };
    onPagePoint(pageNum, point.x, point.y);
  };

  /**
   * 视口坐标 → PDF 用户空间（单页/连续共用）：单页用当前 viewport；连续优先该页
   * 渲染时记录的 viewport，缺失（mock/异常）时按无旋转 viewport 逆变换
   * （x/scale、(页高−y)/scale）估算；单页 viewport 未就绪或连续页尺寸未知返回 null。
   */
  const pdfPointFromViewportPoint = (page: number, px: number, py: number): { x: number; y: number } | null => {
    const vp = viewMode === 'single' ? viewport : pageViewportsRef.current[page] ?? null;
    if (vp) {
      if (typeof vp.convertToPdfPoint === 'function') {
        // pdfjs 类型将换算结果声明为 any[]，此处按 Point 结构取用
        const point = vp.convertToPdfPoint(px, py) as unknown as { x: number; y: number };
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y)) return point;
      }
      return { x: px / scale, y: (vp.height - py) / scale };
    }
    const size = viewMode === 'single' ? null : pageSizes[page];
    return size ? { x: px / scale, y: (size.height - py) / scale } : null;
  };

  // 连续模式：页 wrapper 点击 → 该页 PDF 用户空间坐标回调（PDF → 源码同步）。
  // 与单页同款护栏：工具条内部点击不参与定位；拖选文字（非折叠选区）不触发定位；
  // 画布外点击忽略。点击坐标相对该页画布（canvas），换算复用 pdfPointFromViewportPoint
  // （优先该页渲染时记录的 viewport；未渲染页无 viewport 且尺寸未知 → 不回调）。
  const handleContinuousPageClick = (event: ReactMouseEvent<HTMLDivElement>, pageNo: number): void => {
    if (!onPagePoint) return;
    if (toolbarRef.current?.contains(event.target as Node)) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return; // 拖选文字（标注/即问）不触发定位
    const wrapper = event.currentTarget;
    const pageRect = (wrapper.querySelector('canvas') ?? wrapper).getBoundingClientRect();
    const px = event.clientX - pageRect.left;
    const py = event.clientY - pageRect.top;
    if (px < 0 || py < 0 || px > pageRect.width || py > pageRect.height) return; // 页面外点击忽略
    const point = pdfPointFromViewportPoint(pageNo, px, py);
    if (!point) return;
    onPagePoint(pageNo, point.x, point.y);
  };

  const emitAnnotation = (semantic: HighlightSemantic | undefined, note: string): void => {
    if (!onCreateAnnotation || !toolbar) return;
    const { rect, text, page } = toolbar;
    // 选区包围盒（该页视口坐标）→ PDF 用户空间坐标（左下/右上两点换算）；
    // 单页用当前 viewport，连续用该页渲染时记录的 viewport（复用 pdfPointFromViewportPoint）
    const p1 = pdfPointFromViewportPoint(page, rect.left, rect.top + rect.height);
    const p2 = pdfPointFromViewportPoint(page, rect.left + rect.width, rect.top);
    if (!p1 || !p2) return;
    const bbox: [number, number, number, number] = [
      Math.min(p1.x, p2.x),
      Math.min(p1.y, p2.y),
      Math.max(p1.x, p2.x),
      Math.max(p1.y, p2.y),
    ];
    onCreateAnnotation({
      id: createId(),
      paperId: '', // 组件不感知所属文献，由宿主补全
      page,
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
    let list = [...(annotations ?? [])].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
    if (semanticFilter !== 'all') list = list.filter(a => a.semantic === semanticFilter);
    if (resolvedFilter === 'open') list = list.filter(a => !a.resolved);
    if (resolvedFilter === 'done') list = list.filter(a => a.resolved === true);
    return list;
  }, [annotations, semanticFilter, resolvedFilter]);

  // 连续模式标注覆盖层：没有单页 viewport 对象，按“PDF 用户空间 × scale（y 轴翻转）”
  // 直接换算（与 pdfjs 无旋转 viewport 的 convertToViewportRectangle 一致）。
  // 页面尺寸未知（尚未渲染过）时跳过该页覆盖层。
  const continuousHighlightsFor = (pageNo: number): ReactElement[] => {
    const size = pageSizes[pageNo];
    if (!size) return [];
    return (annotations ?? [])
      .filter(a => a.page === pageNo && a.bbox)
      .map(annotation => {
        const [x1, y1, x2, y2] = annotation.bbox!;
        const left = Math.min(x1, x2) * scale;
        const width = Math.abs(x2 - x1) * scale;
        const top = size.height - Math.max(y1, y2) * scale;
        const height = (Math.max(y1, y2) - Math.min(y1, y2)) * scale;
        const color = annotation.semantic
          ? SEMANTIC_STYLES[annotation.semantic].translucent
          : NEUTRAL_HIGHLIGHT;
        return (
          <div
            key={annotation.id}
            data-annotation-id={annotation.id}
            style={{ position: 'absolute', left, top, width, height, backgroundColor: color, pointerEvents: 'none' }}
          />
        );
      });
  };

  const pageWidth = viewport?.width ?? 0;
  const pageHeight = viewport?.height ?? 0;

  // 侧栏「目录」pane：大纲树按 depth 缩进，点击跳页（goToPage：翻页 + 闪烁提示）
  const outlinePane =
    outline.length === 0 ? (
      <p data-testid="pdf-outline-empty" style={{ color: '#6b7280', fontSize: 11, margin: 0 }}>
        {t('noOutline')}
      </p>
    ) : (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {outline.map((item, index) => (
          <li key={`${index}-${item.title}`}>
            <button
              type="button"
              data-outline-title={item.title}
              onClick={() => goToPage(item.page)}
              title={t('jumpToPage')}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                textAlign: 'left',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontSize: 11,
                color: '#111827',
                lineHeight: 1.4,
                padding: '2px 4px',
                paddingLeft: 4 + item.depth * 14,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
              <span style={{ color: '#6b7280', flex: '0 0 auto' }}>p.{item.page}</span>
            </button>
          </li>
        ))}
      </ul>
    );

  // 侧栏「标注」pane：原有列表（四色筛选 + 删除 + 点击跳页）
  const annotationsPane = (
    <>
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
      {/* v5.7.0：审阅处理状态筛选 + 一键起草回复 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
        {([
          ['all', '全部'],
          ['open', '待处理'],
          ['done', '已处理'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={resolvedFilter === key}
            onClick={() => setResolvedFilter(key)}
            style={{
              border: resolvedFilter === key ? '2px solid #111827' : '1px solid rgba(0,0,0,0.2)',
              background: 'transparent',
              borderRadius: 999,
              fontSize: 10.5,
              padding: '1px 8px',
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
        {onDraftResponse ? (
          <button
            type="button"
            onClick={onDraftResponse}
            title="把未处理批注发给 AI 起草逐条回复"
            style={{
              marginLeft: 'auto',
              border: '1px solid rgba(0,0,0,0.2)',
              background: 'transparent',
              borderRadius: 999,
              fontSize: 10.5,
              padding: '1px 8px',
              cursor: 'pointer',
            }}
          >
            ✦ 起草回复
          </button>
        ) : null}
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
                  onClick={() => goToPage(annotation.page)}
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
                  <span style={annotation.resolved ? { textDecoration: 'line-through', color: '#9ca3af' } : undefined}>
                    {truncated || t('noExcerpt')}
                  </span>
                </button>
                {onToggleResolved && (
                  <button
                    type="button"
                    title={annotation.resolved ? '标记为待处理' : '标记为已处理'}
                    aria-label={`${annotation.resolved ? '恢复' : '勾销'} p.${annotation.page}`}
                    onClick={() => onToggleResolved(annotation.id, !annotation.resolved)}
                    style={{
                      border: 'none',
                      background: 'none',
                      color: annotation.resolved ? '#1a7f37' : '#9ca3af',
                      cursor: 'pointer',
                      fontSize: 13,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    {annotation.resolved ? '✓' : '○'}
                  </button>
                )}
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
    </>
  );

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
      aria-label={t('sidebarTabs')}
    >
      {/* 两个 tab（标注 / 目录），切换状态记忆在组件内 state，随组件生命周期保留 */}
      <div role="tablist" aria-label={t('sidebarTabs')} style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'annotations'}
          onClick={() => setSidebarTab('annotations')}
          style={{
            fontSize: 11,
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: sidebarTab === 'annotations' ? '#e5e7eb' : 'transparent',
            cursor: 'pointer',
          }}
        >
          {t('annotationsTitle')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sidebarTab === 'outline'}
          onClick={() => setSidebarTab('outline')}
          style={{
            fontSize: 11,
            padding: '2px 10px',
            borderRadius: 6,
            border: '1px solid #d1d5db',
            background: sidebarTab === 'outline' ? '#e5e7eb' : 'transparent',
            cursor: 'pointer',
          }}
        >
          {t('outlineTab')}
        </button>
      </div>
      {sidebarTab === 'annotations' ? annotationsPane : outlinePane}
    </aside>
  ) : null;

  // 选中浮动工具条（单页/连续共用）：四色高亮 + 笔记 + 选中即问。单页渲染在页容器内，
  // 连续渲染在滚动容器外（避免被 overflowY 裁剪；坐标均相对外层 containerRef）。
  const toolbarNode = toolbar ? (
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
  ) : null;

  return (
    <div className={className} ref={containerRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <button type="button" onClick={() => stepPage(-1)} disabled={!doc || pageNum <= 1}>
              {t('prevPage')}
            </button>
            <span aria-live="polite">{doc ? `${pageNum} / ${doc.numPages}` : '…'}</span>
            <button type="button" onClick={() => stepPage(1)} disabled={!doc || pageNum >= doc.numPages}>
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
            <span
              role="group"
              aria-label={t('modeSingle') + ' / ' + t('modeContinuous')}
              style={{ display: 'inline-flex', border: '1px solid #d1d5db', borderRadius: 6, overflow: 'hidden' }}
            >
              <button
                type="button"
                aria-pressed={viewMode === 'single'}
                disabled={!doc}
                onClick={() => setViewMode('single')}
                style={{
                  border: 'none',
                  background: viewMode === 'single' ? '#e5e7eb' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 8px',
                }}
              >
                {t('modeSingle')}
              </button>
              <button
                type="button"
                aria-pressed={viewMode === 'continuous'}
                disabled={!doc}
                onClick={() => setViewMode('continuous')}
                style={{
                  border: 'none',
                  background: viewMode === 'continuous' ? '#e5e7eb' : 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  padding: '2px 8px',
                }}
              >
                {t('modeContinuous')}
              </button>
            </span>
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
          ) : viewMode === 'continuous' && doc ? (
            // 连续滚动模式：全部页 wrapper 按序排布；仅视口附近 ±1 页挂载 canvas + 透明
            // 文本层（≤3 组，满足 ≤5 护栏），远端页保留 wrapper + 占位高度（上一已知视口
            // 高度或 A4 比例）—— 文本层与 canvas 同生命周期。滚动时同步 pageNum = 视口中心
            // 所在页（滚动监听 + IntersectionObserver 校正）。选中 mouseup 在滚动容器上检测
            // → 四色工具条（渲染在容器外，不被裁剪）；页 wrapper 点击 → onPagePoint。
            <>
              <div
                ref={scrollRef}
                data-testid="pdf-continuous-scroll"
                onMouseUp={handleMouseUp}
                style={{
                  maxHeight: 480,
                  overflowY: 'auto',
                  border: '1px solid #e5e7eb',
                  borderRadius: 8,
                  background: '#f3f4f6',
                  padding: 8,
                }}
              >
                {Array.from({ length: doc.numPages }, (_, i) => i + 1).map(pageNo => {
                  const size = pageSizes[pageNo];
                  const width = size?.width ?? fallbackPageWidth;
                  const height = size?.height ?? placeholderPageHeight;
                  const active = pageNo >= pageNum - 1 && pageNo <= pageNum + 1;
                  return (
                    <div
                      key={pageNo}
                      data-page={pageNo}
                      onClick={event => handleContinuousPageClick(event, pageNo)}
                      style={{
                      position: 'relative',
                      width,
                      height,
                      marginBottom: pageNo < doc.numPages ? PAGE_GAP : 0,
                      background: '#ffffff',
                      border: '1px solid #d1d5db',
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                    }}
                  >
                    {active ? (
                      <ContinuousPageCanvas
                        doc={doc}
                        pageNumber={pageNo}
                        scale={scale}
                        onRendered={handleContinuousPageRendered}
                      />
                    ) : (
                      <div
                        data-testid="pdf-page-placeholder"
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#9ca3af',
                          fontSize: 12,
                        }}
                      >
                        {pageNo}
                      </div>
                    )}
                    <div style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', zIndex: 1 }}>
                      {continuousHighlightsFor(pageNo)}
                    </div>
                    {flashVisible && pageNo === pageNum && (
                      <div
                        data-testid="pdf-goto-flash"
                        style={{
                          position: 'absolute',
                          left: 0,
                          top: 0,
                          width: '100%',
                          height: '100%',
                          zIndex: 3,
                          pointerEvents: 'none',
                          borderRadius: 4,
                          border: '2px solid rgba(59, 130, 246, 0.8)',
                          background: 'rgba(59, 130, 246, 0.18)',
                          opacity: flashFading ? 0 : 1,
                          transition: 'opacity 1s ease-out',
                        }}
                      />
                    )}
                  </div>
                );
                })}
              </div>
              {toolbarNode}
            </>
          ) : (
            <div
              style={{ position: 'relative', width: pageWidth || undefined }}
              onMouseUp={handleMouseUp}
              onClick={handleCanvasClick}
            >
              <canvas ref={canvasRef} style={{ display: 'block', border: '1px solid #d1d5db' }} />
              {viewport && (
                <>
                  <div style={{ position: 'absolute', left: 0, top: 0, width: pageWidth, height: pageHeight, zIndex: 1 }}>
                    {highlights}
                  </div>
                  <TextSpanLayer spans={textSpans} width={pageWidth} height={pageHeight} />
                  {flashVisible && (
                    <div
                      data-testid="pdf-goto-flash"
                      style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        width: pageWidth,
                        height: pageHeight,
                        zIndex: 3,
                        pointerEvents: 'none',
                        borderRadius: 4,
                        border: '2px solid rgba(59, 130, 246, 0.8)',
                        background: 'rgba(59, 130, 246, 0.18)',
                        opacity: flashFading ? 0 : 1,
                        transition: 'opacity 1s ease-out',
                      }}
                    />
                  )}
                </>
              )}
              {toolbarNode}
            </div>
          )}
        </div>
        {sidebar}
      </div>
    </div>
  );
}
