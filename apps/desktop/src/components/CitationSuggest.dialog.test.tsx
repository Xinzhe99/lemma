// @vitest-environment jsdom
/**
 * CitationSuggest 对话框交互测试（v7.8.0 修复回归）：Esc 关闭。
 * 此前该浮层只支持「关闭」按钮与点击遮罩，与其余对话框（Settings/QuickCite 等）不一致。
 * 测试环境说明同 SnapshotDialog.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现。
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
    const useStore = <T,>(sSelector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => sSelector(state),
        () => sSelector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

import { CitationSuggest } from './CitationSuggest';
import { useLibraryStore } from '../state/libraryStore';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onClose = vi.fn();
  act(() => {
    useSettingsStore.setState({ language: 'zh' });
    useLibraryStore.setState({ papers: [] });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CitationSuggest onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('CitationSuggest', () => {
  it('Esc 关闭', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('点击「关闭」与遮罩同样关闭（不回归）', () => {
    act(() => {
      (container!.querySelector('.sf-lib-dialog-actions button') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      container!
        .querySelector('.sf-dialog-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
