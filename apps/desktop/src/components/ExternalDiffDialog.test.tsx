// @vitest-environment jsdom
/**
 * ExternalDiffDialog 组件测试。测试环境说明同 SnapshotDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；DiffView 使用真实实现（diff 包）。
 * 覆盖：三态渲染与统计 chip、匹配文件点击切换 diff、采纳外部版本（snapshotFile 先于
 * updateFile 的调用顺序 + 内容落库）、仅查看、仅外部「添加为新文件」（createFile）、
 * 粘贴 tab 对比、非 .tex 报错、全部处理完结果摘要、zh/en 与 Esc 关闭。
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
    typeof init === 'function'
      ? impl(init as never)
      : (curried: unknown) => impl(curried as never);
  return { create };
});

import { ExternalDiffDialog } from './ExternalDiffDialog';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function findButton(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  expect(btn, `未找到「${label}」按钮`).toBeDefined();
  return btn!;
}

function statsChip(): string {
  return container!.querySelector<HTMLElement>('.sf-extdiff-stats')?.textContent ?? '';
}

/** jsdom 25 的 File 没有 arrayBuffer()：fixture 上补齐（ReviewsImportDialog.test 同款） */
function texFile(name: string, content: string): File {
  const bytes = new TextEncoder().encode(content);
  const file = new File(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    name,
    { type: 'text/x-tex' },
  );
  Object.defineProperty(file, 'arrayBuffer', {
    value: async (): Promise<ArrayBuffer> =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    configurable: true,
  });
  return file;
}

/** 往隐藏 file input 塞文件并触发 change */
async function pickFiles(files: File[]): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');
  const shaped = {} as { [index: number]: File; length: number; item: (i: number) => File | null };
  files.forEach((f, i) => {
    shaped[i] = f;
  });
  shaped.length = files.length;
  shaped.item = (i) => shaped[i] ?? null;
  Object.defineProperty(input, 'files', { value: shaped, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function typeInto(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const LOCAL_FILES = {
  'main.tex': '\\section{引言}\n当前稿引言。\n',
  'sections/intro.tex': '\\section{引言}\n本地引言。\n',
  'sections/method.tex': '\\section{方法}\n本地方法。\n',
  'refs.bib': '@misc{a, title={A}, year={2026}}',
  'README.md': '# demo',
};

beforeEach(() => {
  onClose = vi.fn();
  useSettingsStore.setState({ language: 'zh' });
  useWorkspaceStore.setState({
    projectName: 'demo',
    entry: 'main.tex',
    files: { ...LOCAL_FILES },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ExternalDiffDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ExternalDiffDialog · 三态渲染与切换', () => {
  it('同名精确 + basename 匹配：统计 chip「N 匹配 · M 新增」，仅外部可新增、仅本地仅展示', async () => {
    await pickFiles([
      texFile('main.tex', '\\section{引言}\n导师版引言。\n'),
      texFile('method.tex', '\\section{方法}\n导师版方法。\n'),
      texFile('advisor-new.tex', '\\section{新增}\n导师新文件。\n'),
    ]);
    expect(statsChip()).toBe('2 匹配 · 1 新增');
    // 匹配列表含两个文件；仅外区含添加按钮；仅本地一行展示剩余文件
    expect(container!.textContent).toContain('sections/method.tex');
    expect(findButton('添加为新文件').textContent).toBe('添加为新文件');
    expect(container!.textContent).toContain('仅本地（未参与对比）');
    expect(container!.textContent).toContain('sections/intro.tex');
    expect(container!.textContent).toContain('refs.bib');
  });

  it('点击匹配文件切换 → DiffView 以本地版本为 before、外部为 after，展示文件名', async () => {
    await pickFiles([
      texFile('main.tex', '\\section{引言}\n导师改写后的引言。\n'),
      texFile('method.tex', '\\section{方法}\n导师版方法。\n'),
    ]);
    click(findButton('main.tex'));
    let diff = container!.querySelector<HTMLElement>('.sf-diff');
    expect(diff).toBeTruthy();
    expect(diff!.textContent).toContain('main.tex');
    expect(diff!.textContent).toContain('导师改写后的引言。');

    click(findButton('sections/method.tex'));
    diff = container!.querySelector<HTMLElement>('.sf-diff');
    expect(diff!.textContent).toContain('sections/method.tex');
    expect(diff!.textContent).toContain('导师版方法。');
  });

  it('未选中匹配文件时显示占位提示（无匹配也不渲染 DiffView）', async () => {
    await pickFiles([texFile('advisor-only.tex', '新文件')]);
    expect(statsChip()).toBe('0 匹配 · 1 新增');
    expect(container!.querySelector('.sf-diff')).toBeNull();
    expect(container!.textContent).toContain('选择左侧匹配文件查看差异');
  });
});

describe('ExternalDiffDialog · 采纳与仅查看', () => {
  it('采纳外部版本：先 snapshotFile 再 updateFile（顺序断言），内容落库并标记已采纳', async () => {
    await pickFiles([texFile('main.tex', '\\section{引言}\n导师版引言。\n')]);
    click(findButton('main.tex'));
    const ws = useWorkspaceStore.getState();
    const snapSpy = vi.spyOn(ws, 'snapshotFile');
    const updateSpy = vi.spyOn(ws, 'updateFile');
    click(findButton('采纳外部版本'));
    expect(snapSpy).toHaveBeenCalledTimes(1);
    expect(snapSpy.mock.calls[0]![0]).toBe('main.tex');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0]).toEqual(['main.tex', '\\section{引言}\n导师版引言。\n']);
    // 顺序：快照先于覆盖
    expect(snapSpy.mock.invocationCallOrder[0]).toBeLessThan(updateSpy.mock.invocationCallOrder[0]);
    // store 实际生效：文件内容更新 + 快照入列
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('\\section{引言}\n导师版引言。\n');
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
    expect(container!.textContent).toContain('已采纳');
    snapSpy.mockRestore();
    updateSpy.mockRestore();
  });

  it('仅查看：内容不变、标记已查看、与采纳计入不同摘要项', async () => {
    await pickFiles([texFile('main.tex', '\\section{引言}\n导师版引言。\n')]);
    click(findButton('main.tex'));
    click(findButton('仅查看'));
    expect(useWorkspaceStore.getState().files['main.tex']).toBe(LOCAL_FILES['main.tex']);
    expect(container!.textContent).toContain('已查看');
  });
});

describe('ExternalDiffDialog · 仅外部新增', () => {
  it('添加为新文件：createFile 以外部文件名与内容入库，标记已新增', async () => {
    await pickFiles([texFile('advisor-new.tex', '\\section{新增}\n导师新文件。\n')]);
    const ws = useWorkspaceStore.getState();
    const createSpy = vi.spyOn(ws, 'createFile');
    click(findButton('添加为新文件'));
    expect(createSpy).toHaveBeenCalledWith('advisor-new.tex', '\\section{新增}\n导师新文件。\n');
    expect(useWorkspaceStore.getState().files['advisor-new.tex']).toBe('\\section{新增}\n导师新文件。\n');
    expect(container!.textContent).toContain('已新增');
    createSpy.mockRestore();
  });

  it('全部处理完显示结果摘要（采纳 / 仅查看 / 新增 计数）', async () => {
    await pickFiles([
      texFile('main.tex', '\\section{引言}\n导师版引言。\n'),
      texFile('advisor-new.tex', '\\section{新增}\n导师新文件。\n'),
    ]);
    click(findButton('main.tex'));
    click(findButton('采纳外部版本'));
    click(findButton('添加为新文件'));
    const status = container!.querySelector<HTMLElement>('[role="status"]');
    expect(status).toBeTruthy();
    expect(status!.textContent).toBe('已全部处理：采纳 1 · 仅查看 0 · 新增 1');
  });
});

describe('ExternalDiffDialog · 输入与关闭', () => {
  it('粘贴 tab：文件名 + 内容 → 对比当前工作区（同名精确匹配）', async () => {
    click(findButton('粘贴单个文件'));
    const inputs = container!.querySelectorAll<HTMLInputElement>('input.sf-input');
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    expect(inputs.length).toBe(1);
    await typeInto(inputs[0]!, 'sections/intro.tex');
    await typeInto(area!, '\\section{引言}\n导师改过的引言。\n');
    click(findButton('对比当前工作区'));
    expect(statsChip()).toBe('1 匹配 · 0 新增');
    click(findButton('sections/intro.tex'));
    const diff = container!.querySelector<HTMLElement>('.sf-diff');
    expect(diff!.textContent).toContain('导师改过的引言。');
  });

  it('非 .tex 文件给出提示且不产生对比结果', async () => {
    await pickFiles([texFile('notes.txt', 'not tex')]);
    expect((container!.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      '不支持的格式',
    );
    expect(statsChip()).toBe('');
    expect(container!.querySelector('.sf-diff')).toBeNull();
  });

  it('en 语言渲染英文文案；Esc 与关闭按钮触发 onClose', async () => {
    await act(async () => {
      useSettingsStore.setState({ language: 'en' });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(container!.textContent).toContain('Compare external version');
    click(findButton('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
