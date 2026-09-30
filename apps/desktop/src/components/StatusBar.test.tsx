// @vitest-environment jsdom
/**
 * 测试环境说明同 FileTree.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现
 * （语义与真实 zustand 一致），避免根 react@19 与 apps/desktop react@18 混渲染。
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

import { StatusBar, countWords, relativeTime } from './StatusBar';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderView() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<StatusBar cursor={{ line: 3, col: 7 }} />);
  });
}

beforeEach(() => {
  useWorkspaceStore.getState().loadDemoProject();
  useWorkspaceStore.setState({ dirty: false, lastSavedAt: null });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('countWords（混合字数统计纯函数）', () => {
  it('空串与纯标点为 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  ! ? , . ; ')).toBe(0);
    expect(countWords('\\section{}\\cite{x}')).toBe(3); // section / cite / x
  });

  it('纯中文每字计 1，纯英文连续词计 1', () => {
    expect(countWords('你好，世界')).toBe(4);
    expect(countWords('hello world')).toBe(2);
    expect(countWords('state-of-the-art')).toBe(1);
    expect(countWords("don't stop")).toBe(2);
  });

  it('中英混合：CJK 每字 + 拉丁词各计 1', () => {
    expect(countWords('Hello 世界 world 2026')).toBe(5);
    expect(countWords('大语言模型（LLM）重塑 research workflow')).toBe(10); // 7 CJK + 3 拉丁词
  });
});

describe('relativeTime（相对时间纯函数）', () => {
  const NOW = 1_000_000_000_000;

  it('中文相对时间分档', () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe('刚刚');
    expect(relativeTime(NOW + 60_000, NOW)).toBe('刚刚'); // 未来时间按刚刚处理
    expect(relativeTime(NOW - 30_000, NOW)).toBe('30 秒前');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 天前');
  });

  it('英文相对时间分档', () => {
    expect(relativeTime(NOW - 2_000, NOW, 'en')).toBe('just now');
    expect(relativeTime(NOW - 30_000, NOW, 'en')).toBe('30 seconds ago');
    expect(relativeTime(NOW - 60_000, NOW, 'en')).toBe('1 minute ago');
    expect(relativeTime(NOW - 5 * 60_000, NOW, 'en')).toBe('5 minutes ago');
  });
});

describe('StatusBar 渲染', () => {
  it('渲染文件名、字数、行数、光标行列与已保存态', () => {
    const content = useWorkspaceStore.getState().files['main.tex']!;
    renderView();
    const text = container!.textContent ?? '';
    expect(text).toContain('main.tex');
    expect(text).toContain(`字数 ${countWords(content)}`);
    expect(text).toContain(`行数 ${content.split('\n').length}`);
    expect(text).toContain('行 3, 7');
    expect(text).toContain('✓ 已保存');
    expect(text).not.toContain('●');
  });

  it('dirty 时显示 ● 未保存；保存后显示 ✓ 已保存 + 相对时间', () => {
    renderView();
    act(() => {
      useWorkspaceStore.getState().updateFile('main.tex', '状态栏渲染测试');
    });
    let text = container!.textContent ?? '';
    expect(text).toContain('●');
    expect(text).toContain('未保存');
    expect(text).toContain(`字数 ${countWords('状态栏渲染测试')}`);

    act(() => {
      useWorkspaceStore.setState({ dirty: false, lastSavedAt: Date.now() - 30_000 });
    });
    text = container!.textContent ?? '';
    expect(text).toContain('✓ 已保存');
    expect(text).toContain('30 秒前');
  });

  it('无活动文件时显示占位且行数为 1', () => {
    useWorkspaceStore.setState({ activeTab: null });
    renderView();
    const text = container!.textContent ?? '';
    expect(text).toContain('未打开文件');
    expect(text).toContain('行数 1');
  });
});
