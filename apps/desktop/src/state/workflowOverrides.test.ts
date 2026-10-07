// @vitest-environment jsdom
/**
 * 工作流覆盖层测试（工作流透明化）：
 *  - workflowOverrides store：读/写/还原（null / 空 / 纯空白）、持久化往返与宽容恢复、
 *    订阅通知（无变化不通知、退订后不通知）、resetWorkflowOverrides 工作流隔离；
 *  - applyWorkflowOverrides 纯函数：覆盖步生成新对象、未覆盖步保持原引用、
 *    未知 stepId / 与原文相同 / 空覆盖值忽略、无覆盖时零行为差异。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDef } from '@lemma/shared';
import {
  WORKFLOW_OVERRIDES_STORAGE_KEY,
  STEP_PROMPT_MAX,
  applyWorkflowOverrides,
  getWorkflowOverrides,
  loadPersistedOverrides,
  resetWorkflowOverrides,
  setStepOverride,
  subscribeWorkflowOverrides,
  __resetWorkflowOverridesForTests,
  type WorkflowOverrides,
} from './workflowOverrides';

beforeEach(() => {
  localStorage.clear();
  __resetWorkflowOverridesForTests();
});

describe('workflowOverrides store', () => {
  it('初始为空表', () => {
    expect(getWorkflowOverrides()).toEqual({});
  });

  it('setStepOverride：写入并同步持久化到 sf-workflow-overrides', () => {
    setStepOverride('wf-a', 's1', '改写后的提示词');
    expect(getWorkflowOverrides()).toEqual({ 'wf-a': { s1: '改写后的提示词' } });
    expect(JSON.parse(localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY)!)).toEqual({
      'wf-a': { s1: '改写后的提示词' },
    });
  });

  it('同一工作流多个步骤覆盖合并存储；不同工作流互不干扰', () => {
    setStepOverride('wf-a', 's1', 'A1');
    setStepOverride('wf-a', 's2', 'A2');
    setStepOverride('wf-b', 's1', 'B1');
    expect(getWorkflowOverrides()).toEqual({
      'wf-a': { s1: 'A1', s2: 'A2' },
      'wf-b': { s1: 'B1' },
    });
  });

  it('setStepOverride(…, null)：还原单步；最后一个覆盖移除后 workflowId 键一并清掉', () => {
    setStepOverride('wf-a', 's1', 'A1');
    setStepOverride('wf-a', 's2', 'A2');
    setStepOverride('wf-a', 's1', null);
    expect(getWorkflowOverrides()['wf-a']).toEqual({ s2: 'A2' });
    setStepOverride('wf-a', 's2', null);
    expect(getWorkflowOverrides()).toEqual({});
    expect(localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY)).toBe('{}');
  });

  it('空 / 纯空白 prompt 按还原处理（引擎要求步骤 prompt 非空）', () => {
    setStepOverride('wf-a', 's1', 'x');
    setStepOverride('wf-a', 's1', '   ');
    expect(getWorkflowOverrides()).toEqual({});
    setStepOverride('wf-a', 's1', 'x');
    setStepOverride('wf-a', 's1', '');
    expect(getWorkflowOverrides()).toEqual({});
  });

  it('重复写入相同值：幂等，不重复持久化', () => {
    setStepOverride('wf-a', 's1', 'x');
    const raw = localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY);
    setStepOverride('wf-a', 's1', 'x');
    expect(localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY)).toBe(raw);
  });

  it('resetWorkflowOverrides：清空目标工作流的全部步骤覆盖，不影响其它工作流', () => {
    setStepOverride('wf-a', 's1', 'A1');
    setStepOverride('wf-b', 's1', 'B1');
    resetWorkflowOverrides('wf-a');
    expect(getWorkflowOverrides()).toEqual({ 'wf-b': { s1: 'B1' } });
  });

  it('resetWorkflowOverrides / setStepOverride(null) 对无覆盖目标为无操作', () => {
    const spy = vi.fn();
    subscribeWorkflowOverrides(spy);
    resetWorkflowOverrides('wf-a');
    setStepOverride('wf-a', 's1', null);
    expect(spy).not.toHaveBeenCalled();
  });

  it('订阅通知：写入与还原通知一次，退订后不再通知', () => {
    const spy = vi.fn();
    const unsub = subscribeWorkflowOverrides(spy);
    setStepOverride('wf-a', 's1', 'x');
    expect(spy).toHaveBeenCalledTimes(1);
    setStepOverride('wf-a', 's1', null);
    expect(spy).toHaveBeenCalledTimes(2);
    unsub();
    setStepOverride('wf-a', 's1', 'y');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('超长 prompt 截断到 STEP_PROMPT_MAX（防误贴整篇文章撑爆 localStorage）', () => {
    setStepOverride('wf-a', 's1', 'x'.repeat(STEP_PROMPT_MAX + 100));
    expect(getWorkflowOverrides()['wf-a'].s1.length).toBe(STEP_PROMPT_MAX);
  });

  it('loadPersistedOverrides：持久化往返（模拟重启后恢复）', () => {
    setStepOverride('wf-a', 's1', 'A1');
    // 独立于内存态：直接从 localStorage 重新解析
    expect(loadPersistedOverrides()).toEqual({ 'wf-a': { s1: 'A1' } });
  });

  it('loadPersistedOverrides 宽容恢复：坏 JSON / 非对象 / 值非字符串 / 空步骤表全部丢弃', () => {
    localStorage.setItem(WORKFLOW_OVERRIDES_STORAGE_KEY, '{bad json');
    expect(loadPersistedOverrides()).toEqual({});

    localStorage.setItem(WORKFLOW_OVERRIDES_STORAGE_KEY, JSON.stringify(['not', 'an object']));
    expect(loadPersistedOverrides()).toEqual({});

    localStorage.setItem(
      WORKFLOW_OVERRIDES_STORAGE_KEY,
      JSON.stringify({
        good: { s1: 'ok', s2: 42, s3: null, s4: '  ' },
        bad: 'not a map',
        empty: {},
      }),
    );
    expect(loadPersistedOverrides()).toEqual({ good: { s1: 'ok' } });
  });
});

// ---------------------------------------------------------------------------
// applyWorkflowOverrides 纯函数
// ---------------------------------------------------------------------------

function makeDef(): WorkflowDef {
  return {
    id: 'wf-x',
    name: 'X',
    description: '',
    inputs: [],
    steps: [
      { id: 's1', name: '第一步', prompt: '原 1' },
      { id: 's2', name: '第二步', prompt: '原 2', modelTier: 'flagship', checkpoint: true, dependsOn: ['s1'] },
    ],
  };
}

describe('applyWorkflowOverrides', () => {
  it('被覆盖的步骤拿到新 prompt 与新对象；def 与 steps 数组是新引用', () => {
    const def = makeDef();
    const next = applyWorkflowOverrides(def, { 'wf-x': { s1: '覆盖 1' } });
    expect(next).not.toBe(def);
    expect(next.steps).not.toBe(def.steps);
    expect(next.steps[0].prompt).toBe('覆盖 1');
    expect(next.steps[0]).not.toBe(def.steps[0]);
    expect(next.steps[0].modelTier).toBeUndefined(); // 其余字段原样保留
  });

  it('未覆盖的步骤保持原对象引用（浅克隆语义）', () => {
    const def = makeDef();
    const next = applyWorkflowOverrides(def, { 'wf-x': { s1: '覆盖 1' } });
    expect(next.steps[1]).toBe(def.steps[1]);
    expect(next.steps[1].prompt).toBe('原 2');
  });

  it('无覆盖（空表 / 无该工作流键 / undefined 步骤表）→ 所有 step 引用不变', () => {
    const def = makeDef();
    const cases: WorkflowOverrides[] = [{}, { 'wf-other': { s1: 'x' } }, { 'wf-x': {} }];
    for (const overrides of cases) {
      const next = applyWorkflowOverrides(def, overrides);
      expect(next.steps[0]).toBe(def.steps[0]);
      expect(next.steps[1]).toBe(def.steps[1]);
      expect(next.steps.map((s) => s.prompt)).toEqual(['原 1', '原 2']);
    }
  });

  it('未知 stepId / 覆盖值与原文相同 / 空·纯空白覆盖值：忽略，该步保持原引用', () => {
    const def = makeDef();
    const next = applyWorkflowOverrides(def, {
      'wf-x': { unknown: 'x', s1: '原 1', s2: '  ' },
    });
    expect(next.steps[0]).toBe(def.steps[0]);
    expect(next.steps[1]).toBe(def.steps[1]);
  });

  it('覆盖不改 id/name/checkpoint 等元信息，也不触碰 def 的其它字段', () => {
    const def = makeDef();
    const next = applyWorkflowOverrides(def, { 'wf-x': { s2: '覆盖 2' } });
    expect(next.id).toBe('wf-x');
    expect(next.inputs).toBe(def.inputs);
    expect(next.steps[1]).toMatchObject({ id: 's2', name: '第二步', modelTier: 'flagship', checkpoint: true, dependsOn: ['s1'], prompt: '覆盖 2' });
  });
});
