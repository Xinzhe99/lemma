// @vitest-environment jsdom
/**
 * PdfReader WS-2 新 props 组件测试：gotoTick 翻页 + 闪烁、onPagePoint 坐标换算。
 * pdfjs-dist 以 mock 注入（jsdom 无 canvas 2d 后端与 worker），验证组件接线、
 * 视口坐标 → PDF 用户空间坐标的换算路径与 props 透传，不依赖真实 pdfjs 渲染。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfReader, type PdfReaderProps } from './PdfReader';

// pdfjs mock 需在模块导入前创建（vi.hoisted），工厂与测试体共享同一组 spy
const pdfjsMock = vi.hoisted(() => {
  const getPage = vi.fn();
  const convertToPdfPoint = vi.fn((x: number, y: number) => ({ x: x / 2, y: y / 2 }));
  const convertToViewportRectangle = vi.fn((r: [number, number, number, number]) => r);
  return { getPage, convertToPdfPoint, convertToViewportRectangle };
});

vi.mock('pdfjs-dist', () => ({
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
      getPage: (n: number) => pdfjsMock.getPage(n),
      destroy: async () => {},
    }),
  }),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makePage() {
  return {
    getViewport: () => ({
      width: 600,
      height: 800,
      transform: [1, 0, 0, 1, 0, 0],
      convertToPdfPoint: pdfjsMock.convertToPdfPoint,
      convertToViewportRectangle: pdfjsMock.convertToViewportRectangle,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({ items: [] }),
    cleanup: () => {},
  };
}

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

/** 冲刷文档加载与页面渲染的异步链（真实定时器） */
async function flushLoad(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** 冲刷微任务异步链（fake timers 下 setTimeout 被劫持，只能冲微任务） */
async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

const flash = (): Element | null => container?.querySelector('[data-testid="pdf-goto-flash"]') ?? null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  pdfjsMock.getPage.mockReset();
  pdfjsMock.getPage.mockImplementation(async () => makePage());
  pdfjsMock.convertToPdfPoint.mockClear();
  pdfjsMock.convertToViewportRectangle.mockClear();
  // jsdom 无 canvas 2d 后端：桩掉 getContext（组件只把它透传给 render）与画布几何
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  baseProps = null;
});

describe('PdfReader 文档加载（mock pdfjs 透传路径）', () => {
  it('加载文档并渲染第 1 页', async () => {
    renderReader();
    await flushLoad();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);
    expect(container!.textContent).toContain('1 / 2');
  });

  it('v5.0.0 数据更新（重编译）保持当前页，不弹回第 1 页', async () => {
    renderReader();
    await flushLoad();
    // 先翻到第 2 页
    const props = baseProps!;
    act(() => {
      root!.render(<PdfReader {...props} gotoPage={2} gotoTick={1} />);
    });
    await flushMicrotasks();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);
    pdfjsMock.getPage.mockClear();

    // 重新编译：同一文档对象换成新 data → 应停留在第 2 页
    const newData = new ArrayBuffer(8);
    act(() => {
      root!.render(<PdfReader {...props} data={newData} />);
    });
    await flushLoad();
    expect(container!.textContent).toContain('2 / 2');
    expect(pdfjsMock.getPage).not.toHaveBeenCalledWith(1);
  });
});

describe('PdfReader gotoPage / gotoTick（源码 → PDF 定位）', () => {
  it('gotoTick 变化 → 跳到 gotoPage 并显示闪烁矩形，约 1s 褪去', async () => {
    renderReader();
    await flushLoad();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);

    vi.useFakeTimers();
    const props = baseProps!;
    act(() => {
      root!.render(<PdfReader {...props} gotoPage={2} gotoTick={1} />);
    });
    // 闪烁矩形立现，翻页触发第 2 页渲染
    expect(flash()).not.toBeNull();
    await flushMicrotasks();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(2);

    // 50ms 后进入褪去（opacity 0），1.1s 后移除
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(flash()).not.toBeNull();
    expect((flash() as HTMLElement).style.opacity).toBe('0');
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(flash()).toBeNull();
  });

  it('gotoTick 再次变化 → 重新闪烁（定时器重置）', async () => {
    renderReader();
    await flushLoad();
    vi.useFakeTimers();
    const props = baseProps!;
    act(() => {
      root!.render(<PdfReader {...props} gotoPage={2} gotoTick={1} />);
    });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(flash()).toBeNull();
    act(() => {
      root!.render(<PdfReader {...props} gotoPage={1} gotoTick={2} />);
    });
    expect(flash()).not.toBeNull();
    await flushMicrotasks();
    expect(pdfjsMock.getPage).toHaveBeenCalledWith(1);
  });

  it('缺 gotoTick（或为 0）时不触发定位', async () => {
    renderReader({ gotoPage: 2 });
    await flushLoad();
    expect(pdfjsMock.getPage).not.toHaveBeenCalledWith(2);
    expect(flash()).toBeNull();

    vi.useFakeTimers();
    const props = baseProps!;
    act(() => {
      root!.render(<PdfReader {...props} gotoPage={2} gotoTick={0} />);
    });
    expect(pdfjsMock.getPage).not.toHaveBeenCalledWith(2);
    expect(flash()).toBeNull();
  });
});

describe('PdfReader onPagePoint（PDF → 源码坐标回调）', () => {
  it('画布点击：视口坐标经 convertToPdfPoint 换算后回调页码与 PDF 用户空间坐标', async () => {
    const onPagePoint = vi.fn();
    renderReader({ onPagePoint });
    await flushLoad();
    const canvas = container!.querySelector('canvas')!;
    act(() => {
      canvas.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 220, bubbles: true }));
    });
    // 画布几何 (10,20) 起步 → 视口坐标 (100,200)；mock 换算减半 → (50,100)
    expect(pdfjsMock.convertToPdfPoint).toHaveBeenCalledWith(100, 200);
    expect(onPagePoint).toHaveBeenCalledTimes(1);
    expect(onPagePoint).toHaveBeenCalledWith(1, 50, 100);
  });

  it('画布外点击不回调；未传 onPagePoint 时点击无副作用', async () => {
    const onPagePoint = vi.fn();
    renderReader({ onPagePoint });
    await flushLoad();
    const canvas = container!.querySelector('canvas')!;
    act(() => {
      canvas.dispatchEvent(new MouseEvent('click', { clientX: 5, clientY: 220, bubbles: true }));
    });
    expect(onPagePoint).not.toHaveBeenCalled();

    renderReader({ onPagePoint: undefined });
    await flushLoad();
    const canvas2 = container!.querySelector('canvas')!;
    expect(() =>
      act(() => {
        canvas2.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 220, bubbles: true }));
      }),
    ).not.toThrow();
    expect(onPagePoint).not.toHaveBeenCalled();
  });
});
