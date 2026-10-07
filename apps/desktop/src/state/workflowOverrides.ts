/**
 * 工作流透明化：步骤 prompt 覆盖层。
 *  - 场景：用户在 WorkflowLauncher「流程与提示词」区块查看/修改每一步实际发给模型的
 *    提示词；修改后的 prompt 在启动执行时真正生效（AgentPanel.executeWorkflow 应用）。
 *  - 形状：{ [workflowId]: { [stepId]: prompt } }；持久化 localStorage（sf-workflow-overrides，
 *    同步读写——量级为若干条 prompt 文本，远小于配额）；
 *  - 订阅：模块级 listener 集合，setStepOverride / resetWorkflowOverrides 变更时通知；
 *  - 还原语义：prompt 传 null（或空/纯空白字符串）表示移除该步骤的覆盖、回退 YAML 原文
 *    （空 prompt 会被引擎校验拒绝，见 engine.validate，故统一按还原处理）。
 *  - 无覆盖时 applyWorkflowOverrides 原样返回各 step 引用，执行行为与过去完全一致。
 */
import type { WorkflowDef } from '@lemma/shared';

export const WORKFLOW_OVERRIDES_STORAGE_KEY = 'sf-workflow-overrides';

/** 单个工作流内的覆盖：stepId → prompt */
export type WorkflowStepOverrides = Record<string, string>;
/** 全部覆盖：workflowId → 步骤覆盖表 */
export type WorkflowOverrides = Record<string, WorkflowStepOverrides>;

/** 单条 prompt 上限（防误贴整篇文章撑爆 localStorage；YAML 内置 prompt 均在数百字符级） */
export const STEP_PROMPT_MAX = 20000;

/**
 * 从 localStorage 安全恢复（坏 JSON / 非对象 / 值非字符串的条目丢弃，宽容不抛错）。
 * 独立导出以便测试「重启后恢复」的持久化往返。
 */
export function loadPersistedOverrides(): WorkflowOverrides {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(WORKFLOW_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: WorkflowOverrides = {};
    for (const [wfId, steps] of Object.entries(parsed as Record<string, unknown>)) {
      if (!steps || typeof steps !== 'object' || Array.isArray(steps)) continue;
      const stepMap: WorkflowStepOverrides = {};
      for (const [stepId, prompt] of Object.entries(steps as Record<string, unknown>)) {
        if (typeof prompt !== 'string' || prompt.trim() === '') continue;
        stepMap[stepId] = prompt.slice(0, STEP_PROMPT_MAX);
      }
      if (Object.keys(stepMap).length > 0) out[wfId] = stepMap;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(next: WorkflowOverrides): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(WORKFLOW_OVERRIDES_STORAGE_KEY, JSON.stringify(next));
    }
  } catch {
    /* 配额满/隐私模式：内存态仍可用，不打断 UI */
  }
}

let overrides: WorkflowOverrides = loadPersistedOverrides();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** 当前全部覆盖（只读视图；写操作请走 setStepOverride / resetWorkflowOverrides） */
export function getWorkflowOverrides(): WorkflowOverrides {
  return overrides;
}

/**
 * 设置/还原单个步骤的覆盖：
 *  - prompt 非 null 且含非空白字符 → 写入覆盖（截断到 STEP_PROMPT_MAX）；
 *  - prompt 为 null / 空 / 纯空白 → 移除覆盖（还原）；移除后该工作流无任何覆盖时连
 *    workflowId 这层键一并清掉，保持存储紧凑；
 *  - 值无变化时不写入也不通知。
 */
export function setStepOverride(wfId: string, stepId: string, prompt: string | null): void {
  const current = overrides[wfId] ?? {};
  if (prompt == null || prompt.trim() === '') {
    if (!(stepId in current)) return;
    const steps = { ...current };
    delete steps[stepId];
    const next = { ...overrides };
    if (Object.keys(steps).length === 0) delete next[wfId];
    else next[wfId] = steps;
    overrides = next;
    persist(next);
    notify();
    return;
  }
  const trimmed = prompt.slice(0, STEP_PROMPT_MAX);
  if (current[stepId] === trimmed) return;
  overrides = { ...overrides, [wfId]: { ...current, [stepId]: trimmed } };
  persist(overrides);
  notify();
}

/** 还原整个工作流的所有步骤覆盖（无覆盖时为无操作，不通知） */
export function resetWorkflowOverrides(wfId: string): void {
  if (!overrides[wfId]) return;
  const next = { ...overrides };
  delete next[wfId];
  overrides = next;
  persist(next);
  notify();
}

/** 订阅变更通知；返回取消订阅函数 */
export function subscribeWorkflowOverrides(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 纯函数：把覆盖表应用到一个 WorkflowDef 上，返回带覆盖 prompt 的新 def。
 *  - 始终返回新 def 对象 + 新 steps 数组（浅克隆）；
 *  - 被覆盖的步骤生成新 step 对象（{ ...step, prompt }），其余步骤保持原引用；
 *  - 未知 stepId / 空 / 纯空白 / 与原文相同的覆盖值一律忽略（该步保持原引用）；
 *  - overrides 传全量覆盖表（按 def.id 取该工作流的步骤覆盖）。
 */
export function applyWorkflowOverrides(def: WorkflowDef, overrides: WorkflowOverrides): WorkflowDef {
  const stepOverrides = overrides[def.id] ?? {};
  return {
    ...def,
    steps: def.steps.map((step) => {
      const o = stepOverrides[step.id];
      return typeof o === 'string' && o.trim() !== '' && o !== step.prompt ? { ...step, prompt: o } : step;
    }),
  };
}

/** 测试隔离：清空内存态与持久化副本 */
export function __resetWorkflowOverridesForTests(): void {
  overrides = {};
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(WORKFLOW_OVERRIDES_STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
  listeners.clear();
}
