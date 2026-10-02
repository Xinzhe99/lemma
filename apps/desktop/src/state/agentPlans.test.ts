/**
 * agentPlans store 单测：upsert 初始化/重置、start 重入规则（failed 可重试）、
 * finishStep/failStep/skipStep 的状态与 activeStep 清理、未知 msgId/stepId no-op、
 * clear 两种口径、planProgress/planPhase 派生。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planPhase, planProgress, useAgentPlansStore, type PlanExecution } from './agentPlans';
import type { Plan } from '../planMode';

const PLAN: Plan = {
  goal: '压缩论文到 9 页以内',
  steps: [
    { id: 's1', title: '检索文献库' },
    { id: 's2', title: '生成删减 diff' },
    { id: 's3', title: '编译验证' },
  ],
};

function seed(msgId = 'msg-1'): void {
  useAgentPlansStore.getState().upsert(msgId, PLAN);
}

function exec(msgId = 'msg-1'): PlanExecution | undefined {
  return useAgentPlansStore.getState().plans[msgId];
}

beforeEach(() => {
  useAgentPlansStore.getState().clear();
});

describe('agentPlans · 登记/重置', () => {
  it('upsert 初始化：全部步骤 pending、outputs 空、activeStep 未设', () => {
    seed();
    const e = exec()!;
    expect(e.plan).toEqual(PLAN);
    expect(e.statuses).toEqual({ s1: 'pending', s2: 'pending', s3: 'pending' });
    expect(e.outputs).toEqual({});
    expect(e.activeStep).toBeUndefined();
    expect(e.createdAt).toBeGreaterThan(0);
  });

  it('重复 upsert 同一 msgId 整份重置（旧进度不残留）', () => {
    seed();
    useAgentPlansStore.getState().start('msg-1', 's1');
    useAgentPlansStore.getState().finishStep('msg-1', 's1', '产出A');
    seed(); // 重置
    expect(exec()!.statuses.s1).toBe('pending');
    expect(exec()!.outputs).toEqual({});
  });

  it('多条计划并存（不同 msgId 互不干扰）', () => {
    seed('msg-1');
    seed('msg-2');
    useAgentPlansStore.getState().finishStep('msg-2', 's1', 'x');
    expect(exec('msg-1')!.statuses.s1).toBe('pending');
    expect(exec('msg-2')!.statuses.s1).toBe('done');
  });
});

describe('agentPlans · 状态推进', () => {
  it('start 置 running 并设 activeStep', () => {
    seed();
    useAgentPlansStore.getState().start('msg-1', 's2');
    expect(exec()!.statuses.s2).toBe('running');
    expect(exec()!.activeStep).toBe('s2');
  });

  it('done/skipped 步骤 start 不可重入；failed 步骤可重试（重置 running）', () => {
    seed();
    useAgentPlansStore.getState().finishStep('msg-1', 's1', 'ok');
    useAgentPlansStore.getState().skipStep('msg-1', 's2');
    useAgentPlansStore.getState().start('msg-1', 's1');
    useAgentPlansStore.getState().start('msg-1', 's2');
    expect(exec()!.statuses.s1).toBe('done');
    expect(exec()!.statuses.s2).toBe('skipped');
    expect(exec()!.activeStep).toBeUndefined();

    useAgentPlansStore.getState().failStep('msg-1', 's3', '超时');
    useAgentPlansStore.getState().start('msg-1', 's3'); // 重试
    expect(exec()!.statuses.s3).toBe('running');
    expect(exec()!.activeStep).toBe('s3');
  });

  it('finishStep 记录产出并清 activeStep（非本步的 activeStep 保留）', () => {
    seed();
    useAgentPlansStore.getState().start('msg-1', 's1');
    useAgentPlansStore.getState().finishStep('msg-1', 's1', '检索到 3 处重复');
    expect(exec()!.statuses.s1).toBe('done');
    expect(exec()!.outputs.s1).toBe('检索到 3 处重复');
    expect(exec()!.activeStep).toBeUndefined();
  });

  it('failStep 置 failed、失败原因进 outputs、清 activeStep', () => {
    seed();
    useAgentPlansStore.getState().start('msg-1', 's2');
    useAgentPlansStore.getState().failStep('msg-1', 's2', '接口超时');
    expect(exec()!.statuses.s2).toBe('failed');
    expect(exec()!.outputs.s2).toBe('接口超时');
    expect(exec()!.activeStep).toBeUndefined();
  });

  it('skipStep 置 skipped 且保留既有 outputs（供回看）', () => {
    seed();
    useAgentPlansStore.getState().finishStep('msg-1', 's1', 'ok');
    useAgentPlansStore.getState().skipStep('msg-1', 's2');
    expect(exec()!.statuses.s2).toBe('skipped');
    expect(exec()!.statuses.s1).toBe('done');
    expect(exec()!.outputs.s1).toBe('ok');
  });

  it('未知 msgId 或不在计划内的 stepId 全部 no-op（不抛错）', () => {
    seed();
    useAgentPlansStore.getState().start('ghost', 's1');
    useAgentPlansStore.getState().finishStep('msg-1', 'sX', 'x');
    useAgentPlansStore.getState().failStep('msg-1', 'sX', 'x');
    useAgentPlansStore.getState().skipStep('msg-1', 'sX');
    expect(exec()!.statuses).toEqual({ s1: 'pending', s2: 'pending', s3: 'pending' });
    expect(exec()!.activeStep).toBeUndefined();
  });

  it('clear() 清空全部；clear(msgId) 只清该条', () => {
    seed('msg-1');
    seed('msg-2');
    useAgentPlansStore.getState().clear('msg-1');
    expect(exec('msg-1')).toBeUndefined();
    expect(exec('msg-2')).toBeDefined();
    useAgentPlansStore.getState().clear();
    expect(useAgentPlansStore.getState().plans).toEqual({});
  });

  it('不持久化：store 无 localStorage 写入（会话级状态，重启丢弃）', () => {
    seed();
    // jsdom 环境下 spy localStorage.setItem；node 环境该 API 不存在则跳过断言
    if (typeof localStorage !== 'undefined') {
      const spy = vi.fn();
      const orig = localStorage.setItem.bind(localStorage);
      localStorage.setItem = spy as typeof localStorage.setItem;
      useAgentPlansStore.getState().upsert('msg-9', PLAN);
      localStorage.setItem = orig;
      expect(spy).not.toHaveBeenCalled();
    }
  });
});

describe('planProgress / planPhase 派生', () => {
  it('planProgress：done+skipped 计入 N，给出 skipped 明细', () => {
    seed();
    expect(planProgress(exec()!)).toEqual({ done: 0, total: 3, skipped: 0 });
    useAgentPlansStore.getState().finishStep('msg-1', 's1', 'a');
    useAgentPlansStore.getState().skipStep('msg-1', 's2');
    expect(planProgress(exec()!)).toEqual({ done: 1, total: 3, skipped: 1 });
  });

  it('planPhase 四相位：awaiting → running → failed / finished；部分完成后仍算 running（可续跑）', () => {
    seed();
    expect(planPhase(exec()!)).toBe('awaiting');
    useAgentPlansStore.getState().start('msg-1', 's1');
    expect(planPhase(exec()!)).toBe('running');
    useAgentPlansStore.getState().failStep('msg-1', 's1', 'x');
    expect(planPhase(exec()!)).toBe('failed');
    // 失败被跳过后：部分 done/skipped + pending → running（可从下一步续跑）
    useAgentPlansStore.getState().skipStep('msg-1', 's1');
    expect(planPhase(exec()!)).toBe('running');
    useAgentPlansStore.getState().finishStep('msg-1', 's2', 'a');
    useAgentPlansStore.getState().finishStep('msg-1', 's3', 'b');
    expect(planPhase(exec()!)).toBe('finished');
  });
});
