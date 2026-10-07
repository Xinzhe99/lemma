// @vitest-environment jsdom
/**
 * WorkflowLauncher 测试（工作流透明化）。测试环境说明同 GettingStarted.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现（本组件依赖 settingsStore 的语言）。
 * 覆盖验收路径：
 *  - 「流程与提示词」区块默认折叠；展开后每步渲染序号/id/modelTier chip/checkpoint 标记/
 *    dependsOn 与当前生效 prompt（textarea，覆盖 ?? 原文）；
 *  - 无覆盖时不出现「已修改」chip，「全部还原」禁用；
 *  - 编辑 textarea →「已修改」chip 与单步「还原」立即出现，防抖（500ms）后写入
 *    workflowOverrides 并持久化 localStorage（sf-workflow-overrides）；
 *  - 改回与原文完全一致 → 防抖提交时按还原处理；
 *  - 挂载时展示既有覆盖值；单步「还原」回退原文并清覆盖；「全部还原」清空整个工作流
 *    且不影响其它工作流的覆盖；
 *  - 卸载时冲刷未保存的编辑（不丢改动）；
 *  - 零回归：变量表单提交照常合并回调。
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

import { WorkflowLauncher } from './WorkflowLauncher';
import { useSettingsStore } from '../state/settingsStore';
import {
  WORKFLOW_OVERRIDES_STORAGE_KEY,
  getWorkflowOverrides,
  setStepOverride,
  __resetWorkflowOverridesForTests,
} from '../state/workflowOverrides';
import type { WorkflowDef } from '@lemma/shared';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEF: WorkflowDef = {
  id: 'wf-ui-test',
  name: '测试工作流',
  description: '测试用定义',
  inputs: ['target'],
  steps: [
    { id: 'analyze', name: '分析', prompt: '原始提示词A（目标：{{target}}）', modelTier: 'cheap' },
    { id: 'apply', name: '应用', prompt: '原始提示词B', modelTier: 'flagship', checkpoint: true, dependsOn: ['analyze'] },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onSubmit: ReturnType<typeof vi.fn>;
let onCancel: ReturnType<typeof vi.fn>;

function query<T extends Element = HTMLElement>(selector: string): T | null {
  return container!.querySelector<T>(selector);
}

function queryAll(selector: string): HTMLElement[] {
  return Array.from(container!.querySelectorAll(selector));
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(def: WorkflowDef = DEF) {
  await act(async () => {
    root!.render(<WorkflowLauncher def={def} onSubmit={onSubmit} onCancel={onCancel} />);
  });
  await act(async () => {});
}

function promptAreas(): HTMLTextAreaElement[] {
  return queryAll('.sf-wf-launcher-step-prompt') as HTMLTextAreaElement[];
}

function revertButtons(): HTMLButtonElement[] {
  return queryAll('.sf-wf-launcher-step-actions .sf-link-btn') as HTMLButtonElement[];
}

function revertAllButton(): HTMLButtonElement {
  return query('.sf-wf-launcher-steps-footer button') as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
  __resetWorkflowOverridesForTests();
  useSettingsStore.setState({ language: 'zh' });
  onSubmit = vi.fn();
  onCancel = vi.fn();
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root!.unmount();
  });
  container!.remove();
  container = null;
  root = null;
});

describe('WorkflowLauncher · 流程与提示词区块', () => {
  it('Esc 等同取消：回调 onCancel，不提交', async () => {
    await mount();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('默认折叠；展开后每步展示序号/id/modelTier/checkpoint/dependsOn 与原文 prompt', async () => {
    await mount();
    const details = query('details[data-wf-steps]') as HTMLDetailsElement;
    expect(details).toBeTruthy();
    expect(details.open).toBe(false);

    click(details.querySelector('summary')!);
    expect(details.open).toBe(true);

    const cards = queryAll('.sf-wf-launcher-step');
    expect(cards.map((c) => c.getAttribute('data-step-id'))).toEqual(['analyze', 'apply']);
    expect(cards[0].textContent).toContain('analyze');
    expect(cards[0].textContent).toContain('cheap');
    expect(cards[1].textContent).toContain('flagship');
    expect(cards[1].textContent).toContain('↺');
    expect(cards[1].textContent).toContain('人工检查点');
    expect(cards[1].textContent).toContain('依赖：analyze');
    expect(cards[0].textContent).not.toContain('依赖');

    const areas = promptAreas();
    expect(areas.map((a) => a.value)).toEqual(['原始提示词A（目标：{{target}}）', '原始提示词B']);
  });

  it('无覆盖时：无「已修改」chip 与单步还原按钮，「全部还原」禁用', async () => {
    await mount();
    expect(query('[data-wf-steps]')!.textContent).not.toContain('已修改');
    expect(revertButtons()).toHaveLength(0);
    expect(revertAllButton().disabled).toBe(true);
  });

  it('编辑 prompt：「已修改」chip 立即出现，防抖后写入覆盖层并持久化', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      typeInto(promptAreas()[0], '改写后的提示词A');
      expect(query('[data-wf-steps]')!.textContent).toContain('已修改');
      expect(revertAllButton().disabled).toBe(false);
      // 防抖窗口内尚未落盘
      expect(getWorkflowOverrides()['wf-ui-test']).toBeUndefined();

      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(getWorkflowOverrides()['wf-ui-test']?.analyze).toBe('改写后的提示词A');
      expect(JSON.parse(localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY)!)).toEqual({
        'wf-ui-test': { analyze: '改写后的提示词A' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('改回与原文完全一致：防抖提交时按还原处理（不落覆盖）', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      const area = promptAreas()[0];
      typeInto(area, '临时修改');
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(getWorkflowOverrides()['wf-ui-test']?.analyze).toBe('临时修改');

      typeInto(area, '原始提示词A（目标：{{target}}）');
      act(() => {
        vi.advanceTimersByTime(600);
      });
      expect(getWorkflowOverrides()['wf-ui-test']).toBeUndefined();
      expect(promptAreas()[0].value).toBe('原始提示词A（目标：{{target}}）');
    } finally {
      vi.useRealTimers();
    }
  });

  it('挂载时显示既有覆盖值（覆盖 ?? 原文）与修改计数', async () => {
    setStepOverride(DEF.id, 'analyze', '预置覆盖A');
    setStepOverride(DEF.id, 'apply', '预置覆盖B');
    await mount();
    expect(promptAreas().map((a) => a.value)).toEqual(['预置覆盖A', '预置覆盖B']);
    expect(query('[data-wf-steps]')!.textContent).toContain('2 步已修改');
    expect(revertAllButton().disabled).toBe(false);
  });

  it('单步「还原」：textarea 回退原文并移除该步覆盖，其余步骤不受影响', async () => {
    setStepOverride(DEF.id, 'analyze', '预置覆盖A');
    setStepOverride(DEF.id, 'apply', '预置覆盖B');
    await mount();
    click(revertButtons()[1]);
    expect(promptAreas()[1].value).toBe('原始提示词B');
    expect(getWorkflowOverrides()['wf-ui-test']).toEqual({ analyze: '预置覆盖A' });
    expect(query('[data-wf-steps]')!.textContent).toContain('1 步已修改');
    expect(revertButtons()).toHaveLength(1);
  });

  it('「全部还原」：清空整个工作流的覆盖，不影响其它工作流', async () => {
    setStepOverride(DEF.id, 'analyze', '预置覆盖A');
    setStepOverride('wf-other', 's1', '别的不要动');
    await mount();
    click(revertAllButton());
    expect(getWorkflowOverrides()).toEqual({ 'wf-other': { s1: '别的不要动' } });
    expect(promptAreas().map((a) => a.value)).toEqual(['原始提示词A（目标：{{target}}）', '原始提示词B']);
    expect(revertAllButton().disabled).toBe(true);
    expect(query('[data-wf-steps]')!.textContent).not.toContain('已修改');
  });

  it('卸载时冲刷未保存的编辑（防抖窗口内关闭对话框也不丢改动）', async () => {
    vi.useFakeTimers();
    try {
      await mount();
      typeInto(promptAreas()[0], '关掉也要保存');
      // 不推进防抖定时器，直接卸载
      act(() => {
        root!.unmount();
      });
      expect(getWorkflowOverrides()['wf-ui-test']?.analyze).toBe('关掉也要保存');
      // 重建 root 供 afterEach 清理
      root = createRoot(container!);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('WorkflowLauncher · 变量表单零回归', () => {
  it('提交：presetVars 与表单值照常合并回调，新区块不影响启动', async () => {
    await mount();
    click(query('.sf-btn--primary')!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ target: 'NeurIPS' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
