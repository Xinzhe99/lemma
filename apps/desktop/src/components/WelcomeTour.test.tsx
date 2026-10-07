// @vitest-environment jsdom
/**
 * WelcomeTour（首启全屏导览）组件测试。测试环境说明同 ShortcutsDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现，onboarding/settings store 用真实模块。
 * 覆盖验收路径：
 *  - 4 页 carousel：页 1-3 标题/描述/截图（public/docs/screenshots 路径）、页 4 三步 + 双按钮；
 *  - 页码指示点（active 态、可点击跳页）；
 *  - 左右方向键翻页（首尾钳制）、上一步按钮首页禁用；
 *  - Esc / 遮罩 mousedown = 稍后（dismissTour 记 24h 时间戳 + onClose）；卡片内 mousedown 不触发；
 *  - 「跳过引导」永久跳过（skipTour → tourDone 持久化）；「开始使用」完成（completeTour）；「先看看」稍后；
 *  - en 字典渲染。
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
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

import { WelcomeTour } from './WelcomeTour';
import { ONBOARDING_STORAGE_KEY, shouldShowTour, useOnboardingStore } from '../state/onboardingStore';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function mount() {
  act(() => {
    root!.render(<WelcomeTour onClose={onClose} />);
  });
}

function query(selector: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(selector);
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  });
}

function mousedown(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  localStorage.clear();
  useOnboardingStore.getState().resetAll();
  useSettingsStore.setState({ language: 'zh' });
  onClose = vi.fn();
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

describe('WelcomeTour · 3 页 carousel', () => {
  it('页 1：欢迎标题 + 一句话定位 + tour-main 截图 + 3 个指示点（首个 active）', () => {
    mount();
    expect(query('.sf-tour-title')?.textContent).toBe('欢迎来到 Lemma');
    expect(query('.sf-tour-desc')?.textContent).toContain('AI 原生的一站式论文工作站');
    const img = query('img.sf-tour-shot');
    expect(img?.getAttribute('src')).toBe('docs/screenshots/tour-main.png');
    expect(img?.getAttribute('alt')).toBe('写作视图截图');

    const dots = [...container!.querySelectorAll('.sf-tour-dot')];
    expect(dots).toHaveLength(3);
    expect(dots[0]!.classList.contains('active')).toBe(true);
    expect(dots[2]!.classList.contains('active')).toBe(false);
    expect(query('.sf-tour-skip')?.textContent).toBe('跳过引导');
  });

  it('「下一步」逐页推进：页 2 写作与编译（tour-ai.png）、页 3 三步上手（无截图）', () => {
    mount();
    click(query('.sf-tour-next')!);
    expect(query('.sf-tour-title')?.textContent).toBe('写作与编译');
    expect(query('.sf-tour-desc')?.textContent).toContain('无需预装 LaTeX');
    expect(query('img.sf-tour-shot')?.getAttribute('src')).toBe('docs/screenshots/tour-ai.png');

    click(query('.sf-tour-next')!);
    expect(query('.sf-tour-title')?.textContent).toBe('三步上手');
    expect(query('img.sf-tour-shot')).toBeNull();
  });

  it('页 3（三步上手）：三条步骤 + 主按钮「开始使用」+ 次按钮「先看看」，无截图', () => {
    mount();
    click(query('.sf-tour-next')!);
    click(query('.sf-tour-next')!);
    expect(query('.sf-tour-title')?.textContent).toBe('三步上手');
    expect(query('img.sf-tour-shot')).toBeNull();
    const steps = [...container!.querySelectorAll('.sf-tour-step')].map((s) => s.textContent);
    expect(steps).toEqual(['1创建项目从模板新建，或导入 Overleaf zip', '2写作并编译中央左写右预览，实时编译不跳页', '3问 AI右侧直接说需求——润色、找文献、改稿、修错（支持语音）']);
    expect(query('.sf-tour-start')?.textContent).toContain('开始使用');
    expect(query('.sf-tour-later')?.textContent).toContain('先看看');
  });
});

describe('WelcomeTour · 翻页交互', () => {
  it('左右方向键翻页，首尾钳制（页 1 ← 不动，页 4 → 不动）', () => {
    mount();
    press('ArrowLeft');
    expect(query('.sf-tour-title')?.textContent).toBe('欢迎来到 Lemma');
    press('ArrowRight');
    expect(query('.sf-tour-title')?.textContent).toBe('写作与编译');
    press('ArrowRight');
    press('ArrowRight');
    expect(query('.sf-tour-title')?.textContent).toBe('三步上手');
    press('ArrowRight');
    expect(query('.sf-tour-title')?.textContent).toBe('三步上手');
  });

  it('「上一步」按钮在首页禁用；指示点可点击跳页', () => {
    mount();
    const prev = query('.sf-tour-prev') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
    click(prev);
    expect(query('.sf-tour-title')?.textContent).toBe('欢迎来到 Lemma');

    click([...container!.querySelectorAll('.sf-tour-dot')][2]!);
    expect(query('.sf-tour-title')?.textContent).toBe('三步上手');
    const prev2 = query('.sf-tour-prev') as HTMLButtonElement;
    expect(prev2.disabled).toBe(false);
    click(prev2);
    expect(query('.sf-tour-title')?.textContent).toBe('写作与编译');
  });
});

describe('WelcomeTour · 稍后 / 跳过 / 完成', () => {
  it('Esc = 稍后：记录 tourDismissedAt（24h 内不再弹）并卸载（onClose）', () => {
    mount();
    press('Escape');
    const s = useOnboardingStore.getState();
    expect(s.tourDone).toBe(false);
    expect(s.tourDismissedAt).not.toBeNull();
    expect(shouldShowTour()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('遮罩 mousedown = 稍后；卡片内 mousedown 不关闭', () => {
    mount();
    mousedown(query('.sf-tour-card')!);
    expect(onClose).not.toHaveBeenCalled();
    expect(useOnboardingStore.getState().tourDismissedAt).toBeNull();

    mousedown(container!.querySelector('.sf-tour-overlay')!);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useOnboardingStore.getState().tourDismissedAt).not.toBeNull();
  });

  it('「跳过引导」永久跳过：tourDone=true 持久化到 sf-onboarding', () => {
    mount();
    click(query('.sf-tour-skip')!);
    expect(useOnboardingStore.getState().tourDone).toBe(true);
    expect(shouldShowTour()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(JSON.parse(localStorage.getItem(ONBOARDING_STORAGE_KEY)!).tourDone).toBe(true);
  });

  it('末页「开始使用」= 完成导览（completeTour）；「先看看」= 稍后（dismissTour）', () => {
    mount();
    click(query('.sf-tour-next')!);
    click(query('.sf-tour-next')!);
    click(query('.sf-tour-start')!);
    expect(useOnboardingStore.getState().tourDone).toBe(true);
    expect(useOnboardingStore.getState().tourDismissedAt).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);

    // 重置后再验证「先看看」（先卸载旧实例，翻页状态归零）
    act(() => {
      useOnboardingStore.getState().resetAll();
      root!.render(<div />);
    });
    mount();
    click(query('.sf-tour-next')!);
    click(query('.sf-tour-next')!);
    click(query('.sf-tour-later')!);
    expect(useOnboardingStore.getState().tourDone).toBe(false);
    expect(useOnboardingStore.getState().tourDismissedAt).not.toBeNull();
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('WelcomeTour · i18n', () => {
  it('en 字典：标题/描述/按钮均为英文', () => {
    useSettingsStore.setState({ language: 'en' });
    mount();
    expect(query('.sf-tour-title')?.textContent).toBe('Welcome to Lemma');
    expect(query('.sf-tour-desc')?.textContent).toContain('all-in-one workstation');
    expect(query('.sf-tour-skip')?.textContent).toBe('Skip the tour');
    expect(query('.sf-tour-next')?.textContent).toContain('Next');

    click(query('.sf-tour-next')!);
    click(query('.sf-tour-next')!);
    expect(query('.sf-tour-start')?.textContent).toContain('Get started');
    expect(query('.sf-tour-later')?.textContent).toContain('Explore first');
    expect([...container!.querySelectorAll('.sf-tour-step')][0]?.textContent).toContain('Create a project');
  });
});
