// @vitest-environment jsdom
/**
 * UsagePanel 组件测试。测试环境说明同 StatsDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现，避免根 react@19 混渲染。
 * 覆盖：本月调用与 kind 分布条形、上月事件不进本月统计但进时间线、估算成本大数字
 * 与「估算，非账单」标注、预算进度（50% / 超 100% 变红 / 未设置）、预算设置输入
 * （保存与留空清除）、近 20 条事件（新的在前、含 model/token/延迟）、zh/en 切换、
 * 清空记录、Esc/按钮关闭。
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

import { UsagePanel } from './UsagePanel';
import { useAgentUsageStore, type AgentUsageEvent } from '../state/agentUsage';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = Date.now();

function ev(patch: Partial<AgentUsageEvent> & { kind: AgentUsageEvent['kind'] }): AgentUsageEvent {
  return { ts: NOW, ...patch };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function render(): void {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<UsagePanel onClose={onClose} />);
  });
}

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

function kindRows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-usage-kind-row')];
}

function eventRows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-usage-event-row')];
}

beforeEach(() => {
  onClose = vi.fn();
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  useAgentUsageStore.setState({ events: [], monthlyBudgetUsd: undefined });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('UsagePanel · 本月概览与分布', () => {
  it('本月调用总数与 kind 分布条形（计数与相对宽度）', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'chat' }), ev({ kind: 'chat' }), ev({ kind: 'research' })],
    });
    render();
    expect(container!.textContent).toContain('本月调用');
    expect(container!.querySelector('.sf-usage-total-calls')!.textContent).toContain('3');

    const rows = kindRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.querySelector('.sf-usage-kind-label')!.textContent).toBe('会话');
    expect(rows[0]!.querySelector('.sf-usage-kind-count')!.textContent).toBe('2');
    expect(rows[0]!.querySelector<HTMLElement>('.sf-usage-kind-bar')!.style.width).toBe('100%'); // 满刻度
    expect(rows[1]!.querySelector('.sf-usage-kind-label')!.textContent).toBe('并行研究');
    expect(rows[1]!.querySelector('.sf-usage-kind-count')!.textContent).toBe('1');
    expect(rows[1]!.querySelector<HTMLElement>('.sf-usage-kind-bar')!.style.width).toBe('50%');
  });

  it('上月事件不计入本月统计，但保留在近 20 条时间线里', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'chat', ts: NOW - 45 * 24 * 3600 * 1000 }), ev({ kind: 'tool' })],
    });
    render();
    expect(container!.querySelector('.sf-usage-total-calls')!.textContent).toContain('1'); // 只剩本月 tool
    const rows = kindRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector('.sf-usage-kind-label')!.textContent).toBe('工具');
    expect(eventRows()).toHaveLength(2); // 时间线取全历史
  });

  it('无记录时显示空态占位', () => {
    render();
    expect(container!.textContent).toContain('本月暂无调用记录');
    expect(kindRows()).toHaveLength(0);
  });
});

describe('UsagePanel · 估算成本', () => {
  it('大数字按档位估算并诚实标注「估算，非账单」', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'chat', model: 'deepseek-reasoner', inputTokens: 1000, outputTokens: 1000 })],
    });
    render();
    expect(container!.querySelector('.sf-usage-est-cost')!.textContent).toBe('$0.0180'); // 3e-3 + 1.5e-2
    expect(container!.querySelector('.sf-usage-est-note')!.textContent).toContain('估算，非账单');
  });
});

describe('UsagePanel · 预算进度与设置', () => {
  it('预算内：百分比 + 强调色进度条 + aria', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'chat', model: 'deepseek-reasoner', inputTokens: 1000, outputTokens: 1000 })], // $0.018
      monthlyBudgetUsd: 0.036,
    });
    render();
    expect(container!.querySelector('.sf-usage-budget-pct')!.textContent).toBe('50%');
    const fill = container!.querySelector<HTMLElement>('.sf-usage-budget-fill')!;
    expect(fill.style.width).toBe('50%');
    expect(fill.style.background).toContain('var(--accent)');
    expect(container!.querySelector<HTMLElement>('.sf-usage-budget-track')!.getAttribute('aria-valuenow')).toBe('50');
    expect(container!.textContent).not.toContain('已超预算');
  });

  it('超预算变红：⚠️ 提示 + var(--err) 填充 + 宽度封顶 100%', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'chat', model: 'deepseek-reasoner', inputTokens: 1000, outputTokens: 1000 })], // $0.018
      monthlyBudgetUsd: 0.001,
    });
    render();
    const pct = container!.querySelector<HTMLElement>('.sf-usage-budget-pct')!;
    expect(pct.textContent).toContain('已超预算');
    expect(pct.textContent).toContain('1800%');
    expect(pct.style.color).toContain('var(--err)');
    const fill = container!.querySelector<HTMLElement>('.sf-usage-budget-fill')!;
    expect(fill.style.width).toBe('100%');
    expect(fill.style.background).toContain('var(--err)');
  });

  it('未设置预算：占位文案 + 空进度条', () => {
    render();
    expect(container!.querySelector('.sf-usage-budget-none')!.textContent).toContain('未设置预算');
    const track = container!.querySelector<HTMLElement>('.sf-usage-budget-track')!;
    expect(track.getAttribute('aria-valuenow')).toBe('0');
    expect(container!.querySelector<HTMLElement>('.sf-usage-budget-fill')!.style.width).toBe('0%');
  });

  it('预算设置：输入保存生效；留空保存清除', () => {
    render();
    const input = container!.querySelector<HTMLInputElement>('.sf-usage-budget-input')!;
    expect(input.value).toBe('');
    type(input, '12');
    click(findButton('保存'));
    expect(useAgentUsageStore.getState().monthlyBudgetUsd).toBe(12);
    expect(input.value).toBe('12');
    type(input, '');
    click(findButton('保存'));
    expect(useAgentUsageStore.getState().monthlyBudgetUsd).toBeUndefined();
  });
});

describe('UsagePanel · 近 20 条事件时间线', () => {
  it('最多展示 20 条且新的在前', () => {
    const events: AgentUsageEvent[] = Array.from({ length: 25 }, (_, i) =>
      ev({ kind: 'chat', model: `m${i}`, ts: NOW - (24 - i) * 1000 }),
    );
    useAgentUsageStore.setState({ events });
    render();
    const rows = eventRows();
    expect(rows).toHaveLength(20);
    expect(rows[0]!.querySelector('.sf-usage-event-desc')!.textContent).toContain('m24'); // 最新在前
    expect(rows[0]!.querySelector('.sf-usage-event-desc')!.textContent).not.toContain('m5');
    expect(rows[19]!.querySelector('.sf-usage-event-desc')!.textContent).toContain('m5'); // 窗口内最旧
    expect(container!.textContent).not.toContain('m0'); // m0–m4 已滚出窗口
  });

  it('事件行含 kind / model / token 上下行 / 延迟', () => {
    useAgentUsageStore.setState({
      events: [ev({ kind: 'research', model: 'glm-4.6', inputTokens: 120, outputTokens: 80, latencyMs: 2100 })],
    });
    render();
    const desc = eventRows()[0]!.querySelector('.sf-usage-event-desc')!.textContent ?? '';
    expect(desc).toContain('并行研究');
    expect(desc).toContain('glm-4.6');
    expect(desc).toContain('↑120/↓80');
    expect(desc).toContain('延迟 2100ms');
  });
});

describe('UsagePanel · 语言与交互', () => {
  it('en 语言：标题与 kind 标签切换为英文', () => {
    useSettingsStore.setState({ language: 'en' });
    useAgentUsageStore.setState({ events: [ev({ kind: 'chat' })] });
    render();
    expect(container!.textContent).toContain('Agent usage & cost');
    expect(container!.querySelector('.sf-usage-kind-label')!.textContent).toBe('Chat');
  });

  it('清空记录按钮清空事件（预算保留）', () => {
    useAgentUsageStore.setState({ events: [ev({ kind: 'chat' })], monthlyBudgetUsd: 5 });
    render();
    click(findButton('清空记录'));
    const s = useAgentUsageStore.getState();
    expect(s.events).toEqual([]);
    expect(s.monthlyBudgetUsd).toBe(5);
  });

  it('关闭按钮与 Esc 均触发 onClose', () => {
    render();
    click(findButton('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
