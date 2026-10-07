// @vitest-environment jsdom
/**
 * PdfReader 全文搜索竞态回归（cancelled 守卫）：
 * 逐页文本抽取是异步的（防抖 300ms + 逐页 getTextContent），期间换查询或换文档
 * （重新编译产出新 PDF）时，过期结果必须丢弃——否则旧文档的命中会盖在新文档上，
 * 页码指向错误内容。pdfjs 以 mock 注入（手法同 PdfReader.test.tsx）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfReader, type PdfReaderProps } from './PdfReader';

const pdfjsMock = vi.hoisted(() => {
  /** 第一份文档的首页 textContent 挂起，由用例手动放行（模拟慢抽取） */
  let releaseFirstDoc: (() => void) | null = null;
  const firstDocText = new Promise<{ items: Array<{ str: string }> }>(resolve => {
    releaseFirstDoc = () => resolve({ items: [{ str: 'alpha alpha' }] });
  });
  let docCount = 0;
  return {
    getDocument: () => {
      docCount += 1;
      const first = docCount === 1;
      return {
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getViewport: () => ({
              width: 600,
              height: 800,
              transform: [1, 0, 0, 1, 0, 0],
              convertToPdfPoint: (x: number, y: number) => ({ x, y }),
              convertToViewportRectangle: (r: number[]) => r,
            }),
            render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
            getTextContent: () =>
              first ? firstDocText : Promise.resolve({ items: [{ str: 'beta' }] }),
            cleanup: () => {},
          }),
          getOutline: async () => [],
          destroy: async () => {},
        }),
      };
    },
    releaseFirstDoc: () => releaseFirstDoc?.(),
  };
});

vi.mock('pdfjs-dist', () => ({ getDocument: () => pdfjsMock.getDocument() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

async function flushLoad(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

const searchBox = (): HTMLInputElement =>
  container!.querySelector('input[aria-label="搜索全文"]') as HTMLInputElement;

function typeQuery(value: string): void {
  const input = searchBox();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D);
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

describe('PdfReader 全文搜索：异步抽取的过期结果', () => {
  it('抽取期间换文档（重新编译）：旧文档的命中被丢弃，缓存不污染新文档', async () => {
    renderReader();
    await flushLoad();
    vi.useFakeTimers();
    typeQuery('alpha');
    // 防抖到期 → 旧文档首页抽取挂起（firstDocText 未放行）
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await flushMicrotasks();

    // 重新编译：换 data → 新文档对象（首页文本为 beta）
    act(() => {
      root!.render(<PdfReader {...baseProps!} data={new ArrayBuffer(8)} />);
    });
    await flushMicrotasks();

    // 旧文档的抽取此刻才返回 “alpha”：命中计数与页码不得出现（结果被丢弃）
    act(() => {
      pdfjsMock.releaseFirstDoc();
    });
    await flushMicrotasks();
    expect(container!.textContent).not.toMatch(/\d+\/\d+ · p\./);
    expect(container!.textContent).not.toContain('alpha');

    // 新文档自身的结果照常生效（beta 无 alpha 命中 → 显示“无命中”）
    act(() => {
      vi.advanceTimersByTime(300);
    });
    await flushMicrotasks();
    expect(container!.textContent).toContain('无命中');
  });
});
