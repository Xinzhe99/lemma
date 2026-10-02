/**
 * Agent 用量台账（zustand）：chat / workflow / plan / research / tool 五类调用事件的
 * 滚动记录（上限 500 条，新的在后）+ 月度预算（USD）。持久化 localStorage（key:
 * sf-agent-usage），读取时逐条校验、脏数据丢弃回退为空。
 *
 * 成本口径（诚实标注：估算，非账单）——按事件里的 model 名做档位启发：
 * - 旗舰档（名字含 reasoner 等旗舰特征）：输入 3e-3 / 千 token（3e-6/token）、
 *   输出 1.5e-5 / token（≈ $15 / 百万 token）；
 * - 经济档（其余命名模型）：输入 1e-3 / 千 token（1e-6/token）、输出 5e-7 / token；
 * - 未记录 model：按经济档计。
 * 真实账单以服务商为准，面板 UI 全程展示「估算」字样。
 */

import { create } from 'zustand';

export type AgentUsageKind = 'chat' | 'workflow' | 'plan' | 'research' | 'tool';

export interface AgentUsageEvent {
  ts: number;
  kind: AgentUsageKind;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
}

export interface AgentUsageSummary {
  totalCalls: number;
  byKind: Record<string, number>;
  estCostUsd: number;
  /** 预算使用百分比（整数；estCostUsd / budgetUsd × 100，不封顶，超 100 由 UI 标红） */
  budgetPct?: number;
}

export const AGENT_USAGE_STORAGE_KEY = 'sf-agent-usage';
/** 事件滚动上限：最多保留最近 500 条 */
export const AGENT_USAGE_LIMIT = 500;

const KINDS: readonly AgentUsageKind[] = ['chat', 'workflow', 'plan', 'research', 'tool'];

/** 单 token 价格（USD），见文件头成本口径说明 */
export const MODEL_PRICES = {
  flagship: { inputPerToken: 3e-6, outputPerToken: 1.5e-5 },
  cheap: { inputPerToken: 1e-6, outputPerToken: 5e-7 },
} as const;

/** 旗舰档模型名启发（reasoner / 主流旗舰命名特征；命中即按旗舰价估算） */
const FLAGSHIP_MODEL_RE = /reasoner|flagship|opus|ultra|gpt-4|glm-4|claude|gemini-(pro|ultra)|qwen-max|-max\b/i;

export function isFlagshipModel(model?: string): boolean {
  return typeof model === 'string' && model.length > 0 && FLAGSHIP_MODEL_RE.test(model);
}

/** 用量事件纯函数汇总：总调用数、按 kind 分布、按模型档位估算的成本与预算百分比 */
export function summarizeUsage(
  events: readonly AgentUsageEvent[],
  budgetUsd?: number,
): AgentUsageSummary {
  const byKind: Record<string, number> = {};
  let estCostUsd = 0;
  for (const e of events) {
    byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
    const price = isFlagshipModel(e.model) ? MODEL_PRICES.flagship : MODEL_PRICES.cheap;
    estCostUsd += (e.inputTokens ?? 0) * price.inputPerToken + (e.outputTokens ?? 0) * price.outputPerToken;
  }
  // 浮点累加噪声截断到 1e-9（展示层再由 formatCost 分档取整）
  estCostUsd = Math.round(estCostUsd * 1e9) / 1e9;
  const budgetPct =
    typeof budgetUsd === 'number' && Number.isFinite(budgetUsd) && budgetUsd > 0
      ? Math.round((estCostUsd / budgetUsd) * 100)
      : undefined;
  return { totalCalls: events.length, byKind, estCostUsd, budgetPct };
}

/** 过滤出与 now 同年同月的事件（面板「本月」视图；纯函数） */
export function eventsInCurrentMonth(
  events: readonly AgentUsageEvent[],
  now: number = Date.now(),
): AgentUsageEvent[] {
  const d = new Date(now);
  return events.filter((e) => {
    if (typeof e.ts !== 'number' || !Number.isFinite(e.ts)) return false;
    const ed = new Date(e.ts);
    return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth();
  });
}

// ---------------------------------------------------------------------------
// 持久化（读取逐条校验，任何不符回退为空；写入失败不打断 UI）
// ---------------------------------------------------------------------------

interface PersistedUsage {
  events: AgentUsageEvent[];
  monthlyBudgetUsd?: number;
}

function isUsageEvent(v: unknown): v is AgentUsageEvent {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.ts === 'number' &&
    Number.isFinite(o.ts) &&
    KINDS.includes(o.kind as AgentUsageKind) &&
    (o.model === undefined || typeof o.model === 'string') &&
    (o.inputTokens === undefined || (typeof o.inputTokens === 'number' && Number.isFinite(o.inputTokens))) &&
    (o.outputTokens === undefined || (typeof o.outputTokens === 'number' && Number.isFinite(o.outputTokens))) &&
    (o.latencyMs === undefined || (typeof o.latencyMs === 'number' && Number.isFinite(o.latencyMs)))
  );
}

function readPersisted(): PersistedUsage {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(AGENT_USAGE_STORAGE_KEY);
    if (!raw) return { events: [] };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { events: [] };
    const o = parsed as Record<string, unknown>;
    const events = Array.isArray(o.events) ? (o.events as unknown[]).filter(isUsageEvent) : [];
    const budget = o.monthlyBudgetUsd;
    return {
      events: events.slice(-AGENT_USAGE_LIMIT) as AgentUsageEvent[],
      monthlyBudgetUsd:
        typeof budget === 'number' && Number.isFinite(budget) && budget >= 0 ? budget : undefined,
    };
  } catch {
    return { events: [] };
  }
}

function persist(state: { events: readonly AgentUsageEvent[]; monthlyBudgetUsd?: number }): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const snap: PersistedUsage = { events: [...state.events], monthlyBudgetUsd: state.monthlyBudgetUsd };
    localStorage.setItem(AGENT_USAGE_STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* 持久化失败不打断 UI（隐私模式/配额满） */
  }
}

/** 读取当前持久化内容（测试与调试用） */
export function readPersistedUsage(): PersistedUsage {
  return readPersisted();
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

export type AgentUsageEventInput = Omit<AgentUsageEvent, 'ts'> & { ts?: number };

interface AgentUsageState {
  events: AgentUsageEvent[];
  /** 月度预算（USD）；undefined = 未设置 */
  monthlyBudgetUsd?: number;
  /** 记录一次调用（ts 缺省取当前时间；滚动保留最近 500 条） */
  record(event: AgentUsageEventInput): void;
  /** 设置月度预算（传 undefined 或非法值则清除） */
  setBudget(usd: number | undefined): void;
  /** 清空调用记录（预算是设置项，保留） */
  clear(): void;
}

const initial = readPersisted();

export const useAgentUsageStore = create<AgentUsageState>((set) => ({
  events: initial.events,
  monthlyBudgetUsd: initial.monthlyBudgetUsd,

  record: (event) =>
    set((s) => {
      const ts = typeof event.ts === 'number' && Number.isFinite(event.ts) ? event.ts : Date.now();
      const next: AgentUsageEvent = {
        ts,
        kind: event.kind,
        ...(event.model !== undefined ? { model: event.model } : {}),
        ...(typeof event.inputTokens === 'number' && Number.isFinite(event.inputTokens)
          ? { inputTokens: Math.max(0, Math.round(event.inputTokens)) }
          : {}),
        ...(typeof event.outputTokens === 'number' && Number.isFinite(event.outputTokens)
          ? { outputTokens: Math.max(0, Math.round(event.outputTokens)) }
          : {}),
        ...(typeof event.latencyMs === 'number' && Number.isFinite(event.latencyMs)
          ? { latencyMs: Math.max(0, Math.round(event.latencyMs)) }
          : {}),
      };
      const events = [...s.events, next].slice(-AGENT_USAGE_LIMIT);
      persist({ events, monthlyBudgetUsd: s.monthlyBudgetUsd });
      return { events };
    }),

  setBudget: (usd) =>
    set((s) => {
      const monthlyBudgetUsd =
        typeof usd === 'number' && Number.isFinite(usd) && usd >= 0 ? usd : undefined;
      persist({ events: s.events, monthlyBudgetUsd });
      return { monthlyBudgetUsd };
    }),

  clear: () =>
    set((s) => {
      persist({ events: [], monthlyBudgetUsd: s.monthlyBudgetUsd });
      return { events: [] };
    }),
}));
