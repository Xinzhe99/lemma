// @vitest-environment jsdom
/**
 * StyleReportDialog 测试：测试环境说明同 ShortcutsDialog.test.tsx（mock zustand 为
 * 仅依赖本包 react@18 的等价实现）。覆盖：指标卡渲染（句数/被动占比/FK 着色）、
 * 长句清单与跳转按钮（jumpTo mock）、空工程 / 无正文空态、Esc 关闭。
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
      useSyncExternalStore(subscribe, () => selector(state), () => selector(state));
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

const jumpTo = vi.fn();
vi.mock('../editorJump', () => ({ jumpTo: (...a: unknown[]) => jumpTo(...a) }));

import { StyleReportDialog } from './StyleReportDialog';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LONG = Array.from({ length: 42 }, (_, i) => `word${i}`).join(' ');

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function render(): void {
  act(() => {
    root!.render(<StyleReportDialog onClose={onClose} />);
  });
}

beforeEach(() => {
  onClose = vi.fn();
  jumpTo.mockClear();
  useSettingsStore.setState({ language: 'zh' });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('StyleReportDialog', () => {
  it('渲染指标卡与长句清单；长句跳转按钮触发 jumpTo 并关闭', () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': `The model is trained on ImageNet.\n${LONG}.\nMore text here.` },
      activeTab: 'main.tex',
    });
    render();
    const text = container!.textContent ?? '';
    expect(text).toContain('风格分析报告');
    expect(text).toContain('句子');
    expect(text).toContain('被动语态');
    expect(text).toContain('可读性');
    const jump = [...container!.querySelectorAll('button')].find((b) => (b.textContent ?? '').startsWith('跳转:'));
    expect(jump).toBeTruthy();
    act(() => {
      jump!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(jumpTo).toHaveBeenCalledWith({ file: 'main.tex', line: expect.any(Number) });
    expect(onClose).toHaveBeenCalled();
  });

  it('无 .tex 文件 → 空态提示，不渲染指标', () => {
    useWorkspaceStore.setState({ files: {}, activeTab: null });
    render();
    expect(container!.textContent).toContain('没有 .tex 文件');
    expect(container!.textContent).not.toContain('被动语态占比');
  });

  it('文件无正文 → 空态提示', () => {
    useWorkspaceStore.setState({ files: { 'a.tex': '\\cite{x}\\ref{y}' }, activeTab: 'a.tex' });
    render();
    expect(container!.textContent).toContain('没有可分析的正文');
  });

  it('Esc 关闭', () => {
    useWorkspaceStore.setState({ files: { 'a.tex': 'Text here.' }, activeTab: 'a.tex' });
    render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
