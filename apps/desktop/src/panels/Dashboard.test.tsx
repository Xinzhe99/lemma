// @vitest-environment jsdom
/**
 * Dashboard（首页指挥台）组件测试。测试环境说明同 DigestPanel.test.tsx：mock zustand 为
 * 仅依赖本包 react@18 的等价实现；晨报网络动作（loadCachedDigest / fetchDigest）以
 * setState 覆写为受控 mock（不真实联网）；uiStore 的 setSidebarTab / setTemplateWizardOpen /
 * requestZipPicker 覆写为 spy 验证跳转。computeHealth 以 vi.mock 包裹实际实现验证
 * 「仅 files 变化重算」。覆盖验收路径：
 *  - 空项目引导（新建/导入按钮触发 uiStore 动作）、有项目问候行（项目名 + 日期）；
 *  - 今日写作卡：字数 + 🔥 streak + 进度条百分比（含 ✓ 达标）/ goal 未设无进度条仍显示字数；
 *  - 健康度卡：分数与色调类映射（good/bad）、四类 issue chips 计数、跳引用面板；
 *  - deadline 卡：倒计时大字（⚠ 临期 / 已过期态）、未设置温和提示、跳投稿页；
 *  - 未处理事项卡：未解决批注数 + 去处理跳转、零未解决温和文案、正式项目计数（临时记录不计）；
 *  - 晨报块整体嵌入 DigestPanel（空订阅引导可见、挂载不联网刷新）；en 字典渲染；
 *  - computeHealth 仅在 files 变化时重算。
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

vi.mock('../healthScore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../healthScore')>();
  return { ...actual, computeHealth: vi.fn(actual.computeHealth) };
});

import { Dashboard } from './Dashboard';
import { computeHealth } from '../healthScore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { todayKey, useWritingStatsStore } from '../state/writingStats';
import { useSubmitStore } from '../state/submitStore';
import { useCommentsStore, type ManuscriptComment } from '../state/commentsStore';
import { CURRENT_PROJECT_ID, useProjectsStore, type ProjectRecord } from '../state/projectsStore';
import { useDigestStore, type DigestResult } from '../state/digestStore';
import { useLibraryStore } from '../state/libraryStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CLEAN_MAIN = `\\documentclass{article}
\\begin{document}
Hello world.
\\end{document}
`;

/** 12 个未闭合环境（48 分 lint 扣分封顶 40）+ 20 处 misspelling（封顶 25）+ 1 个悬空引用 */
const BAD_MAIN = `\\begin{document}
${Array.from({ length: 12 }, () => '\\begin{itemize}').join('\n')}
${Array.from({ length: 20 }, (_, i) => `Line ${i} will recieve input.`).join('\n')}
\\cite{nope}
\\end{document}
`;

function dateKeyOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function comment(partial: Partial<ManuscriptComment> & { id: string }): ManuscriptComment {
  return {
    file: 'main.tex',
    line: 1,
    author: '导师',
    text: 'text',
    resolved: false,
    createdAt: 1,
    replies: [],
    ...partial,
  };
}

function projectRecord(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    savedAt: 1,
    snapshot: { projectName: name, entry: 'main.tex', files: { 'main.tex': '' }, openTabs: [], activeTab: null, snapshots: {} },
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let setSidebarTab: ReturnType<typeof vi.fn>;
let setTemplateWizardOpen: ReturnType<typeof vi.fn>;
let requestZipPicker: ReturnType<typeof vi.fn>;
let mockLoadCached: ReturnType<typeof vi.fn>;
let mockFetchDigest: ReturnType<typeof vi.fn>;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function query(selector: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(selector);
}

function queryAll(selector: string): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>(selector)];
}

function btnByClass(cls: string): HTMLButtonElement {
  const found = container!.querySelector<HTMLButtonElement>(`button.${cls}`);
  if (!found) throw new Error(`button not found: ${cls}`);
  return found;
}

async function mount() {
  await act(async () => {
    root!.render(<Dashboard />);
  });
  await act(async () => {});
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useSettingsStore.setState({ language: 'zh' });

  setSidebarTab = vi.fn();
  setTemplateWizardOpen = vi.fn();
  requestZipPicker = vi.fn();
  useUiStore.setState({
    setSidebarTab: setSidebarTab as never,
    setTemplateWizardOpen: setTemplateWizardOpen as never,
    requestZipPicker: requestZipPicker as never,
  });

  useWorkspaceStore.setState({
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: { 'main.tex': CLEAN_MAIN },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  });
  useWritingStatsStore.setState({
    today: todayKey(),
    dailyGoal: 500,
    wordsToday: 250,
    history: {},
    streakDays: 3,
  });
  useSubmitStore.setState({ venueId: null, lastExportAt: null, deadline: null });
  useCommentsStore.setState({ comments: [] });
  useProjectsStore.setState({ projects: [projectRecord('p1', 'demo-paper')] });

  mockLoadCached = vi.fn(async () => {});
  mockFetchDigest = vi.fn(async () =>
    ({ ok: true, items: [], fetchedAt: Date.now() }) satisfies DigestResult,
  );
  useDigestStore.setState({
    subscriptions: [],
    items: [],
    lastFetchedAt: null,
    loading: false,
    error: null,
    loadCachedDigest: mockLoadCached as never,
    fetchDigest: mockFetchDigest as never,
  });
  useLibraryStore.setState({ papers: [], pdfAttachments: {}, indexReady: true });

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

describe('Dashboard', () => {
  it('空项目：问候行显示新建/导入引导，无今日写作卡与健康度卡；按钮触发 uiStore 动作', async () => {
    useWorkspaceStore.setState({ projectName: '', entry: '', files: {}, openTabs: [], activeTab: null });
    await mount();

    expect(query('.sf-dash-empty')?.textContent).toContain('开始你的第一个项目');
    expect(query('.sf-dash-today')).toBeNull();
    expect(query('.sf-dash-health')).toBeNull();
    // 日期行仍然可见
    expect(query('.sf-dash-date')?.textContent).toContain(String(new Date().getFullYear()));

    click(btnByClass('sf-dash-new'));
    expect(setTemplateWizardOpen).toHaveBeenCalledWith(true);
    click(btnByClass('sf-dash-import'));
    expect(requestZipPicker).toHaveBeenCalledTimes(1);
  });

  it('有项目：问候行显示项目名与日期；今日卡显示字数 + 🔥 streak 与进度条百分比', async () => {
    await mount();

    expect(query('.sf-dash-project')?.textContent).toBe('demo-paper');
    expect(query('.sf-dash-date')?.textContent).toContain(String(new Date().getFullYear()));

    expect(query('.sf-dash-today-words')?.textContent).toBe('250');
    expect(query('.sf-dash-streak')?.textContent).toContain('🔥 3');

    const progress = query('.sf-dash-progress');
    expect(progress?.getAttribute('aria-valuenow')).toBe('50');
    const fill = query('.sf-dash-progress-fill');
    expect(fill?.getAttribute('data-pct')).toBe('50');
    expect(fill?.style.width).toBe('50%');
    expect(query('.sf-dash-progress-pct')?.textContent).toContain('50%');
    expect(query('.sf-dash-progress-pct')?.textContent).not.toContain('✓');
  });

  it('今日写作：达标显示 ✓ 100%；goal 未设（<=0）不渲染进度条，仍显示字数与温和文案', async () => {
    useWritingStatsStore.setState({ wordsToday: 500 });
    await mount();
    expect(query('.sf-dash-progress')?.getAttribute('aria-valuenow')).toBe('100');
    expect(query('.sf-dash-progress-pct')?.textContent).toContain('✓ 100%');

    act(() => {
      useWritingStatsStore.setState({ wordsToday: 250, dailyGoal: 0 });
    });
    await act(async () => {
      root!.render(<Dashboard />);
    });
    expect(query('.sf-dash-progress')).toBeNull();
    expect(query('.sf-dash-today-words')?.textContent).toBe('250');
    expect(query('.sf-dash-goal-unset')?.textContent).toContain('尚未设置每日目标');
  });

  it('「继续写作」按钮跳文件树（setSidebarTab files）', async () => {
    await mount();
    click(btnByClass('sf-dash-write'));
    expect(setSidebarTab).toHaveBeenCalledWith('files');
  });

  it('健康度卡：干净项目 100 分绿调；四类 chips 计数为 0；跳引用面板', async () => {
    await mount();

    const score = query('.sf-dash-health-score');
    expect(score?.textContent).toBe('100');
    expect(score?.classList.contains('sf-dash-tone-good')).toBe(true);
    expect(score?.getAttribute('data-tone')).toBe('good');
    expect(score?.style.color).toBe('var(--ok)');

    const chips = queryAll('.sf-dash-chip').map((c) => c.textContent);
    expect(chips).toEqual(['语法 0', '拼写 0', '术语 0', '悬空引用 0']);

    click(btnByClass('sf-dash-go-citations'));
    expect(setSidebarTab).toHaveBeenCalledWith('citations');
  });

  it('健康度卡：脏项目分数 < 60 红调，chips 反映各类计数', async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': BAD_MAIN } });
    await mount();

    const score = query('.sf-dash-health-score');
    expect(score?.textContent).toBe('30'); // 100 - 40(lint 封顶) - 25(spell 封顶) - 5(1 悬空)
    expect(score?.classList.contains('sf-dash-tone-bad')).toBe(true);
    expect(score?.style.color).toBe('var(--err)');

    const chips = queryAll('.sf-dash-chip').map((c) => c.textContent);
    expect(chips).toContain('语法 12');
    expect(chips).toContain('拼写 20');
    expect(chips).toContain('悬空引用 1');
  });

  it('deadline 卡：远期显示「剩 N 天」；未设置温和提示 + 「设置截止日期」跳投稿页', async () => {
    await mount();
    expect(query('.sf-dash-deadline-count')).toBeNull();
    expect(query('.sf-dash-deadline-none')?.textContent).toContain('未设置投稿截止日期');
    expect(btnByClass('sf-dash-go-submit').textContent?.trim()).toBe('设置截止日期');
    click(btnByClass('sf-dash-go-submit'));
    expect(setSidebarTab).toHaveBeenCalledWith('submit');

    act(() => {
      useSubmitStore.setState({ deadline: dateKeyOffset(30) });
    });
    await act(async () => {
      root!.render(<Dashboard />);
    });
    expect(query('.sf-dash-deadline-count')?.textContent).toContain('剩 30 天');
    expect(query('.sf-dash-deadline-date')?.textContent).toBe(dateKeyOffset(30));
  });

  it('deadline 卡：今天截止带 ⚠ 临期态；已过期带过期态与红色', async () => {
    act(() => {
      useSubmitStore.setState({ deadline: todayKey() });
    });
    await mount();
    const today = query('.sf-dash-deadline-count');
    expect(today?.textContent).toContain('⚠ 今天截止');
    expect(today?.classList.contains('sf-dash-soon')).toBe(true);
    expect(today?.style.color).toBe('var(--warn)');

    act(() => {
      useSubmitStore.setState({ deadline: dateKeyOffset(-2) });
    });
    await act(async () => {
      root!.render(<Dashboard />);
    });
    const overdue = query('.sf-dash-deadline-count');
    expect(overdue?.textContent).toContain('已过期 2 天');
    expect(overdue?.classList.contains('sf-dash-overdue')).toBe(true);
    expect(overdue?.style.color).toBe('var(--err)');
  });

  it('未处理事项卡：未解决批注数 + 「去处理」跳批注面板；零未解决只给温和文案；正式项目计数', async () => {
    await mount();
    expect(query('.sf-dash-pending-none')?.textContent).toContain('没有待处理的批注');
    expect(query('.sf-dash-go-comments')).toBeNull();
    expect(query('.sf-dash-projects')?.textContent).toContain('共 1 个项目');

    act(() => {
      useCommentsStore.setState({
        comments: [
          comment({ id: 'c1', resolved: false }),
          comment({ id: 'c2', resolved: false }),
          comment({ id: 'c3', resolved: true }),
        ],
      });
      // 临时崩溃恢复记录（__current__）不计入项目数
      useProjectsStore.setState({
        projects: [projectRecord(CURRENT_PROJECT_ID, 'current'), projectRecord('p1', 'demo-paper')],
      });
    });
    await act(async () => {
      root!.render(<Dashboard />);
    });

    expect(query('.sf-dash-pending-comments')?.textContent).toContain('2 条未解决批注');
    expect(query('.sf-dash-projects')?.textContent).toContain('共 1 个项目');
    click(btnByClass('sf-dash-go-comments'));
    expect(setSidebarTab).toHaveBeenCalledWith('comments');
  });

  it('晨报块整体嵌入 DigestPanel：空订阅显示其引导文案，挂载读缓存但不联网刷新', async () => {
    await mount();

    expect(query('.sf-dash-digest .sf-digest-title')?.textContent).toContain('每日晨报');
    expect(query('.sf-dash-digest .sf-digest-empty')?.textContent).toContain(
      '添加你的研究方向关键词，每天打开即见新论文',
    );
    expect(mockLoadCached).toHaveBeenCalledTimes(1);
    expect(mockFetchDigest).not.toHaveBeenCalled();
  });

  it('en 字典渲染：空态引导、今日卡、健康度卡、deadline 卡均为英文', async () => {
    useSettingsStore.setState({ language: 'en' });
    await mount();

    expect(query('.sf-dash-write')?.textContent?.trim()).toBe('Keep writing');
    expect(query('.sf-dash-health-title')?.textContent ?? query('.sf-dash-health .sf-dash-title')?.textContent).toContain(
      'Manuscript health',
    );
    expect(query('.sf-dash-deadline-none')?.textContent).toContain('No submission deadline set');
    const chips = queryAll('.sf-dash-chip').map((c) => c.textContent);
    expect(chips).toEqual(['LaTeX 0', 'Spelling 0', 'Glossary 0', 'Dangling cites 0']);

    // en 空项目引导
    act(() => {
      useWorkspaceStore.setState({ projectName: '', entry: '', files: {}, openTabs: [], activeTab: null });
    });
    await act(async () => {
      root!.render(<Dashboard />);
    });
    expect(query('.sf-dash-empty')?.textContent).toContain('Start your first project');
  });

  it('computeHealth 在 useMemo 中仅随 files 重算（无关状态变化不重算）', async () => {
    await mount();
    const callsAfterMount = vi.mocked(computeHealth).mock.calls.length;
    expect(callsAfterMount).toBe(1);

    // 无关状态变化：deadline / wordsToday / comments 变化不重算
    act(() => {
      useSubmitStore.setState({ deadline: dateKeyOffset(10) });
      useWritingStatsStore.setState({ wordsToday: 300 });
      useCommentsStore.setState({ comments: [comment({ id: 'c1' })] });
    });
    await act(async () => {});
    expect(vi.mocked(computeHealth).mock.calls.length).toBe(callsAfterMount);

    // files 变化：重算一次
    act(() => {
      useWorkspaceStore.setState({ files: { 'main.tex': BAD_MAIN } });
    });
    await act(async () => {});
    expect(vi.mocked(computeHealth).mock.calls.length).toBe(callsAfterMount + 1);
  });
});
