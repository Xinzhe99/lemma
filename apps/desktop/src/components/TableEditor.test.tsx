// @vitest-environment jsdom
/**
 * 测试环境说明同 QuickOpen.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现，
 * 并 mock editorInsert 桥以控制插入成败。覆盖：初始 3×3 网格与实时预览、加/删行列、
 * 单元格转义、表头开关（首行后 \hline）、插入成功关/失败保持打开、Esc 关闭、复制。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  interface Listener {
    (state: unknown, prev: unknown): void;
  }
  function impl<S extends object>(init: (set: unknown, get: unknown) => S) {
    let state: S;
    const listeners = new Set<Listener>();
    const setState = (partial: Partial<S> | ((s: S) => Partial<S>)) => {
      const patch = typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial;
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    };
    const getState = () => state;
    const subscribe = (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    state = init(setState, getState);
    const useStore = <T,>(selector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => selector(state),
        () => selector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

vi.mock('../editorInsert', () => ({
  setInsertHandler: vi.fn(),
  insertAtCursor: vi.fn<(code: string) => boolean>(),
}));

import { TableEditor } from './TableEditor';
import { insertAtCursor } from '../editorInsert';

const insertMock = vi.mocked(insertAtCursor);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function cells(): HTMLInputElement[] {
  return [...container!.querySelectorAll<HTMLInputElement>('.sf-table-cell')];
}

function previewText(): string {
  return container!.querySelector('.sf-table-preview')!.textContent ?? '';
}

function buttonWithText(text: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('.sf-btn')].find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`button not found: ${text}`);
  return btn;
}

beforeEach(() => {
  insertMock.mockReset();
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TableEditor onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('TableEditor', () => {
  it('初始 3×3 网格 + 默认列规格，实时预览生成头尾 \\hline 的 tabular', () => {
    expect(cells()).toHaveLength(9);
    const spec = container!.querySelector<HTMLInputElement>('.sf-table-colspec')!;
    expect(spec.value).toBe('|c|c|c|');
    const lines = previewText().split('\n');
    expect(lines[0]).toBe('\\begin{tabular}{|c|c|c|}');
    expect(lines[1]).toBe('\\hline');
    expect(lines[5]).toBe('\\hline');
    expect(lines[6]).toBe('\\end{tabular}');
  });

  it('加行/加列/删行/删列 同步网格与预览', () => {
    click(buttonWithText('加行'));
    click(buttonWithText('加列'));
    expect(cells()).toHaveLength(16);
    expect(previewText().split('\n')).toHaveLength(8); // begin + hline + 4 行 + hline + end

    click(buttonWithText('删行'));
    click(buttonWithText('删列'));
    expect(cells()).toHaveLength(9);
  });

  it('删行/删列 在最小规模（1×1）下禁用', () => {
    // 删到 1×1
    click(buttonWithText('删行'));
    click(buttonWithText('删列'));
    click(buttonWithText('删行'));
    click(buttonWithText('删列'));
    expect(cells()).toHaveLength(1);
    expect((buttonWithText('删行') as HTMLButtonElement).disabled).toBe(true);
    expect((buttonWithText('删列') as HTMLButtonElement).disabled).toBe(true);
  });

  it('单元格输入特殊字符 → 预览经 escapeCell 转义', () => {
    type(cells()[0]!, '50%');
    type(cells()[1]!, 'a&b');
    expect(previewText()).toContain('50\\% & a\\&b');
  });

  it('表头行开关：首行数据后补一条 \\hline（共三条）', () => {
    expect(previewText().match(/\\hline/g)).toHaveLength(2);
    const toggle = container!.querySelector<HTMLInputElement>('.sf-table-header-toggle input')!;
    act(() => {
      toggle.click();
    });
    expect(previewText().match(/\\hline/g)).toHaveLength(3);
    const lines = previewText().split('\n');
    expect(lines[2]).toContain('\\\\'); // 首行数据
    expect(lines[3]).toBe('\\hline'); // 表头分隔
  });

  it('插入成功：insertAtCursor 收到预览代码并 onClose', () => {
    insertMock.mockReturnValue(true);
    click(buttonWithText('插入到光标处'));
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0]![0]).toBe(previewText());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('插入失败：提示原因并保持打开', () => {
    insertMock.mockReturnValue(false);
    click(buttonWithText('插入到光标处'));
    expect(onClose).not.toHaveBeenCalled();
    expect(container!.querySelector('.sf-table-hint')?.textContent).toContain('请先打开');
    expect(container!.querySelector('.sf-table-dialog')).toBeTruthy();
  });

  it('Esc 关闭对话框', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('复制代码：写入剪贴板并反馈「已复制」', async () => {
    const writeText = vi.fn<(t: string) => Promise<void>>().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    click(buttonWithText('复制代码'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(previewText());
    expect(buttonWithText('已复制')).toBeTruthy();
  });

  it('点击遮罩关闭', () => {
    act(() => {
      container!
        .querySelector('.sf-dialog-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
