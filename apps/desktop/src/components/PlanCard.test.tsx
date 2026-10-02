// @vitest-environment jsdom
/**
 * 测试环境说明同 StatusBar.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现
 * （语义与真实 zustand 一致），避免根 react@19 与 apps/desktop react@18 混渲染。
 * PlanCard 为自包含展示组件：execution 以字面量构造，动作用 spy 回调断言。
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

import { PlanCard, PLAN_CARD_STRINGS } from './PlanCard';
import { useSettingsStore } from '../state/settingsStore';
import type { PlanExecution } from '../state/agentPlans';
import type { Plan } from '../planMode';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PLAN: Plan = {
  goal: '压缩论文到 9 页以内',
  steps: [
    { id: 's1', title: '检索文献库', detail: '找可压缩段落', usesTools: ['library.search_fulltext'] },
    { id: 's2', title: '生成删减 diff', usesTools: ['tex.edit'] },
    { id: 's3', title: '编译验证' },
  ],
};

/** 构造执行态：statuses 覆盖（缺省 pending）、outputs 注入 */
function executionOf(
  statuses: Record<string, PlanExecution['statuses'][string]>,
  outputs: Record<string, string> = {},
): PlanExecution {
  return {
    plan: PLAN,
    statuses: { s1: 'pending', s2: 'pending', s3: 'pending', ...statuses },
    outputs,
    createdAt: 1_000,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

interface Callbacks {
  onApprove?: () => void;
  onSkip?: (stepId: string) => void;
  onAbort?: () => void;
  onRetry?: (stepId: string) => void;
}

function renderCard(execution: PlanExecution, cb: Callbacks = {}, lang?: 'zh' | 'en'): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <PlanCard
        msgId="m1"
        execution={execution}
        onApprove={cb.onApprove}
        onSkip={cb.onSkip}
        onAbort={cb.onAbort}
        onRetry={cb.onRetry}
        lang={lang}
      />,
    );
  });
}

function text(): string {
  return container?.textContent ?? '';
}

function query<K extends HTMLElement>(sel: string): K {
  const el = container!.querySelector<K>(sel);
  expect(el, `未找到 ${sel}`).toBeTruthy();
  return el as K;
}

beforeEach(() => {
  useSettingsStore.setState({ language: 'zh' });
});

function unmountCard(): void {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
}

afterEach(() => {
  unmountCard();
});

describe('PlanCard · 各相位渲染', () => {
  it('awaiting：goal 标题、0/3 进度、全 ○ 待执行、【批准并执行】黑主钮；无中止按钮', () => {
    renderCard(executionOf({}));
    expect(text()).toContain('压缩论文到 9 页以内');
    expect(text()).toContain('待批准');
    expect(query<HTMLDivElement>('.sf-plan-progress-text').textContent).toContain('0/3');
    const card = query<HTMLDivElement>('.sf-plan-card');
    expect(card.dataset.phase).toBe('awaiting');
    expect(card.dataset.msgId).toBe('m1');
    expect(text()).toContain('○');
    expect(text()).not.toContain('✓');
    const approve = query<HTMLButtonElement>('.sf-plan-approve');
    expect(approve.textContent).toBe('批准并执行');
    expect(approve.className).toContain('sf-btn--primary');
    expect(container!.querySelector('.sf-plan-abort')).toBeNull();
  });

  it('running：当前步 ◐ 进行中、中止按钮显示；其余步骤 ○/✓ 共存', () => {
    renderCard(executionOf({ s1: 'done', s2: 'running' }), { onAbort: vi.fn() });
    const s2 = query<HTMLLIElement>('[data-step-id="s2"]');
    expect(s2.dataset.status).toBe('running');
    expect(s2.textContent).toContain('◐');
    expect(s2.textContent).toContain('进行中');
    expect(text()).toContain('✓');
    expect(query<HTMLButtonElement>('.sf-plan-abort').textContent).toBe('中止');
    expect(container!.querySelector('.sf-plan-approve')).toBeNull();
  });

  it('failed：失败步 ✗ + err 状态、【跳过失败步】【重试该步】按钮；进度不把失败计入 N', () => {
    renderCard(executionOf({ s1: 'done', s2: 'failed' }, { s2: '接口超时' }), { onSkip: vi.fn(), onRetry: vi.fn() });
    const s2 = query<HTMLLIElement>('[data-step-id="s2"]');
    expect(s2.dataset.status).toBe('failed');
    expect(s2.textContent).toContain('✗');
    expect(query<HTMLSpanElement>('.sf-chip.err'));
    expect(query<HTMLDivElement>('.sf-plan-progress-text').textContent).toContain('1/3');
    expect(query<HTMLButtonElement>('.sf-plan-skip').textContent).toBe('跳过失败步');
    expect(query<HTMLButtonElement>('.sf-plan-retry').textContent).toBe('重试该步');
  });

  it('finished：全 ✓ 已完成、3/3、ok 状态 chip、无动作按钮', () => {
    renderCard(executionOf({ s1: 'done', s2: 'done', s3: 'done' }, { s1: 'a', s2: 'b', s3: 'c' }));
    expect(query<HTMLDivElement>('.sf-plan-card').dataset.phase).toBe('finished');
    expect(text()).toContain('已完成');
    expect(query<HTMLDivElement>('.sf-plan-progress-text').textContent).toContain('3/3');
    expect(text()).not.toContain('○');
    for (const cls of ['.sf-plan-approve', '.sf-plan-abort', '.sf-plan-skip', '.sf-plan-retry']) {
      expect(container!.querySelector(cls)).toBeNull();
    }
  });

  it('skipped 步 ⇣ 已跳过并计入进度（1 done + 1 skipped = 2/3）', () => {
    renderCard(executionOf({ s1: 'done', s2: 'skipped' }));
    const s2 = query<HTMLLIElement>('[data-step-id="s2"]');
    expect(s2.textContent).toContain('⇣');
    expect(s2.textContent).toContain('已跳过');
    expect(query<HTMLDivElement>('.sf-plan-progress-text').textContent).toContain('2/3');
  });
});

describe('PlanCard · 按钮回调与展开', () => {
  it('点击【批准并执行】触发 onApprove（一次）', () => {
    const onApprove = vi.fn();
    renderCard(executionOf({}), { onApprove });
    act(() => query<HTMLButtonElement>('.sf-plan-approve').click());
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('点击【中止】触发 onAbort；onSkip/onRetry 携带失败步骤 id', () => {
    const onAbort = vi.fn();
    renderCard(executionOf({ s1: 'running' }), { onAbort });
    act(() => query<HTMLButtonElement>('.sf-plan-abort').click());
    expect(onAbort).toHaveBeenCalledOnce();

    const onSkip = vi.fn();
    const onRetry = vi.fn();
    unmountCard();
    renderCard(executionOf({ s2: 'failed' }), { onSkip, onRetry });
    act(() => query<HTMLButtonElement>('.sf-plan-skip').click());
    expect(onSkip).toHaveBeenCalledWith('s2');
    act(() => query<HTMLButtonElement>('.sf-plan-retry').click());
    expect(onRetry).toHaveBeenCalledWith('s2');
  });

  it('点击步骤标题展开 detail/工具/产出摘要；再点收起；长产出截断 400 字', () => {
    const long = 'x'.repeat(600);
    renderCard(executionOf({ s1: 'done' }, { s1: long }));
    const s1 = query<HTMLLIElement>('[data-step-id="s1"]');
    expect(s1.textContent).not.toContain('找可压缩段落'); // 未展开：detail 不渲染
    const head = s1.querySelector<HTMLButtonElement>('.sf-plan-step-head')!;
    act(() => head.click());
    expect(s1.textContent).toContain('找可压缩段落');
    expect(s1.textContent).toContain('library.search_fulltext');
    const pre = s1.querySelector<HTMLPreElement>('.sf-plan-step-output')!;
    expect(pre.textContent!.length).toBeLessThanOrEqual(402); // 400 + 省略号
    expect(pre.textContent).toContain('…');
    act(() => head.click());
    expect(s1.textContent).not.toContain('找可压缩段落');
  });

  it('无产出步骤展开显示「（暂无产出）」占位；aria-expanded 随展开翻转', () => {
    renderCard(executionOf({}));
    const s2 = query<HTMLLIElement>('[data-step-id="s2"]');
    const head = s2.querySelector<HTMLButtonElement>('.sf-plan-step-head')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    act(() => head.click());
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(s2.textContent).toContain('（暂无产出）');
  });

  it('progressbar aria 值随进度更新（aria-valuenow=2, aria-valuemax=3）', () => {
    renderCard(executionOf({ s1: 'done', s2: 'skipped' }));
    const bar = query<HTMLDivElement>('.sf-plan-progress');
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('3');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
  });
});

describe('PlanCard · 双语', () => {
  it('lang=en：按钮与状态为英文（Approve & run / pending / done）', () => {
    renderCard(executionOf({}), {}, 'en');
    expect(query<HTMLButtonElement>('.sf-plan-approve').textContent).toBe('Approve & run');
    expect(query<HTMLLIElement>('[data-step-id="s2"]').textContent).toContain('pending');
    expect(query<HTMLDivElement>('.sf-plan-progress-text').textContent).toContain('steps');
    unmountCard();
    renderCard(executionOf({ s1: 'done', s2: 'done', s3: 'done' }), {}, 'en');
    expect(query<HTMLLIElement>('[data-step-id="s1"]').textContent).toContain('done');
    expect(text()).toContain('Finished');
  });

  it('lang 缺省跟随设置语言：设置 en 后无需 prop 也输出英文', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    renderCard(executionOf({}));
    expect(query<HTMLButtonElement>('.sf-plan-approve').textContent).toBe(
      PLAN_CARD_STRINGS.en.approve,
    );
  });
});
