// @vitest-environment jsdom
/**
 * TikzFigureDialog 组件测试（v7.8.0 修复回归）。测试环境说明同 SnapshotDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；agentTools / aiActions 桥 mock（不联网）。
 * 覆盖：插入按钮此前写作 t('tikz.insert') 字面量、取消键 'dlg.cancel' 缺字典项——
 * 两者都会把源码/键名直接显示给用户；同时覆盖 Esc 关闭与 en 文案。
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

vi.mock('../aiActions', () => ({
  resolveProvider: () => ({ real: true, provider: 'demo', model: 'demo-model' }),
}));

vi.mock('../agentTools', () => ({
  runAgentTurn: vi.fn(async () => '\\begin{tikzpicture}\\draw (0,0) -- (1,1);\\end{tikzpicture}'),
}));

import { TikzFigureDialog } from './TikzFigureDialog';
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

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    (b.textContent ?? '').includes(text),
  );
  if (!found) throw new Error(`未找到按钮：${text}`);
  return found;
}

function buttonLabels(): string[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('button')].map((b) =>
    (b.textContent ?? '').trim(),
  );
}

/** 填描述 → 生成，使「插入到稿件」按钮渲染出来 */
async function generateOnce(): Promise<void> {
  const textarea = container!.querySelector<HTMLTextAreaElement>('textarea')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value',
    )!.set!;
    setter.call(textarea, '三阶段 pipeline');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    click(btn('生成 TikZ'));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  onClose = vi.fn();
  act(() => {
    useSettingsStore.setState({ language: 'zh' });
    useWorkspaceStore.setState({ files: { 'main.tex': 'hello' }, activeTab: 'main.tex' });
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TikzFigureDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('TikzFigureDialog', () => {
  it('zh：插入按钮显示译文而非 t(\'tikz.insert\') 字面量；取消按钮不显示原始 key', async () => {
    await generateOnce();
    expect(buttonLabels()).toContain('插入到稿件（走审批）');
    expect(buttonLabels()).toContain('取消');
    expect(buttonLabels().some((b) => b.includes("t('tikz.insert')"))).toBe(false);
    expect(buttonLabels()).not.toContain('dlg.cancel');
  });

  it('en：同一组按钮为英文', async () => {
    await generateOnce();
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    expect(buttonLabels()).toContain('Insert (via approval)');
    expect(buttonLabels()).toContain('Cancel');
  });

  it('Esc 关闭', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
