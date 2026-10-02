/**
 * 计划执行状态（zustand）：计划模式的消息级执行簿。
 * plans 以「承载计划的 assistant 消息 id」为键（AgentPanel 渲染该消息时查
 * plans[msgId]，命中则叠加/替换渲染 PlanCard）。
 *
 * 持久化取舍：**不进 localStorage**——计划执行是会话级过程态（statuses/outputs
 * 与当时的会话流绑定），重启丢弃可接受；避免脏状态在下次启动复活成幽灵计划。
 * 会话消息本身也非持久化，两侧生命周期一致。
 */

import { create } from 'zustand';
import type { Plan } from '../planMode';

export type PlanStepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

/** 一条消息上的计划执行态 */
export interface PlanExecution {
  plan: Plan;
  /** stepId → 状态（全部步骤初始化为 pending） */
  statuses: Record<string, PlanStepStatus>;
  /** stepId → 本步产出（失败步存失败原因，供卡片展开查看） */
  outputs: Record<string, string>;
  /** 当前正在执行的步骤 id（无则未在执行） */
  activeStep?: string;
  createdAt: number;
}

interface AgentPlansState {
  plans: Record<string, PlanExecution>;
  /** 登记/重置一条计划（全部步骤 pending；重复 upsert 即整份重来） */
  upsert(msgId: string, plan: Plan): void;
  /** 步骤开跑：置 running + activeStep；done/skipped 步骤不可重入（failed 可重试） */
  start(msgId: string, stepId: string): void;
  /** 步骤完成：done + 记录产出；activeStep 命中时清除 */
  finishStep(msgId: string, stepId: string, output: string): void;
  /** 步骤失败：failed + 失败原因进 outputs；activeStep 命中时清除 */
  failStep(msgId: string, stepId: string, note: string): void;
  /** 跳过步骤：skipped（保留既有 outputs 供回看）；activeStep 命中时清除 */
  skipStep(msgId: string, stepId: string): void;
  /** 清理（msgId 缺省清空全部；测试与「新会话」时用） */
  clear(msgId?: string): void;
}

/** 就地更新一条执行记录（不存在或步骤不在计划内则原样返回） */
function patchExecution(
  state: AgentPlansState,
  msgId: string,
  stepId: string | null,
  patch: (e: PlanExecution) => PlanExecution,
): Partial<AgentPlansState> {
  const exec = state.plans[msgId];
  if (!exec) return {};
  if (stepId !== null && exec.plan.steps.every((s) => s.id !== stepId)) return {};
  return { plans: { ...state.plans, [msgId]: patch(exec) } };
}

export const useAgentPlansStore = create<AgentPlansState>((set) => ({
  plans: {},

  upsert: (msgId, plan) =>
    set((state) => ({
      plans: {
        ...state.plans,
        [msgId]: {
          plan,
          statuses: Object.fromEntries(plan.steps.map((s) => [s.id, 'pending' as const])),
          outputs: {},
          createdAt: Date.now(),
        },
      },
    })),

  start: (msgId, stepId) =>
    set((state) =>
      patchExecution(state, msgId, stepId, (e) => {
        if (e.statuses[stepId] === 'done' || e.statuses[stepId] === 'skipped') return e;
        return {
          ...e,
          statuses: { ...e.statuses, [stepId]: 'running' },
          activeStep: stepId,
        };
      }),
    ),

  finishStep: (msgId, stepId, output) =>
    set((state) =>
      patchExecution(state, msgId, stepId, (e) => ({
        ...e,
        statuses: { ...e.statuses, [stepId]: 'done' },
        outputs: { ...e.outputs, [stepId]: output },
        activeStep: e.activeStep === stepId ? undefined : e.activeStep,
      })),
    ),

  failStep: (msgId, stepId, note) =>
    set((state) =>
      patchExecution(state, msgId, stepId, (e) => ({
        ...e,
        statuses: { ...e.statuses, [stepId]: 'failed' },
        outputs: { ...e.outputs, [stepId]: note },
        activeStep: e.activeStep === stepId ? undefined : e.activeStep,
      })),
    ),

  skipStep: (msgId, stepId) =>
    set((state) =>
      patchExecution(state, msgId, stepId, (e) => ({
        ...e,
        statuses: { ...e.statuses, [stepId]: 'skipped' },
        activeStep: e.activeStep === stepId ? undefined : e.activeStep,
      })),
    ),

  clear: (msgId) =>
    set((state) => {
      if (msgId === undefined) return { plans: {} };
      const plans = { ...state.plans };
      delete plans[msgId];
      return { plans };
    }),
}));

/** 进度统计：N = 已完结（done + skipped）步数，M = 总步数（渲染 N/M 与进度条用） */
export function planProgress(exec: PlanExecution): { done: number; total: number; skipped: number } {
  const total = exec.plan.steps.length;
  let done = 0;
  let skipped = 0;
  for (const s of exec.plan.steps) {
    const st = exec.statuses[s.id] ?? 'pending';
    if (st === 'done') done++;
    else if (st === 'skipped') skipped++;
  }
  return { done, total, skipped };
}

/** 执行相位（按钮组渲染依据）：未开始 / 执行中 / 有失败 / 已完结 */
export type PlanPhase = 'awaiting' | 'running' | 'failed' | 'finished';

export function planPhase(exec: PlanExecution): PlanPhase {
  const vals = exec.plan.steps.map((s) => exec.statuses[s.id] ?? 'pending');
  if (vals.includes('failed')) return 'failed';
  if (vals.includes('running')) return 'running';
  if (vals.every((v) => v === 'done' || v === 'skipped')) return 'finished';
  // 全 pending = 待批准；pending 与 done/skipped 混合 = 执行暂停后可续跑（按执行中处理）
  return vals.every((v) => v === 'pending') ? 'awaiting' : 'running';
}
