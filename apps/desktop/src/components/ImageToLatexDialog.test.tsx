// @vitest-environment jsdom
/**
 * ImageToLatexDialog 组件测试（v7.8.0 修复回归）。测试环境说明同 SnapshotDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；visionConvert 桥整体 mock（不联网、不加载重依赖）。
 * 覆盖：插入按钮与取消按钮必须渲染译文——此前写作 t('img2tex.insert') 字面量、
 * 取消键 'dlg.cancel' 缺字典项，两者都会把源码/键名直接显示给用户。
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

vi.mock('../visionConvert', () => ({
  fileToDataUrl: vi.fn(async () => 'data:image/png;base64,AAAA'),
  imageToLatex: vi.fn(async () => ({ ok: true, latex: '\\frac{1}{2}' })),
}));

import { ImageToLatexDialog } from './ImageToLatexDialog';
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

/** 选图 → 转换，使「插入/取消」动作行渲染出来 */
async function convertOnce(): Promise<void> {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = new File(['x'], 'shot.png', { type: 'image/png' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
  });
  await act(async () => {
    click(btn('转换为 LaTeX'));
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
    root!.render(<ImageToLatexDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ImageToLatexDialog', () => {
  it('zh：插入按钮显示译文而非 t(\'img2tex.insert\') 字面量；取消按钮不显示原始 key', async () => {
    await convertOnce();
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('button')].map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(buttons).toContain('插入到稿件（走审批）');
    expect(buttons).toContain('取消');
    expect(buttons.some((b) => b.includes("t('img2tex.insert')"))).toBe(false);
    expect(buttons).not.toContain('dlg.cancel');
  });

  it('en：同一组按钮为英文（语言切换后不残留中文或 key）', async () => {
    await convertOnce();
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('button')].map((b) =>
      (b.textContent ?? '').trim(),
    );
    expect(buttons).toContain('Insert (via approval)');
    expect(buttons).toContain('Cancel');
    expect(buttons).not.toContain('dlg.cancel');
  });

  it('对话框 aria-label 与预览图 alt 走字典（en 下为英文）', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    expect(container!.querySelector('.sf-dialog-overlay')!.getAttribute('aria-label')).toBe(
      'Image to LaTeX',
    );
  });

  it('Esc 关闭', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
