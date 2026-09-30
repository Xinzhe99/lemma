// @vitest-environment jsdom
/**
 * 测试环境说明同 FileTree.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现。
 * 覆盖验收路径：Ctrl+P 判定 → 输入 "intro" → Enter → openTabs 含 sections/intro.tex。
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

import { QuickOpen, isQuickOpenTrigger } from './QuickOpen';
import { useWorkspaceStore } from '../state/workspaceStore';

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

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  });
}

function items(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-quickopen-item')];
}

beforeEach(() => {
  useWorkspaceStore.getState().loadDemoProject();
  useWorkspaceStore.setState({ openTabs: ['main.tex'], activeTab: 'main.tex' });
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<QuickOpen onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('QuickOpen', () => {
  it('isQuickOpenTrigger：Ctrl/Cmd+P 命中，其他键不命中', () => {
    expect(isQuickOpenTrigger({ ctrlKey: true, key: 'p' })).toBe(true);
    expect(isQuickOpenTrigger({ metaKey: true, key: 'P' })).toBe(true);
    expect(isQuickOpenTrigger({ ctrlKey: true, key: 'k' })).toBe(false);
    expect(isQuickOpenTrigger({ key: 'p' })).toBe(false);
  });

  it('验收路径：输入 intro → Enter 后 openTabs 含 sections/intro.tex', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-quickopen-input')!;
    expect(document.activeElement).toBe(input); // 打开即聚焦

    type(input, 'intro');
    const matched = items();
    expect(matched).toHaveLength(1);
    expect(matched[0]!.textContent).toContain('sections/intro.tex');
    expect(matched[0]!.classList.contains('active')).toBe(true);

    pressKey('Enter');
    const s = useWorkspaceStore.getState();
    expect(s.openTabs).toContain('sections/intro.tex');
    expect(s.activeTab).toBe('sections/intro.tex');
    expect(onClose).toHaveBeenCalled();
  });

  it('空 query 列出全部文件；↑↓ 导航循环受边界约束；Esc/遮罩点击关闭', () => {
    expect(items().length).toBe(Object.keys(useWorkspaceStore.getState().files).length);

    pressKey('ArrowDown');
    expect(items()[0]!.classList.contains('active')).toBe(false);
    expect(items()[1]!.classList.contains('active')).toBe(true);

    pressKey('ArrowUp');
    pressKey('ArrowUp'); // 已在顶部，不下越界
    expect(items()[0]!.classList.contains('active')).toBe(true);

    pressKey('Escape');
    expect(onClose).toHaveBeenCalled();
  });

  it('无匹配时渲染空态；点击列表项打开文件', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-quickopen-input')!;
    type(input, 'zzz-no-such-file');
    expect(container!.querySelector('.sf-quickopen-empty')).toBeTruthy();
    expect(items()).toHaveLength(0);

    type(input, 'refs');
    act(() => {
      items()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(useWorkspaceStore.getState().activeTab).toBe('refs.bib');
    expect(onClose).toHaveBeenCalled();
  });
});
