// @vitest-environment jsdom
/**
 * PdfReader 增强组件测试：大纲（书签）导航 + 连续滚动模式 + D10（连续模式文本层）。
 * pdfjs-dist 以 mock 注入（手法同 PdfReader.test.tsx；jsdom 无 canvas 2d 后端与 worker），
 * 验证接线与行为契约：目录树渲染/跳页/失败项跳过、模式切换的 wrapper 与占位、
 * 滚动同步 pageNum、懒渲染 canvas 数量护栏（≤5）、翻页按钮滚动定位。
 * D10：连续模式可见页挂透明文本层（span 定位与单页同款算法）、窗口外页无文本层、
 * 页 wrapper 点击 → onPagePoint（该页 convertToPdfPoint 换算；有选区/未渲染页不触发）、
 * 选中文字 → 四色工具条 → 创建标注 bbox 按该页 viewport 换算。
 * IntersectionObserver 在 jsdom 缺失：一处用桩验证观察接线，其余用例走滚动换算路径。
 * jsdom Range 无 getBoundingClientRect：选中用例以 Object.defineProperty 桩选区几何。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@lemma/shared';
import { PdfReader, type PdfReaderProps } from './PdfReader';

// pdfjs mock 需在模块导入前创建（vi.hoisted），工厂与测试体共享同一组 spy
const pdfjsMock = vi.hoisted(() => {
  const getPage = vi.fn();
  const getOutline = vi.fn();
  const getDestination = vi.fn();
  const getPageIndex = vi.fn();
  const convertToPdfPoint = vi.fn((x: number, y: number) => ({ x: x / 2, y: y / 2 }));
  return { getPage, getOutline, getDestination, getPageIndex, convertToPdfPoint };
});

vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 5,
      getPage: (n: number) => pdfjsMock.getPage(n),
      getOutline: () => pdfjsMock.getOutline(),
      getDestination: (name: string) => pdfjsMock.getDestination(name),
      getPageIndex: (ref: { num: number; gen: number }) => pdfjsMock.getPageIndex(ref),
      destroy: async () => {},
    }),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 5 页文档，每页视口 600×800；每页含一项文本（transform 定位 30,700、字号 10） */
function makePage() {
  return {
    getViewport: () => ({
      width: 600,
      height: 800,
      transform: [1, 0, 0, 1, 0, 0],
      convertToPdfPoint: (x: number, y: number) => pdfjsMock.convertToPdfPoint(x, y),
      convertToViewportRectangle: (r: [number, number, number, number]) => r,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({
      items: [{ str: 'Continuous text', transform: [10, 0, 0, 10, 30, 700] }],
    }),
    cleanup: () => {},
  };
}

/** 大纲夹具：ref.num 为 0-based 页索引；「无目标」dest=null 应被跳过 */
const OUTLINE = [
  {
    title: '第一章',
    dest: [{ num: 0, gen: 0 }, { name: 'Fit' }],
    items: [{ title: '1.1 节', dest: [{ num: 1, gen: 0 }], items: [] }, { title: '无目标', dest: null, items: [] }],
  },
  { title: '第二章', dest: [{ num: 2, gen: 0 }], items: [] },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let baseProps: PdfReaderProps | null = null;

function renderReader(props: Partial<PdfReaderProps> = {}): PdfReaderProps {
  const all: PdfReaderProps = { data: new ArrayBuffer(8), ...props };
  baseProps = all;
  act(() => {
    root!.render(<PdfReader {...all} />);
  });
  return all;
}

/** 冲刷文档加载、大纲解析与页面渲染的异步链（真实定时器） */
async function flushLoad(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

function exactButton(text: string): HTMLButtonElement {
  const btn = Array.from(container!.querySelectorAll('button')).find(b => b.textContent === text);
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn;
}

const scroller = (): HTMLElement =>
  container!.querySelector('[data-testid="pdf-continuous-scroll"]') as HTMLElement;
const placeholders = (): NodeListOf<HTMLElement> =>
  container!.querySelectorAll('[data-testid="pdf-page-placeholder"]');
const canvases = (): Element[] => Array.from(container!.querySelectorAll('canvas'));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pdfjsMock.getPage.mockReset();
  pdfjsMock.getPage.mockImplementation(async () => makePage());
  pdfjsMock.getOutline.mockReset();
  pdfjsMock.getOutline.mockResolvedValue(OUTLINE);
  pdfjsMock.getDestination.mockReset();
  pdfjsMock.getDestination.mockResolvedValue(null);
  pdfjsMock.getPageIndex.mockReset();
  pdfjsMock.getPageIndex.mockImplementation(async (ref: { num: number }) => ref.num);
  pdfjsMock.convertToPdfPoint.mockClear(); // 保留实现（减半换算），只清调用记录
  // jsdom 无 canvas 2d 后端：桩掉 getContext（组件只把它透传给 render）；画布几何桩
  // (10,20) 起步 600×800——连续模式点击/选区的坐标换算原点（手法同 PdfReader.test.tsx）
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 600,
    height: 800,
    right: 610,
    bottom: 820,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect; // 选中用例的几何桩
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  baseProps = null;
});

describe('PdfReader 大纲（目录）导航', () => {
  it('文档加载后解析大纲：侧栏目录 tab 显示树（缩进按 depth），失败项跳过', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('标注 (0)').click(); // 打开侧栏（工具条 toggle）
    });
    expect(container!.querySelector('[role="tablist"]')).not.toBeNull();
    expect(container!.textContent).toContain('标注'); // 默认 tab 为标注
    act(() => {
      exactButton('目录').click();
    });
    const items = Array.from(container!.querySelectorAll<HTMLButtonElement>('[data-outline-title]'));
    expect(items.map(b => b.dataset.outlineTitle)).toEqual(['第一章', '1.1 节', '第二章']); // 「无目标」解析失败被跳过
    expect(items.map(b => b.textContent)).toEqual(['第一章p.1', '1.1 节p.2', '第二章p.3']); // 0-based + 1
    expect(items[0]!.style.paddingLeft).toBe('4px'); // depth 0
    expect(items[1]!.style.paddingLeft).toBe('18px'); // depth 1（4 + 14×1）
    expect(items[2]!.style.paddingLeft).toBe('4px');
  });

  it('点击目录条目 → 跳页（复用 setPageNum 路径）并触发 goto 闪烁', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('标注 (0)').click();
    });
    act(() => {
      exactButton('目录').click();
    });
    act(() => {
      (container!.querySelector('button[data-outline-title="1.1 节"]') as HTMLButtonElement).click();
    });
    expect(container!.querySelector('[data-testid="pdf-goto-flash"]')).not.toBeNull();
    expect(container!.textContent).toContain('2 / 5');
    await flushLoad();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);
  });

  it('无大纲（空数组 / getOutline 抛错）→ 目录 tab 显示占位文案', async () => {
    pdfjsMock.getOutline.mockResolvedValue([]);
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('标注 (0)').click();
    });
    act(() => {
      exactButton('目录').click();
    });
    expect(container!.querySelector('[data-testid="pdf-outline-empty"]')).not.toBeNull();
    expect(container!.textContent).toContain('本文档无书签');

    pdfjsMock.getOutline.mockRejectedValue(new Error('outline error'));
    renderReader();
    await flushLoad();
    act(() => {
      const toggle = exactButton('标注 (0)');
      if (toggle.getAttribute('aria-pressed') === 'false') toggle.click(); // 侧栏开合状态跨 re-render 保留
    });
    act(() => {
      exactButton('目录').click();
    });
    expect(container!.querySelector('[data-testid="pdf-outline-empty"]')).not.toBeNull();
  });

  it('tab 切换状态记忆（组件内 state）：目录 ⇄ 标注往返保持所选 tab', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('标注 (0)').click();
    });
    act(() => {
      exactButton('目录').click();
    });
    expect(container!.textContent).toContain('第一章');
    act(() => {
      exactButton('标注').click();
    });
    expect(container!.textContent).toContain('暂无标注');
    expect(container!.textContent).not.toContain('第一章');
    act(() => {
      exactButton('目录').click();
    });
    expect(container!.textContent).toContain('第一章');
  });
});

describe('PdfReader 连续滚动模式', () => {
  it('模式切换：全部页 wrapper 按序渲染，仅视口 ±1 页挂载 canvas，未渲染页显示占位', async () => {
    renderReader();
    await flushLoad();
    // 单页默认回归：1 个 canvas、无连续容器、无占位
    expect(container!.querySelector('[data-testid="pdf-continuous-scroll"]')).toBeNull();
    expect(canvases().length).toBe(1);
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    expect(scroller()).not.toBeNull();
    const wrappers = scroller().querySelectorAll('[data-page]');
    expect(wrappers.length).toBe(5);
    expect(canvases().length).toBe(2); // pageNum=1 → 窗口 [1,2]
    expect(placeholders().length).toBe(3);
    expect(canvases().length).toBeLessThanOrEqual(5); // 性能护栏
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);
    expect(pdfjsMock.getPage).not.toHaveBeenCalledWith(4);
    // 占位样式：wrapper 高度 = 已知视口高度（600×800），占位元素占满 wrapper
    expect((wrappers[4] as HTMLElement).style.height).toBe('800px');
    expect((wrappers[4] as HTMLElement).querySelector('[data-testid="pdf-page-placeholder"]')).not.toBeNull();
  });

  it('滚动同步 pageNum（视口中心所在页）并虚拟化远端 canvas（≤5）', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    // 已知页高 800 + 间距 12 → 每页步进 812；scrollTop 1700 → 中心落在第 3 页
    act(() => {
      scroller().scrollTop = 1700;
      scroller().dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await flushLoad(); // 冲刷新挂载页的渲染链，避免 act 外 setState
    expect(container!.textContent).toContain('3 / 5');
    const wrappers = scroller().querySelectorAll('[data-page]');
    expect(wrappers.length).toBe(5); // wrapper 全保留
    expect(canvases().length).toBe(3); // 窗口 [2,4]
    expect(placeholders().length).toBe(2);
    expect(canvases().length).toBeLessThanOrEqual(5);
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(4);
    expect(pdfjsMock.getPage).not.toHaveBeenCalledWith(5);
  });

  it('翻页按钮在连续模式下滚动到目标页（scrollTop = 812×(target-1)）并同步页码', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    act(() => {
      exactButton('下一页').click();
    });
    await flushLoad();
    expect(scroller().scrollTop).toBe(812);
    expect(container!.textContent).toContain('2 / 5');
    act(() => {
      exactButton('下一页').click();
    });
    await flushLoad();
    expect(scroller().scrollTop).toBe(1624);
    expect(container!.textContent).toContain('3 / 5');
    act(() => {
      exactButton('上一页').click();
    });
    await flushLoad();
    expect(scroller().scrollTop).toBe(812);
    expect(container!.textContent).toContain('2 / 5');
  });

  it('连续 → 单页：回归单页渲染（1 canvas、无连续容器），页码保持', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    act(() => {
      scroller().scrollTop = 1700;
      scroller().dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await flushLoad();
    expect(container!.textContent).toContain('3 / 5');
    act(() => {
      exactButton('单页').click();
    });
    await flushLoad();
    expect(container!.querySelector('[data-testid="pdf-continuous-scroll"]')).toBeNull();
    expect(canvases().length).toBe(1);
    expect(container!.textContent).toContain('3 / 5');
    expect(pdfjsMock.getPage).toHaveBeenLastCalledWith(3);
  });

  it('连续模式：标注覆盖层按页挂载（用户空间 × scale、y 翻转换算）', async () => {
    const annotation: Annotation = {
      id: 'a1',
      paperId: '',
      page: 1,
      kind: 'highlight',
      semantic: 'method',
      bbox: [50, 700, 300, 750],
      quotedText: 'demo',
      createdAt: 1,
    };
    renderReader({ annotations: [annotation] });
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    const overlay = container!.querySelector('[data-page="1"] [data-annotation-id="a1"]') as HTMLElement;
    expect(overlay).not.toBeNull();
    expect(overlay.style.left).toBe('50px');
    expect(overlay.style.top).toBe('50px'); // 800 - 750
    expect(overlay.style.width).toBe('250px');
    expect(overlay.style.height).toBe('50px');
    // 远端未渲染页（尺寸未知）无覆盖层
    expect(container!.querySelector('[data-page="5"] [data-annotation-id]')).toBeNull();
  });

  it('IntersectionObserver 接线：观察全部 wrapper，卸载时断开', async () => {
    class IOStub {
      static instances: IOStub[] = [];
      observed: Element[] = [];
      disconnected = false;
      constructor(_cb: unknown) {
        IOStub.instances.push(this);
      }
      observe(el: Element): void {
        this.observed.push(el);
      }
      disconnect(): void {
        this.disconnected = true;
      }
      unobserve(): void {}
    }
    vi.stubGlobal('IntersectionObserver', IOStub);
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    expect(IOStub.instances.length).toBe(1);
    expect(IOStub.instances[0]!.observed.length).toBe(5);
    act(() => {
      root!.unmount();
    });
    expect(IOStub.instances[0]!.disconnected).toBe(true);
    root = null;
  });
});

describe('PdfReader 连续模式 D10：文本层 / 选中 / 点击同步', () => {
  const textLayers = (): NodeListOf<HTMLElement> =>
    container!.querySelectorAll('[data-testid="pdf-page-textlayer"]');

  /** 在指定页文本层 span 上建立非折叠选区（jsdom Selection 可用；几何需另行桩 Range） */
  function selectPageText(page: number): HTMLElement {
    const span = container!.querySelector(
      `[data-page="${page}"] [data-testid="pdf-page-textlayer"] span`,
    ) as HTMLElement | null;
    if (!span) throw new Error(`text span not found on page ${page}`);
    const range = document.createRange();
    range.selectNodeContents(span);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return span;
  }

  it('可见页渲染透明文本层（span 定位与单页同款算法），窗口外懒渲染页无文本层', async () => {
    renderReader();
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    // 窗口 [1,2]：每可见页一个文本层，与 canvas 同生命周期
    expect(textLayers().length).toBe(2);
    // span 定位：viewport transform 恒等 → item.transform 平移量为 (30,700)、字号 10
    // （top 上移一个字号 → 690，与单页模式 buildTextSpans 同款换算）
    const span1 = textLayers()[0]!.querySelector('span') as HTMLElement;
    expect(span1.textContent).toBe('Continuous text');
    expect(span1.style.left).toBe('30px');
    expect(span1.style.top).toBe('690px');
    expect(span1.style.fontSize).toBe('10px');
    // 文本层可选中（透明 + userSelect: text）
    expect((textLayers()[0] as HTMLElement).style.userSelect).toBe('text');
    expect((textLayers()[0] as HTMLElement).style.color).toBe('transparent');
    // 窗口外页（4、5）无文本层（只有占位）
    expect(container!.querySelector('[data-page="4"] [data-testid="pdf-page-textlayer"]')).toBeNull();
    expect(container!.querySelector('[data-page="5"] [data-testid="pdf-page-textlayer"]')).toBeNull();
    expect(placeholders().length).toBe(3);
  });

  it('点击某页画布 → onPagePoint 携带该页页码与 convertToPdfPoint 换算坐标；未渲染页点击不回调', async () => {
    const onPagePoint = vi.fn();
    renderReader({ onPagePoint });
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    const canvas2 = container!.querySelector('[data-page="2"] canvas') as HTMLCanvasElement;
    act(() => {
      canvas2.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 220, bubbles: true }));
    });
    // 画布几何 (10,20) 起步 → 该页视口坐标 (100,200)；mock 换算减半 → (50,100)
    expect(pdfjsMock.convertToPdfPoint).toHaveBeenCalledWith(100, 200);
    expect(onPagePoint).toHaveBeenCalledTimes(1);
    expect(onPagePoint).toHaveBeenCalledWith(2, 50, 100);
    // 窗口外未渲染页（无 viewport、尺寸未知）点击不回调
    const wrapper5 = container!.querySelector('[data-page="5"]') as HTMLElement;
    act(() => {
      wrapper5.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 220, bubbles: true }));
    });
    expect(onPagePoint).toHaveBeenCalledTimes(1);
  });

  it('有文字选区时点击画布不触发 onPagePoint（与单页同款护栏）', async () => {
    const onPagePoint = vi.fn();
    renderReader({ onPagePoint });
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    selectPageText(1);
    expect(window.getSelection()?.toString()).toBe('Continuous text');
    const canvas1 = container!.querySelector('[data-page="1"] canvas') as HTMLCanvasElement;
    act(() => {
      canvas1.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 220, bubbles: true }));
    });
    expect(onPagePoint).not.toHaveBeenCalled();
    window.getSelection()?.removeAllRanges();
  });

  it('选中文字浮现四色工具条，创建标注的 bbox 按该页 viewport 换算', async () => {
    const onCreateAnnotation = vi.fn();
    renderReader({ onCreateAnnotation });
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    // jsdom Range 无几何：桩选区包围盒 {left:100, top:200, w:50, h:20}（视口坐标）
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 200,
        width: 50,
        height: 20,
        right: 150,
        bottom: 220,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }),
    });
    const span = selectPageText(2); // 在第 2 页选中文字
    act(() => {
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    // 四色工具条出现（滚动容器外，不被 overflowY 裁剪）
    const methodBtn = container!.querySelector('[aria-label="方法"]') as HTMLButtonElement | null;
    expect(methodBtn).not.toBeNull();
    expect(container!.querySelectorAll('[aria-label="发现"], [aria-label="质疑"], [aria-label="引用"]').length).toBe(3);
    act(() => {
      methodBtn!.click();
    });
    // 标注落在选区所在页（2），bbox 两角换算：画布相对矩形 (90,180,w50,h20) →
    // (90,200)/(140,180) 经 mock 减半 → (45,100)/(70,90) → bbox [45,90,70,100]
    expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
    const created = onCreateAnnotation.mock.calls[0][0] as Annotation;
    expect(created.page).toBe(2);
    expect(created.kind).toBe('highlight');
    expect(created.semantic).toBe('method');
    expect(created.bbox).toEqual([45, 90, 70, 100]);
    expect(created.quotedText).toBe('Continuous text');
    expect(pdfjsMock.convertToPdfPoint).toHaveBeenCalledWith(90, 200);
    expect(pdfjsMock.convertToPdfPoint).toHaveBeenCalledWith(140, 180);
    // 创建后选区清除、工具条收起
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(container!.querySelector('[aria-label="方法"]')).toBeNull();
  });

  it('v7.9.2 Feishu 式：📝 展开笔记输入，Enter 创建 note 标注；视口下部浮条翻转到选区上方', async () => {
    const onCreateAnnotation = vi.fn();
    renderReader({ onCreateAnnotation });
    await flushLoad();
    act(() => {
      exactButton('连续').click();
    });
    await flushLoad();
    // 桩选区几何：bottom=220 → 视口高 800 的下部判断在此不触发；直接验证 flip 类随几何变化
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 100,
        top: 200,
        width: 50,
        height: 20,
        right: 150,
        bottom: 220,
        x: 100,
        y: 200,
        toJSON: () => ({}),
      }),
    });
    const span = selectPageText(2);
    act(() => {
      span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    // 浮条出现且带 flip 翻转类（jsdom 容器高 0 → 视口下部判定恒真，属预期降级）
    const pill = container!.querySelector('.sf-pdf-sel') as HTMLElement | null;
    expect(pill).not.toBeNull();
    expect(pill!.classList.contains('flip')).toBe(true);
    // 笔记输入默认收起；点 📝（aria-label = 保存笔记）展开
    expect(container!.querySelector('.sf-pdf-sel-note')).toBeNull();
    const noteBtn = container!.querySelector('[aria-label="保存笔记"]') as HTMLButtonElement | null;
    expect(noteBtn).not.toBeNull();
    act(() => {
      noteBtn!.click();
    });
    const textarea = container!.querySelector('.sf-pdf-sel-note textarea') as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    // 输入 + Enter → 创建 note 标注（semantic 为空、text=笔记）
    expect(textarea).not.toBeNull();
    act(() => {
      fireEvent.change(textarea!, { target: { value: '这句话值得记录' } });
    });
    act(() => {
      fireEvent.keyDown(textarea!, { key: 'Enter' });
    });
    expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
    const created = onCreateAnnotation.mock.calls[0][0] as Annotation;
    expect(created.kind).toBe('note');
    expect(created.semantic).toBeUndefined();
    expect(created.text).toBe('这句话值得记录');
    // 创建后浮条与笔记输入一并收起
    expect(container!.querySelector('.sf-pdf-sel')).toBeNull();
  });
});
