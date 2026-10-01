// @vitest-environment jsdom
/**
 * GettingStarted（新手任务清单）测试。测试环境说明同 ShortcutsDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；编译与会话动作用 vi.mock 打桩
 * （compileAction.runCompile / aiActions.sendChatMessage），uiStore 跳转动作用 spy 覆写。
 * 覆盖验收路径：
 *  - computeChecklist 纯函数（≥10 用例）：5 步固定顺序、各实时探测源、闩锁合并、probeLiveStepIds；
 *  - 渲染：5 行 + 进度 N/5 + 进度条 aria；完成行 ✓ 无按钮、未完成行有行动按钮；
 *  - 行动按钮接线：模板向导 / zip 导入 / 文件树 / 编译 / Agent 提问 / 设置快捷键事件；
 *  - 瞬时信号闩锁（dirty → markStep 持久化）；
 *  - 收起（本次会话，可展开）/ 不再显示（持久 dismissChecklist）；
 *  - 全部完成或 dismissed 不渲染；en 字典。
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

vi.mock('../compileAction', () => ({ runCompile: vi.fn(async () => ({ ok: true, entry: 'main.tex', passes: 1, diagnostics: 0 })) }));
vi.mock('../aiActions', () => ({ sendChatMessage: vi.fn(async () => undefined) }));

import { GettingStarted, computeChecklist, openSettingsViaShortcut, probeLiveStepIds } from './GettingStarted';
import { runCompile } from '../compileAction';
import { sendChatMessage } from '../aiActions';
import { useOnboardingStore } from '../state/onboardingStore';
import { useSettingsStore } from '../state/settingsStore';
import { useAgentHubStore } from '@scholarforge/agent-hub';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// computeChecklist 纯函数（≥10 用例）
// ---------------------------------------------------------------------------

const BASE = {
  files: {} as Record<string, string>,
  dirty: false,
  compileLog: [] as string[],
  agentSessions: 0,
  providers: 0,
  completedSteps: [] as string[],
};

const doneMap = (r: ReturnType<typeof computeChecklist>) => Object.fromEntries(r.map((x) => [x.id, x.done]));

describe('computeChecklist · 纯函数', () => {
  it('全新用户：5 步全部未完成，顺序固定 project → write → compile → chat → provider', () => {
    const r = computeChecklist(BASE);
    expect(r.map((x) => x.id)).toEqual(['project', 'write', 'compile', 'chat', 'provider']);
    expect(r.every((x) => !x.done)).toBe(true);
  });

  it('project：files 里有 main.tex 即完成（demo 项目也算）', () => {
    expect(doneMap(computeChecklist({ ...BASE, files: { 'main.tex': '' } })).project).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, files: { 'sections/intro.tex': '' } })).project).toBe(false);
    expect(doneMap(computeChecklist({ ...BASE, files: { 'README.md': '' } })).project).toBe(false);
  });

  it('write：dirty 为真即完成；dirty 复位后靠闩锁保持', () => {
    expect(doneMap(computeChecklist({ ...BASE, dirty: true })).write).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, dirty: false, completedSteps: ['write'] })).write).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, dirty: false })).write).toBe(false);
  });

  it('compile：compileLog 非空即完成（ok/fail 都算）；空日志靠闩锁保持', () => {
    expect(doneMap(computeChecklist({ ...BASE, compileLog: ['▶ 开始编译'] })).compile).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, compileLog: [], completedSteps: ['compile'] })).compile).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, compileLog: [] })).compile).toBe(false);
  });

  it('chat：agentSessions > 0 即完成；0 时靠闩锁保持', () => {
    expect(doneMap(computeChecklist({ ...BASE, agentSessions: 1 })).chat).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, agentSessions: 0, completedSteps: ['chat'] })).chat).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, agentSessions: 0 })).chat).toBe(false);
  });

  it('provider：providers > 0 即完成；0 时靠闩锁保持', () => {
    expect(doneMap(computeChecklist({ ...BASE, providers: 2 })).provider).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, providers: 0, completedSteps: ['provider'] })).provider).toBe(true);
    expect(doneMap(computeChecklist({ ...BASE, providers: 0 })).provider).toBe(false);
  });

  it('全信号 + 全闩锁：5/5 全完成', () => {
    const r = computeChecklist({
      files: { 'main.tex': 'x' },
      dirty: true,
      compileLog: ['line'],
      agentSessions: 3,
      providers: 1,
      completedSteps: [],
    });
    expect(r.every((x) => x.done)).toBe(true);
  });

  it('闩锁可单独补齐实时信号缺失的步骤（重启后清单不倒退）', () => {
    const r = computeChecklist({
      files: { 'main.tex': 'x' },
      dirty: false, // 编辑过但已保存
      compileLog: [], // 编译日志重启后清空
      agentSessions: 0, // 会话内存态
      providers: 0,
      completedSteps: ['write', 'compile', 'chat', 'provider'],
    });
    expect(r.every((x) => x.done)).toBe(true);
  });

  it('闩锁与未知 id：未知字符串不影响已知步骤判定', () => {
    const r = computeChecklist({ ...BASE, completedSteps: ['nonsense', 'write'] });
    expect(doneMap(r).write).toBe(true);
    expect(doneMap(r).project).toBe(false);
  });

  it('probeLiveStepIds：只含实时信号为真的步骤（与 computeChecklist 的探测部分一致）', () => {
    expect(probeLiveStepIds(BASE)).toEqual([]);
    expect(
      probeLiveStepIds({
        files: { 'main.tex': '' },
        dirty: true,
        compileLog: ['x'],
        agentSessions: 1,
        providers: 1,
      }),
    ).toEqual(['project', 'write', 'compile', 'chat', 'provider']);
    expect(probeLiveStepIds({ files: {}, dirty: false, compileLog: [], agentSessions: 1, providers: 0 })).toEqual(['chat']);
  });

  it('main.tex 值为空字符串也算「已有项目」（in 判定而非真值判定）', () => {
    expect(doneMap(computeChecklist({ ...BASE, files: { 'main.tex': '' } })).project).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 组件
// ---------------------------------------------------------------------------

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let setSidebarTab: ReturnType<typeof vi.fn>;
let setTemplateWizardOpen: ReturnType<typeof vi.fn>;
let requestZipPicker: ReturnType<typeof vi.fn>;

function query(selector: string): HTMLElement | null {
  return container!.querySelector<HTMLElement>(selector);
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function mount() {
  await act(async () => {
    root!.render(<GettingStarted />);
  });
  await act(async () => {});
}

async function remount() {
  await act(async () => {
    root!.render(<div />);
  });
  await mount();
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useOnboardingStore.getState().resetAll();
  useSettingsStore.setState({ language: 'zh', providers: [] });

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
    files: { 'main.tex': '\\documentclass{article}' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
    dirty: false,
  });
  useAgentHubStore.setState({ sessions: [], activeSessionId: null, runs: [], completedRuns: [] });

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

describe('GettingStarted · 渲染与进度', () => {
  it('默认渲染 5 行（demo 有 main.tex → project 完成），进度 1/5 与进度条 aria', async () => {
    await mount();
    const rows = [...container!.querySelectorAll('.sf-gs-step')];
    expect(rows).toHaveLength(5);
    expect(query('.sf-gs-progress')?.textContent).toContain('1 / 5');
    expect(query('.sf-gs-bar')?.getAttribute('aria-valuenow')).toBe('1');
    expect(query('.sf-gs-bar-fill')?.style.width).toBe('20%');

    const project = rows[0]!;
    expect(project.getAttribute('data-done')).toBe('true');
    expect(project.querySelector('.sf-gs-check')?.textContent).toContain('✓');
    expect(project.querySelector('.sf-gs-step-desc')?.textContent).toContain('已有项目');
    expect(project.querySelector('.sf-gs-action')).toBeNull(); // 完成行无行动按钮
  });

  it('未完成行带行动按钮：write/compile/chat/provider 各一个；project 完成时无按钮', async () => {
    await mount();
    const btns = [...container!.querySelectorAll<HTMLButtonElement>('.sf-gs-action, .sf-gs-action-alt')];
    expect(btns).toHaveLength(4); // project 已完成（demo 有 main.tex），write/compile/chat/provider 各 1
    const byStep = [...container!.querySelectorAll('.sf-gs-step')];
    expect(byStep[0]!.querySelectorAll('button.sf-btn')).toHaveLength(0);
    for (const idx of [1, 2, 3, 4]) {
      expect(byStep[idx]!.querySelectorAll('button.sf-btn').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('全部完成后不再渲染', async () => {
    await mount();
    act(() => {
      useWorkspaceStore.setState({ dirty: true, compileLog: ['▶ x'] });
      useAgentHubStore.setState({
        sessions: [{ id: 's1', title: 't', messages: [], providerId: 'p', status: 'idle' }],
      });
      useSettingsStore.setState({ providers: [{ id: 'p1', label: 'x', baseUrl: 'u', apiKey: 'k', model: 'm', tier: 'cheap' }] });
    });
    await act(async () => {});
    expect(container!.querySelector('.sf-gs')).toBeNull();
  });

  it('checklistDismissed 后不再渲染', async () => {
    useOnboardingStore.getState().dismissChecklist();
    await mount();
    expect(container!.querySelector('.sf-gs')).toBeNull();
  });
});

describe('GettingStarted · 行动按钮接线', () => {
  it('project：从模板新建 → setTemplateWizardOpen(true)；导入 zip → requestZipPicker', async () => {
    act(() => {
      useWorkspaceStore.setState({ files: {}, entry: '', projectName: '' });
    });
    await mount();
    const projectRow = query('.sf-gs-step[data-step="project"]')!;
    const [newBtn, importBtn] = [...projectRow.querySelectorAll<HTMLButtonElement>('.sf-gs-action, .sf-gs-action-alt')];
    click(newBtn!);
    expect(setTemplateWizardOpen).toHaveBeenCalledWith(true);
    click(importBtn!);
    expect(requestZipPicker).toHaveBeenCalledTimes(1);
  });

  it('write：去写作 → 跳文件树（setSidebarTab files）', async () => {
    await mount();
    click(query('.sf-gs-step[data-step="write"] .sf-gs-action')!);
    expect(setSidebarTab).toHaveBeenCalledWith('files');
  });

  it('compile：立即编译 → runCompile', async () => {
    await mount();
    click(query('.sf-gs-step[data-step="compile"] .sf-gs-action')!);
    expect(runCompile).toHaveBeenCalledTimes(1);
  });

  it('chat：问一个问题 → sendChatMessage（非空示例提问）', async () => {
    await mount();
    click(query('.sf-gs-step[data-step="chat"] .sf-gs-action')!);
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(sendChatMessage).mock.calls[0]![0];
    expect(typeof arg).toBe('string');
    expect(arg.length).toBeGreaterThan(0);
  });

  it('provider：去配置 → 派发 Ctrl+, 全局快捷键事件（App 监听后打开设置）', async () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    await mount();
    click(query('.sf-gs-step[data-step="provider"] .sf-gs-action')!);
    const events = spy.mock.calls.map((c) => c[0]).filter((e): e is KeyboardEvent => e instanceof KeyboardEvent);
    const kb = events.find((e) => e.key === ',');
    expect(kb).toBeTruthy();
    expect(kb!.ctrlKey).toBe(true);
    spy.mockRestore();
  });

  it('openSettingsViaShortcut：直接调用同样派发 Ctrl+, keydown', () => {
    const spy = vi.spyOn(window, 'dispatchEvent');
    openSettingsViaShortcut();
    const kb = spy.mock.calls.map((c) => c[0]).find((e): e is KeyboardEvent => e instanceof KeyboardEvent && e.key === ',');
    expect(kb?.ctrlKey).toBe(true);
    spy.mockRestore();
  });
});

describe('GettingStarted · 闩锁与收起/不再显示', () => {
  it('dirty 变真 → markStep("write") 持久化；dirty 复位后仍显示为完成', async () => {
    await mount();
    act(() => {
      useWorkspaceStore.setState({ dirty: true });
    });
    await act(async () => {});
    expect(useOnboardingStore.getState().completedSteps).toContain('write');
    expect(JSON.parse(localStorage.getItem('sf-onboarding')!).completedSteps).toContain('write');

    act(() => {
      useWorkspaceStore.setState({ dirty: false });
    });
    await act(async () => {});
    expect(query('.sf-gs-step[data-step="write"]')?.getAttribute('data-done')).toBe('true');
  });

  it('compileLog 非空 → compile 闩锁；agent 会话出现 → chat 闩锁', async () => {
    await mount();
    act(() => {
      useWorkspaceStore.setState({ compileLog: ['▶ 开始编译 main.tex'] });
      useAgentHubStore.setState({
        sessions: [{ id: 's1', title: 't', messages: [], providerId: 'p', status: 'idle' }],
      });
    });
    await act(async () => {});
    expect(useOnboardingStore.getState().completedSteps).toEqual(expect.arrayContaining(['compile', 'chat']));
  });

  it('收起：本次会话隐藏、显示「展开新手清单」可恢复', async () => {
    await mount();
    click(query('.sf-gs-collapse')!);
    expect(container!.querySelector('.sf-gs')).toBeNull();
    expect(query('.sf-gs-expand')?.textContent).toContain('展开新手清单');
    click(query('.sf-gs-expand')!);
    expect(container!.querySelector('.sf-gs')).toBeTruthy();
  });

  it('不再显示：dismissChecklist 持久化（localStorage），重挂载后不渲染', async () => {
    await mount();
    click(query('.sf-gs-dismiss')!);
    expect(useOnboardingStore.getState().checklistDismissed).toBe(true);
    expect(JSON.parse(localStorage.getItem('sf-onboarding')!).checklistDismissed).toBe(true);
    await remount();
    expect(container!.querySelector('.sf-gs')).toBeNull();
  });
});

describe('GettingStarted · i18n', () => {
  it('en 字典：标题、步骤与按钮均为英文', async () => {
    useSettingsStore.setState({ language: 'en' });
    await mount();
    expect(query('.sf-gs-title')?.textContent).toBe('Get started');
    expect(query('.sf-gs-step[data-step="write"] .sf-gs-step-title')?.textContent).toBe('Write your first paragraph');
    expect(query('.sf-gs-step[data-step="write"] .sf-gs-action')?.textContent).toBe('Start writing');
    expect(query('.sf-gs-step[data-step="project"] .sf-gs-step-desc')?.textContent).toBe('Project ready');
    expect(query('.sf-gs-collapse')?.textContent).toBe('Collapse');
  });
});
