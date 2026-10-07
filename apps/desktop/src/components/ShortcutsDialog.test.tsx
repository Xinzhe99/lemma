// @vitest-environment jsdom
/**
 * 测试环境说明同 FileTree.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现。
 * 覆盖：分组渲染（全局/编辑/工作流/编译 + 真实 kbd）、触发判定、Esc 关闭。
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

import { ShortcutsDialog, isShortcutsTrigger } from './ShortcutsDialog';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

beforeEach(() => {
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ShortcutsDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ShortcutsDialog', () => {
  it('isShortcutsTrigger：Ctrl+/ 或裸 ?（输入目标内不触发）', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const div = document.createElement('div');
    const editable = document.createElement('div');
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isShortcutsTrigger({ ctrlKey: true, key: '/' }, div)).toBe(true);
    expect(isShortcutsTrigger({ metaKey: true, key: '/' }, null)).toBe(true);
    expect(isShortcutsTrigger({ key: '?' }, div)).toBe(true);
    expect(isShortcutsTrigger({ key: '?' }, input)).toBe(false);
    expect(isShortcutsTrigger({ key: '?' }, textarea)).toBe(false);
    expect(isShortcutsTrigger({ key: '?' }, editable)).toBe(false);
    expect(isShortcutsTrigger({ ctrlKey: true, key: 'p' }, div)).toBe(false);
  });

  it('按 全局/编辑/工作流/编译 分组渲染真实 kbd 约定', () => {
    const groups = [...container!.querySelectorAll('.sf-shortcuts-group')].map((g) => g.textContent);
    expect(groups).toEqual(['全局', '编辑', '工作流', '编译']);
    for (const kbd of ['⌘K / Ctrl+K', 'Ctrl+P', 'Ctrl+/', 'Ctrl+Enter', 'Ctrl+H']) {
      const el = [...container!.querySelectorAll('kbd')].find((k) => k.textContent === kbd);
      expect(el, `缺少 kbd: ${kbd}`).toBeTruthy();
    }
    expect(container!.querySelector('.sf-shortcuts-grid kbd')).toBeTruthy();
  });

  it('Esc 关闭（preventDefault 后回调 onClose）', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('en 列表无中文残留，且与 zh 逐组条目数一致（Ctrl+S 行不再只出现在 en）', () => {
    const zhRows = [...container!.querySelectorAll('.sf-shortcuts-desc')].map((d) => d.textContent!);
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    const enGroups = [...container!.querySelectorAll('.sf-shortcuts-group')].map((g) => g.textContent);
    expect(enGroups).toEqual(['Global', 'Editor', 'Workflow', 'Compile']);

    const enRows = [...container!.querySelectorAll('.sf-shortcuts-desc')].map((d) => d.textContent!);
    expect(enRows.length).toBe(zhRows.length);
    // en 列表里不能出现中文（历史缺陷：Global 组残留「立即编译（保存并编译）」）
    expect(enRows.filter((d) => /[\u4e00-\u9fff]/.test(d))).toEqual([]);
    expect(enRows).toContain('Save & compile');
    expect(zhRows).toContain('保存并编译');
  });

  it('点击关闭按钮与遮罩均可关闭', () => {
    act(() => {
      (container!.querySelector('.sf-shortcuts-close button') as HTMLButtonElement).click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      container!
        .querySelector('.sf-shortcuts-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
