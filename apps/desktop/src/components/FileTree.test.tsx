// @vitest-environment jsdom
/**
 * 测试环境说明：仓库同时存在 react@18（apps/desktop 嵌套）与 react@19（根提升），
 * vitest 的 Node 解析会把根下的 zustand / lucide-react 连到 react@19，与 apps/desktop 的
 * react@18 混渲染即崩溃；而根 vitest/vite 配置与依赖树均不可改动。
 * 故本文件 mock 这两个模块为「仅依赖本包 react@18」的等价实现——
 * 语义与真实 zustand/lucide 一致（store 动作即真实 workspaceStore 逻辑），仅替换绑定层。
 * 生产构建不受影响（vite 产物已验证只含单份 react@18）。
 *
 * 对话框流程测试：FileTree 的新建/重命名/删除均经 uiStore.openTextDialog 打开应用内
 * 文本对话框（与 App 相同的挂载方式：textDialog 非空时渲染 TextDialog），输入→确认后
 * resolve 回 FileTree 的 Promise 继续执行。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('lucide-react', () => {
  const shim = (_props: { size?: number }) => null;
  const icons: Record<string, unknown> = {};
  for (const name of [
    'BookMarked',
    'ChevronDown',
    'ChevronRight',
    'File',
    'FileCode',
    'FileImage',
    'FileText',
    'Folder',
    'FolderOpen',
    'MoreHorizontal',
    'Pencil',
    'Plus',
    'Trash2',
  ]) {
    icons[name] = shim;
  }
  return icons;
});

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

import { FileTree } from './FileTree';
import { TextDialog } from './TextDialog';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 与 App 一致的挂载方式：FileTree + 按需挂载的应用内文本对话框 */
function Workbench() {
  const textDialog = useUiStore((s) => s.textDialog);
  return (
    <>
      <FileTree />
      {textDialog && <TextDialog onClose={() => useUiStore.getState().closeTextDialog()} />}
    </>
  );
}

function renderTree() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Workbench />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

/** 点击后 flush 微任务：确认对话框会 resolve 触发 FileTree 的异步后续（创建/重命名/删除） */
async function clickAsync(el: Element) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function row(path: string): HTMLElement {
  const el = container?.querySelector<HTMLElement>(`[data-path="${path}"]`) ?? null;
  expect(el, `缺少树节点: ${path}`).toBeTruthy();
  return el!;
}

function dialogInput(): HTMLInputElement {
  const input = container?.querySelector<HTMLInputElement>('.sf-dialog .sf-input') ?? null;
  expect(input, '对话框输入框未出现').toBeTruthy();
  return input!;
}

function dialogButton(action: 'confirm' | 'cancel'): HTMLButtonElement {
  const btn = container?.querySelector<HTMLButtonElement>(`.sf-dialog [data-action="${action}"]`) ?? null;
  expect(btn, `对话框按钮缺失: ${action}`).toBeTruthy();
  return btn!;
}

beforeEach(() => {
  useWorkspaceStore.getState().loadDemoProject();
  useWorkspaceStore.setState({ openTabs: [], activeTab: null });
  useUiStore.getState().closeTextDialog();
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('FileTree', () => {
  it('按目录结构渲染文件，点击文件触发 openFile', () => {
    renderTree();

    // 顶层文件与嵌套文件都在
    row('main.tex');
    row('sections/intro.tex');
    row('refs.bib');

    click(row('sections/intro.tex'));
    const s = useWorkspaceStore.getState();
    expect(s.openTabs).toContain('sections/intro.tex');
    expect(s.activeTab).toBe('sections/intro.tex');
    expect(row('sections/intro.tex').classList.contains('active')).toBe(true);
  });

  it('文件夹可折叠：折叠后子文件消失，再展开恢复', () => {
    renderTree();
    expect(container!.querySelector('[data-path="sections/intro.tex"]')).toBeTruthy();

    click(row('sections'));
    expect(container!.querySelector('[data-path="sections/intro.tex"]')).toBeNull();

    click(row('sections'));
    expect(container!.querySelector('[data-path="sections/intro.tex"]')).toBeTruthy();
  });

  it('工具栏「新建文件」：打开应用内对话框，输入路径确认后创建空文件', async () => {
    renderTree();

    await clickAsync(container!.querySelector<HTMLButtonElement>('.sf-tree-new')!);
    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('prompt');
    expect(req?.title).toContain('新建文件');

    type(dialogInput(), 'notes/todo.tex');
    await clickAsync(dialogButton('confirm'));

    expect(useUiStore.getState().textDialog).toBeNull();
    expect(useWorkspaceStore.getState().files['notes/todo.tex']).toBe('');
  });

  it('新建文件：对话框取消（Esc 语义 = resolve null）不创建', async () => {
    renderTree();

    await clickAsync(container!.querySelector<HTMLButtonElement>('.sf-tree-new')!);
    useUiStore.getState().textDialog!.resolve(null);
    await act(async () => {
      await Promise.resolve();
    });

    expect(useWorkspaceStore.getState().files['notes/todo.tex']).toBeUndefined();
  });

  it('⋯ 菜单重命名：经应用内对话框输入新路径，更新文件路径与标签', async () => {
    renderTree();
    act(() => {
      useWorkspaceStore.getState().openFile('sections/intro.tex');
    });

    click(row('sections/intro.tex').querySelector('.sf-tree-menu-btn')!);
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="rename"]')!);

    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('prompt');
    expect(req?.initial).toBe('sections/intro.tex');
    expect(dialogInput().value).toBe('sections/intro.tex');

    type(dialogInput(), 'sections/introduction.tex');
    await clickAsync(dialogButton('confirm'));

    const s = useWorkspaceStore.getState();
    expect(s.files['sections/introduction.tex']).toBeTruthy();
    expect(s.files['sections/intro.tex']).toBeUndefined();
    expect(s.openTabs).toContain('sections/introduction.tex');
    expect(s.activeTab).toBe('sections/introduction.tex');
  });

  it('⋯ 菜单重命名：清空输入（等价取消）不改动', async () => {
    renderTree();

    click(row('refs.bib').querySelector('.sf-tree-menu-btn')!);
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="rename"]')!);

    type(dialogInput(), '   ');
    await clickAsync(dialogButton('confirm'));

    expect(useWorkspaceStore.getState().files['refs.bib']).toBeTruthy();
    expect(useUiStore.getState().textDialog).toBeNull();
  });

  it('⋯ 菜单删除：经应用内确认对话框确认后删除；取消则保留', async () => {
    renderTree();

    click(row('README.md').querySelector('.sf-tree-menu-btn')!);
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="delete"]')!);

    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('confirm');
    expect(req?.title).toContain('README.md');

    // 取消：文件保留
    await clickAsync(dialogButton('cancel'));
    expect(useWorkspaceStore.getState().files['README.md']).toBeTruthy();

    // 再开一次并确认：文件删除
    click(row('README.md').querySelector('.sf-tree-menu-btn')!);
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="delete"]')!);
    await clickAsync(dialogButton('confirm'));
    expect(useWorkspaceStore.getState().files['README.md']).toBeUndefined();
  });
});
