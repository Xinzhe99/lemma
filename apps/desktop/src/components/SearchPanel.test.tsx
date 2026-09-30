// @vitest-environment jsdom
/**
 * SearchPanel 组件测试。测试环境说明同 QuickOpen.test.tsx：mock zustand 为仅依赖
 * 本包 react@18 的等价实现。覆盖验收路径：输入 200ms 防抖实时搜索 → 结果按文件分组
 * （文件名 · 命中数）→ 点击命中 jumpHandler 收到正确 file:line 且面板保持打开 →
 * 连续两次点击 → toggle 翻转影响结果数 → Enter 跳第一条 → Esc / 遮罩关闭。
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

import { SearchPanel } from './SearchPanel';
import { useWorkspaceStore } from '../state/workspaceStore';
import { setJumpHandler } from '../editorJump';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FILES = {
  'main.tex': 'intro line\nplease cite the source\ncitekey stands alone',
  'sections/intro.tex': 'CITE uppercase here\nnothing relevant',
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;
let jumpHandler: ReturnType<typeof vi.fn>;

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 输入后推进防抖计时器（200ms）并等结果渲染 */
function typeAndFlush(input: HTMLInputElement, value: string) {
  type(input, value);
  act(() => {
    vi.advanceTimersByTime(250);
  });
}

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  });
}

function hits(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-searchpanel-hit')];
}

function groupHeaders(): string[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-searchpanel-file')].map((el) => el.textContent ?? '');
}

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({ files: FILES, openTabs: ['main.tex'], activeTab: 'main.tex' });
  onClose = vi.fn();
  jumpHandler = vi.fn();
  setJumpHandler(jumpHandler);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SearchPanel onClose={onClose} />);
  });
});

afterEach(() => {
  setJumpHandler(null);
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe('SearchPanel', () => {
  it('打开即自动聚焦；空 query 显示提示且无结果', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    expect(document.activeElement).toBe(input);
    expect(container!.querySelector('.sf-searchpanel-hint')).toBeTruthy();
    expect(hits()).toHaveLength(0);
  });

  it('输入防抖：200ms 内不出结果，推进计时器后实时出现并按文件分组', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    type(input, 'cite');
    // 防抖窗口内：尚无结果
    expect(container!.querySelector('.sf-searchpanel-hint')).toBeTruthy();
    expect(hits()).toHaveLength(0);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    // 大小写不敏感：main.tex 2 条（cite/citekey）+ intro.tex 1 条（CITE）
    expect(hits()).toHaveLength(3);
    expect(groupHeaders()).toEqual(['main.tex · 2', 'sections/intro.tex · 1']);
    expect(container!.querySelector('.sf-searchpanel-summary')!.textContent).toContain('3');
    // 命中词 <mark> 高亮
    expect(container!.querySelector('.sf-searchpanel-hit mark')!.textContent).toBe('cite');
  });

  it('点击结果：jumpHandler 收到正确 file:line，面板保持打开（onClose 不调用）', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'cite');
    act(() => {
      hits()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(jumpHandler).toHaveBeenCalledTimes(1);
    expect(jumpHandler).toHaveBeenCalledWith({ file: 'main.tex', line: 2 });
    expect(onClose).not.toHaveBeenCalled();
    expect(container!.querySelector('.sf-searchpanel')).toBeTruthy(); // 面板仍在
  });

  it('连续两次点击：依次收到两条命中目标', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'cite');
    act(() => {
      hits()[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    act(() => {
      hits()[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(jumpHandler).toHaveBeenCalledTimes(2);
    expect(jumpHandler).toHaveBeenNthCalledWith(1, { file: 'main.tex', line: 2 });
    expect(jumpHandler).toHaveBeenNthCalledWith(2, { file: 'main.tex', line: 3 });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('整词 toggle 翻转影响结果数：citekey 被排除，取消后恢复', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'cite');

    const wordToggle = container!.querySelector<HTMLElement>('.sf-searchpanel-toggle-word')!;
    act(() => {
      wordToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(wordToggle.getAttribute('aria-pressed')).toBe('true');
    expect(hits()).toHaveLength(2); // citekey 不再命中
    expect(groupHeaders()).toEqual(['main.tex · 1', 'sections/intro.tex · 1']);

    act(() => {
      wordToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(hits()).toHaveLength(3);
  });

  it('大小写 toggle 翻转影响结果数：CITE 行被排除', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'cite');
    const caseToggle = container!.querySelector<HTMLElement>('.sf-searchpanel-toggle-case')!;
    act(() => {
      caseToggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(hits()).toHaveLength(2); // CITE uppercase 不再命中
    expect(groupHeaders()).toEqual(['main.tex · 2']);
  });

  it('Enter 跳第一条命中', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'cite');
    jumpHandler.mockClear();
    pressKey('Enter');
    expect(jumpHandler).toHaveBeenCalledTimes(1);
    expect(jumpHandler).toHaveBeenCalledWith({ file: 'main.tex', line: 2 });
    expect(onClose).not.toHaveBeenCalled(); // 保持打开可连续跳转
  });

  it('Esc 与遮罩点击关闭；点击面板内部不关闭', () => {
    pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      container!
        .querySelector('.sf-quickopen-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);

    act(() => {
      container!
        .querySelector('.sf-searchpanel')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2); // 面板内冒泡被阻止
  });

  it('无匹配渲染空态；summary 行在截断时提示', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-searchpanel-input')!;
    typeAndFlush(input, 'zzz-not-exist');
    expect(container!.querySelector('.sf-searchpanel-empty')).toBeTruthy();
    expect(hits()).toHaveLength(0);

    typeAndFlush(input, 'e'); // 大量命中不足以触发 500 截断，仅验证 summary 存在
    expect(container!.querySelector('.sf-searchpanel-summary')!.textContent).not.toContain('前 500');
  });
});
