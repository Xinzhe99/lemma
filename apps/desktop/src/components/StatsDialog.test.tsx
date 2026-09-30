// @vitest-environment jsdom
/**
 * StatsDialog 组件测试。测试环境说明同 SnapshotDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现，避免根 react@19 混渲染。
 * 覆盖：进度条百分比与封顶 ✓、7 天柱状图（title 含日期与字数）、目标设置（钳制后落库）、
 * 项目 .tex 文件列表降序渲染、总字数与预计阅读时长、连续达标灰显、Esc/按钮关闭。
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

import { StatsDialog } from './StatsDialog';
import { useWorkspaceStore } from '../state/workspaceStore';
import { computeProjectWords, lastNDays, todayKey, useWritingStatsStore } from '../state/writingStats';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 相对今天偏移 n 天的日期键 */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

const FILES = {
  'main.tex': '一'.repeat(600), // 600 字
  'sections/intro.tex': '引言 here', // 2 CJK + 1 拉丁 = 3
  'refs.bib': '@misc{x, title={不计入}}',
  'README.md': 'not counted not counted',
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function findButton(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  expect(btn, `未找到「${label}」按钮`).toBeDefined();
  return btn!;
}

function barCols(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-stats-bar-col')];
}

beforeEach(() => {
  onClose = vi.fn();
  // 先设 workspace（writingStats 的自动统计订阅只重置基线，不产生增量），再设统计状态
  useWorkspaceStore.setState({
    projectName: 'demo',
    entry: 'main.tex',
    files: FILES,
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  });
  useWritingStatsStore.setState({
    today: todayKey(),
    dailyGoal: 500,
    wordsToday: 250,
    history: { [dayOffset(-1)]: 600, [dayOffset(-2)]: 300 },
    streakDays: 1,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<StatsDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('StatsDialog · 今日进度', () => {
  it('渲染今日字数与目标进度条（250/500 → 50%）', () => {
    const text = container!.textContent ?? '';
    expect(text).toContain('今日字数 250');
    expect(text).toContain('每日目标 500 字');
    const fill = container!.querySelector<HTMLElement>('.sf-stats-progress-fill')!;
    expect(fill).toBeTruthy();
    expect(fill.style.width).toBe('50%');
    expect(container!.querySelector<HTMLElement>('.sf-stats-progress-pct')!.textContent).toBe('50%');
    const track = container!.querySelector<HTMLElement>('.sf-stats-progress-track')!;
    expect(track.getAttribute('aria-valuenow')).toBe('50');
  });

  it('超过目标时进度封顶 100% 并显示 ✓', () => {
    act(() => {
      useWritingStatsStore.setState({ wordsToday: 800 });
    });
    const fill = container!.querySelector<HTMLElement>('.sf-stats-progress-fill')!;
    expect(fill.style.width).toBe('100%');
    const pct = container!.querySelector<HTMLElement>('.sf-stats-progress-pct')!;
    expect(pct.textContent).toContain('✓');
    expect(pct.textContent).toContain('100%');
  });

  it('连续达标天数展示 🔥 N 天；0 天灰显', () => {
    const streak = container!.querySelector<HTMLElement>('.sf-stats-streak')!;
    expect(streak.textContent).toContain('🔥 1 天');
    expect(streak.style.opacity).toBe('');
    act(() => {
      useWritingStatsStore.setState({ streakDays: 0 });
    });
    const grayed = container!.querySelector<HTMLElement>('.sf-stats-streak')!;
    expect(grayed.textContent).toContain('🔥 0 天');
    expect(grayed.style.opacity).toBe('0.45');
  });
});

describe('StatsDialog · 最近 7 天柱状图', () => {
  it('渲染 7 根柱，title 含日期与字数（今日取 wordsToday，历史取归档值）', () => {
    const cols = barCols();
    expect(cols).toHaveLength(7);
    expect(container!.querySelectorAll('.sf-stats-bar')).toHaveLength(7);

    const days = lastNDays(7, todayKey());
    const titles = cols.map((c) => c.getAttribute('title') ?? '');
    for (let i = 0; i < days.length; i++) {
      expect(titles[i]).toMatch(new RegExp(`^${days[i]} · \\d+ 字$`));
    }
    expect(titles[6]).toBe(`${todayKey()} · 250 字`); // 今日 = wordsToday
    expect(titles[5]).toBe(`${dayOffset(-1)} · 600 字`); // 昨日归档
    expect(titles[4]).toBe(`${dayOffset(-2)} · 300 字`);
  });

  it('达标柱用强调色，柱高随字数占比（昨日在满刻度处）', () => {
    const cols = barCols();
    const yesterdayBar = cols[5]!.querySelector<HTMLElement>('.sf-stats-bar')!;
    const todayBar = cols[6]!.querySelector<HTMLElement>('.sf-stats-bar')!;
    // 满刻度 max = max(goal 500, 600, 300, 250, 0…) = 600
    expect(yesterdayBar.style.height).toBe('100%');
    expect(yesterdayBar.style.background).toContain('var(--accent)'); // 600 >= 500 达标
    expect(todayBar.style.height).toBe('42%'); // round(250/600*100)
    expect(todayBar.style.background).toContain('var(--border-strong)'); // 250 < 500
  });
});

describe('StatsDialog · 目标设置', () => {
  it('修改目标并保存 → setDailyGoal 生效；越界输入被钳制回填', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-stats-goal-input')!;
    expect(input.value).toBe('500');

    type(input, '300');
    click(findButton('保存'));
    expect(useWritingStatsStore.getState().dailyGoal).toBe(300);
    expect(input.value).toBe('300');

    type(input, '5');
    click(findButton('保存'));
    expect(useWritingStatsStore.getState().dailyGoal).toBe(50);
    expect(input.value).toBe('50');
  });
});

describe('StatsDialog · 项目统计', () => {
  it('.tex 文件按字数降序渲染（非 .tex 不出现），行内含文件名与字数', () => {
    const rows = [...container!.querySelectorAll<HTMLElement>('.sf-stats-file-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.sf-stats-file-path')!.textContent).toBe('main.tex');
    expect(rows[0]!.querySelector('.sf-stats-file-words')!.textContent).toBe('600');
    expect(rows[1]!.querySelector('.sf-stats-file-path')!.textContent).toBe('sections/intro.tex');
    expect(rows[1]!.querySelector('.sf-stats-file-words')!.textContent).toBe('3');

    const text = container!.textContent ?? '';
    expect(text).not.toContain('refs.bib');
    expect(text).not.toContain('README.md');
  });

  it('总字数（全部 .tex 之和）与预计阅读时长（200 字/分钟）', () => {
    const text = container!.textContent ?? '';
    expect(text).toContain('总字数');
    expect(text).toContain(String(computeProjectWords(FILES))); // 600 + 3 = 603
    expect(text).toContain('预计阅读时长');
    expect(text).toContain('约 3 分钟'); // round(603 / 200) = 3
    expect(text).toContain('200 字/分钟');
  });
});

describe('StatsDialog · 关闭交互', () => {
  it('关闭按钮与 Esc 均触发 onClose', () => {
    click(findButton('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
