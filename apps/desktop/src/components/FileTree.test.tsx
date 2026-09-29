// @vitest-environment jsdom
/**
 * 测试环境说明：仓库同时存在 react@18（apps/desktop 嵌套）与 react@19（根提升），
 * vitest 的 Node 解析会把根下的 zustand / lucide-react 连到 react@19，与 apps/desktop 的
 * react@18 混渲染即崩溃；而根 vitest/vite 配置与依赖树均不可改动。
 * 故本文件 mock 这两个模块为「仅依赖本包 react@18」的等价实现——
 * 语义与真实 zustand/lucide 一致（store 动作即真实 workspaceStore 逻辑），仅替换绑定层。
 * 生产构建不受影响（vite 产物已验证只含单份 react@18）。
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
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderTree() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<FileTree />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function row(path: string): HTMLElement {
  const el = container?.querySelector<HTMLElement>(`[data-path="${path}"]`) ?? null;
  expect(el, `缺少树节点: ${path}`).toBeTruthy();
  return el!;
}

beforeEach(() => {
  useWorkspaceStore.getState().loadDemoProject();
  useWorkspaceStore.setState({ openTabs: [], activeTab: null });
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

  it('⋯ 菜单重命名：经 prompt 更新文件路径与标签', () => {
    renderTree();
    act(() => {
      useWorkspaceStore.getState().openFile('sections/intro.tex');
    });

    click(row('sections/intro.tex').querySelector('.sf-tree-menu-btn')!);

    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('sections/introduction.tex');
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="rename"]')!);
    expect(promptSpy).toHaveBeenCalled();

    const s = useWorkspaceStore.getState();
    expect(s.files['sections/introduction.tex']).toBeTruthy();
    expect(s.files['sections/intro.tex']).toBeUndefined();
    expect(s.openTabs).toContain('sections/introduction.tex');
    expect(s.activeTab).toBe('sections/introduction.tex');
  });

  it('⋯ 菜单删除：经 confirm 删除文件', () => {
    renderTree();

    click(row('README.md').querySelector('.sf-tree-menu-btn')!);

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    click(document.querySelector('.sf-tree-menu .sf-menu-item[data-action="delete"]')!);
    expect(confirmSpy).toHaveBeenCalled();

    expect(useWorkspaceStore.getState().files['README.md']).toBeUndefined();
  });
});
