// @vitest-environment jsdom
/**
 * 测试环境说明同 QuickOpen.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现，
 * 并 mock editorInsert 桥以控制插入成败。覆盖：初始 3×3 网格与实时预览、加/删行列、
 * 单元格转义、表头开关（首行后 \hline）、插入成功关/失败保持打开、Esc 关闭、复制，
 * 以及 CSV/Excel 导入：入口渲染、CSV 载入行列/列规格、首行表头开关联动、
 * xlsx 分流调用 parseXlsx、错误态中文提示（role=alert）、取消导入。
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

// @lemma/editor：gridToTabular/parseCsv 用真实实现（纯函数），
// parseXlsx 换可控 mock（xlsx 解析本身在 packages/editor 的单测覆盖）
vi.mock('@lemma/editor', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, parseXlsx: vi.fn<(data: ArrayBuffer) => string[][]>() };
});

import { TableEditor } from './TableEditor';
import { insertAtCursor } from '../editorInsert';
import { parseXlsx } from '@lemma/editor';

const insertMock = vi.mocked(insertAtCursor);
const parseXlsxMock = vi.mocked(parseXlsx);

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
  parseXlsxMock.mockReset();
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
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// CSV / Excel 导入
// ---------------------------------------------------------------------------

/**
 * jsdom 25 的 File 没有 arrayBuffer()：fixture 上补齐（组件按标准 Web API 调用，
 * 真实 WKWebView/浏览器均有该方法）。ReviewsImportDialog.test 同款手法。
 */
function fixtureFile(content: string | Uint8Array, name: string, type: string): File {
  const file = new File(
    [
      typeof content === 'string'
        ? content
        : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer),
    ],
    name,
    { type },
  );
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  Object.defineProperty(file, 'arrayBuffer', {
    value: async (): Promise<ArrayBuffer> =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    configurable: true,
  });
  return file;
}

/** 往隐藏 file input 塞文件并触发 change */
async function pickFile(file: File): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('hidden file input not found');
  const shaped = {} as { [index: number]: File; length: number; item: (i: number) => File | null };
  shaped[0] = file;
  shaped.length = 1;
  shaped.item = (i: number) => shaped[i] ?? null;
  Object.defineProperty(input, 'files', { value: shaped, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

describe('TableEditor：CSV/Excel 导入', () => {
  it('入口渲染：「导入 CSV/Excel」按钮 + 隐藏 file input（accept 限定四种扩展名）', () => {
    const btn = buttonWithText('导入 CSV/Excel');
    expect(btn.title).toContain('XLSX');
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input!.getAttribute('accept')).toBe('.csv,.tsv,.txt,.xlsx');
  });

  it('CSV 载入：确认预览显示 N 行 × M 列与前 5 行；替换网格载入 rows 并按列数生成列规格', async () => {
    await pickFile(fixtureFile('a,b\n1,2\n3,4\n', 'data.csv', 'text/csv'));
    const panel = container!.querySelector('.sf-table-import');
    expect(panel).toBeTruthy();
    expect(panel!.querySelector('.sf-table-import-summary')!.textContent).toContain('3 行 × 2 列');
    expect(panel!.querySelectorAll('.sf-table-import-grid td')).toHaveLength(6); // 前 5 行 → 全部 3 行
    expect([...panel!.querySelectorAll('.sf-table-import-grid td')].map((td) => td.textContent)).toEqual([
      'a', 'b', '1', '2', '3', '4',
    ]);

    click(buttonWithText('替换网格'));
    expect(cells()).toHaveLength(6); // 3 行 × 2 列替换原 3×3
    expect(cells()[0]!.value).toBe('a');
    expect(cells()[5]!.value).toBe('4');
    expect(container!.querySelector<HTMLInputElement>('.sf-table-colspec')!.value).toBe('|c|c|');
    expect(container!.querySelector('.sf-table-import')).toBeNull(); // 预览关闭
    expect(previewText()).toContain('a & b'); // 预览代码用导入数据
  });

  it('TSV 文件走 parseCsv 文本读（tab 探测生效）', async () => {
    await pickFile(fixtureFile('x\ty\n10\t20\n', 'data.tsv', 'text/tab-separated-values'));
    click(buttonWithText('替换网格'));
    expect(cells()).toHaveLength(4);
    expect(cells()[1]!.value).toBe('y');
  });

  it('首行表头开关联动：导入预览勾选 → 替换后既有表头开关开启、预览补 \\hline', async () => {
    await pickFile(fixtureFile('h1,h2\n5,6\n', 'h.csv', 'text/csv'));
    const box = container!.querySelector<HTMLInputElement>('.sf-table-import input[type="checkbox"]');
    expect(box!.checked).toBe(false); // 初值联动主开关（默认关）
    act(() => {
      box!.click();
    });
    click(buttonWithText('替换网格'));
    const mainToggle = container!.querySelector<HTMLInputElement>('.sf-table-toolbar .sf-table-header-toggle input');
    expect(mainToggle!.checked).toBe(true);
    expect(previewText().match(/\\hline/g)).toHaveLength(3); // 头 + 表头分隔 + 尾
  });

  it('xlsx 分流：parseXlsx 收到 ArrayBuffer，返回网格载入', async () => {
    parseXlsxMock.mockReturnValue([
      ['X', 'Y'],
      ['1', '2'],
    ]);
    await pickFile(fixtureFile(new Uint8Array([1, 2, 3]), 'book.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
    expect(parseXlsxMock).toHaveBeenCalledTimes(1);
    const arg = parseXlsxMock.mock.calls[0]![0];
    expect(arg).toBeInstanceOf(ArrayBuffer);
    click(buttonWithText('替换网格'));
    expect(cells()).toHaveLength(4);
    expect(cells()[0]!.value).toBe('X');
  });

  it('错误态：解析抛错 → role=alert 中文提示，网格保持不变', async () => {
    parseXlsxMock.mockImplementation(() => {
      throw new Error('无法解析该文件：不是有效的 .xlsx（Excel 工作簿）文件');
    });
    await pickFile(fixtureFile('plain text', 'bad.xlsx', 'application/octet-stream'));
    const alert = container!.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('不是有效的 .xlsx');
    expect(cells()).toHaveLength(9); // 原 3×3 未动
    expect(container!.querySelector('.sf-table-import')).toBeNull();
  });

  it('取消导入：预览关闭且网格不受影响', async () => {
    await pickFile(fixtureFile('a,b\n1,2\n', 'data.csv', 'text/csv'));
    click(buttonWithText('取消导入'));
    expect(container!.querySelector('.sf-table-import')).toBeNull();
    expect(cells()).toHaveLength(9);
    const first = cells()[0]!.value;
    expect(first).toBe(''); // 未载入任何数据
  });
});
