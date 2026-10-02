// @vitest-environment jsdom
/**
 * MemoryPanel 组件测试。测试环境说明同 SnapshotDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；mock ../dialogs（清空确认）。
 * 覆盖验收路径：三区渲染（风格偏好增删 / 审批统计卡 / 忽略建议列表）、
 * 忽略与恢复、部分采纳提示、最高频拒绝原因、总开关停用提示、清空确认（确认/取消）、zh/en 双语。
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

vi.mock('../dialogs', () => ({ confirmDialog: vi.fn(async () => true) }));

import { confirmDialog } from '../dialogs';
import { MemoryPanel } from './MemoryPanel';
import { PARTIAL_NOTE, REJECT_NO_GAIN_NOTE, useAgentMemoryStore } from '../state/agentMemory';
import { useSettingsStore } from '../state/settingsStore';

const confirmDialogMock = vi.mocked(confirmDialog);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<MemoryPanel />);
  });
}

function text(): string {
  return container!.textContent ?? '';
}

function button(label: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`button not found: ${label}`);
  return found;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function typeInput(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function resetMemory() {
  useAgentMemoryStore.setState({
    styleNotes: [],
    approvedPatterns: [],
    ignoredSuggestions: [],
    enabled: true,
  });
}

beforeEach(() => {
  localStorage.clear();
  confirmDialogMock.mockReset();
  confirmDialogMock.mockResolvedValue(true);
  useSettingsStore.setState({ language: 'zh' });
  resetMemory();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  container = null;
  root = null;
});

describe('MemoryPanel 空态与三区渲染', () => {
  it('空记忆渲染：标题 + 三区空提示，无统计卡数据', () => {
    renderPanel();
    expect(text()).toContain('Agent 记忆');
    expect(text()).toContain('风格偏好');
    expect(text()).toContain('审批统计');
    expect(text()).toContain('忽略的建议');
    expect(text()).toContain('暂无偏好');
    expect(text()).toContain('尚无审批记录');
    expect(text()).toContain('没有忽略的建议');
    expect(text()).toContain('记忆已启用');
  });

  it('添加风格偏好：输入 + 添加按钮 → 列表出现并写入 store', () => {
    renderPanel();
    const input = container!.querySelector<HTMLInputElement>('input.sf-input')!;
    typeInput(input, '只用主动语态');
    click(button('添加'));
    expect(useAgentMemoryStore.getState().styleNotes).toEqual(['只用主动语态']);
    expect(text()).toContain('只用主动语态');
  });

  it('删除风格偏好：store 同步移除', () => {
    useAgentMemoryStore.setState({ styleNotes: ['偏好 A', '偏好 B'] });
    renderPanel();
    click(button('删除'));
    expect(useAgentMemoryStore.getState().styleNotes).toEqual(['偏好 B']);
    expect(text()).not.toContain('偏好 A');
  });
});

describe('MemoryPanel 忽略建议', () => {
  it('忽略 → 移入忽略区（偏好区消失）；恢复 → 回到偏好区', () => {
    useAgentMemoryStore.setState({ styleNotes: ['偏好 A'] });
    renderPanel();
    click(button('忽略'));
    expect(useAgentMemoryStore.getState().ignoredSuggestions).toEqual(['偏好 A']);
    expect(useAgentMemoryStore.getState().styleNotes).toEqual(['偏好 A']); // 记录保留
    expect(text()).toContain('已忽略');
    expect(text()).toContain('恢复');
    click(button('恢复'));
    expect(useAgentMemoryStore.getState().ignoredSuggestions).toEqual([]);
    expect(text()).toContain('偏好 A');
    expect(text()).toContain('风格偏好'); // 偏好区仍渲染该条
  });
});

describe('MemoryPanel 审批统计卡', () => {
  it('渲染采纳率、计数与最高频拒绝原因', () => {
    useAgentMemoryStore.setState({
      approvedPatterns: [
        { ts: 2, label: 'AI 润色', via: 'demo', acceptedCount: 8, rejectedCount: 3, note: REJECT_NO_GAIN_NOTE },
      ],
    });
    renderPanel();
    expect(text()).toContain('近期采纳率 73%');
    expect(text()).toContain('8 采纳 / 3 拒绝');
    expect(text()).toContain(`最高频拒绝原因：${REJECT_NO_GAIN_NOTE}`);
  });

  it('部分采纳（保守倾向）提示', () => {
    useAgentMemoryStore.setState({
      approvedPatterns: [
        { ts: 1, label: 'AI 润色', via: 'demo', acceptedCount: 2, rejectedCount: 0, note: PARTIAL_NOTE },
      ],
    });
    renderPanel();
    expect(text()).toContain('倾向保守');
  });
});

describe('MemoryPanel 总开关与清空', () => {
  it('停用记忆：开关切换 + 停用提示', () => {
    renderPanel();
    click(button('停用记忆'));
    expect(useAgentMemoryStore.getState().enabled).toBe(false);
    expect(text()).toContain('记忆已停用');
    expect(text()).toContain('记忆已停用：偏好与统计不再注入');
    click(button('启用记忆'));
    expect(useAgentMemoryStore.getState().enabled).toBe(true);
    expect(text()).toContain('记忆已启用');
  });

  it('清空：确认后清空学习数据', async () => {
    useAgentMemoryStore.setState({
      styleNotes: ['偏好 A'],
      approvedPatterns: [{ ts: 1, label: 'L', via: 'v', acceptedCount: 1, rejectedCount: 0 }],
      ignoredSuggestions: ['偏好 B'],
    });
    renderPanel();
    await act(async () => {
      click(button('清空全部'));
    });
    expect(confirmDialogMock).toHaveBeenCalledTimes(1);
    const s = useAgentMemoryStore.getState();
    expect(s.styleNotes).toEqual([]);
    expect(s.approvedPatterns).toEqual([]);
    expect(s.ignoredSuggestions).toEqual([]);
  });

  it('清空：取消则保留数据', async () => {
    useAgentMemoryStore.setState({ styleNotes: ['偏好 A'] });
    renderPanel();
    confirmDialogMock.mockResolvedValueOnce(false);
    await act(async () => {
      click(button('清空全部'));
    });
    expect(useAgentMemoryStore.getState().styleNotes).toEqual(['偏好 A']);
  });

  it('无数据时清空按钮禁用', () => {
    renderPanel();
    expect(button('清空全部').disabled).toBe(true);
  });
});

describe('MemoryPanel 双语', () => {
  it('en 语言渲染英文文案', () => {
    useSettingsStore.setState({ language: 'en' });
    renderPanel();
    expect(text()).toContain('Agent memory');
    expect(text()).toContain('Style preferences');
    expect(text()).toContain('Approval stats');
    expect(text()).toContain('Ignored suggestions');
    expect(text()).toContain('No approvals yet');
  });
});
