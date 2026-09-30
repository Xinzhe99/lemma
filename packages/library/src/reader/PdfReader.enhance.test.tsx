// @vitest-environment jsdom
/**
 * PdfReader 增强组件测试：大纲（书签）导航 + 连续滚动模式。
 * pdfjs-dist 以 mock 注入（手法同 PdfReader.test.tsx；jsdom 无 canvas 2d 后端与 worker），
 * 验证接线与行为契约：目录树渲染/跳页/失败项跳过、模式切换的 wrapper 与占位、
 * 滚动同步 pageNum、懒渲染 canvas 数量护栏（≤5）、翻页按钮滚动定位。
 * IntersectionObserver 在 jsdom 缺失：一处用桩验证观察接线，其余用例走滚动换算路径。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation } from '@scholarforge/shared';
import { PdfReader, type PdfReaderProps } from './PdfReader';

// pdfjs mock 需在模块导入前创建（vi.hoisted），工厂与测试体共享同一组 spy
const pdfjsMock = vi.hoisted(() => {
  const getPage = vi.fn();
  const getOutline = vi.fn();
  const getDestination = vi.fn();
  const getPageIndex = vi.fn();
  return { getPage, getOutline, getDestination, getPageIndex };
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

/** 5 页文档，每页视口 600×800 */
function makePage() {
  return {
    getViewport: () => ({
      width: 600,
      height: 800,
      transform: [1, 0, 0, 1, 0, 0],
      convertToViewportRectangle: (r: [number, number, number, number]) => r,
    }),
    render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async () => ({ items: [] }),
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
  // jsdom 无 canvas 2d 后端：桩掉 getContext（组件只把它透传给 render）
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
});

afterEach(() => {
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
