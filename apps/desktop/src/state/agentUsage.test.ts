// @vitest-environment jsdom
/**
 * agentUsage store + summarizeUsage 纯函数测试：
 * 覆盖汇总（totalCalls/byKind）、成本三档（旗舰 reasoner / 命名经济档 / 无 model）、
 * 预算百分比（含超 100% 与未设置）、record 规范化（ts 回填/负值钳制/四舍五入）、
 * 500 条滚动上限、localStorage 持久化与脏数据回退、eventsInCurrentMonth、setBudget/clear。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AGENT_USAGE_LIMIT,
  AGENT_USAGE_STORAGE_KEY,
  eventsInCurrentMonth,
  MODEL_PRICES,
  readPersistedUsage,
  summarizeUsage,
  useAgentUsageStore,
  type AgentUsageEvent,
} from './agentUsage';

beforeEach(() => {
  localStorage.clear();
  useAgentUsageStore.setState({ events: [], monthlyBudgetUsd: undefined });
});

function ev(patch: Partial<AgentUsageEvent> & { kind: AgentUsageEvent['kind'] }): AgentUsageEvent {
  return { ts: Date.now(), ...patch };
}

describe('summarizeUsage · 汇总', () => {
  it('totalCalls 与 byKind 按 kind 计数（多 kind 混合）', () => {
    const s = summarizeUsage([
      ev({ kind: 'chat' }),
      ev({ kind: 'chat' }),
      ev({ kind: 'research' }),
      ev({ kind: 'tool' }),
    ]);
    expect(s.totalCalls).toBe(4);
    expect(s.byKind).toEqual({ chat: 2, research: 1, tool: 1 });
    expect(s.estCostUsd).toBe(0);
    expect(s.budgetPct).toBeUndefined();
  });

  it('空事件：零调用零成本，无预算百分比', () => {
    const s = summarizeUsage([]);
    expect(s.totalCalls).toBe(0);
    expect(s.byKind).toEqual({});
    expect(s.estCostUsd).toBe(0);
  });
});

describe('summarizeUsage · 成本三档', () => {
  it('旗舰档（model 名含 reasoner）：输入 3e-3/千 token、输出 1.5e-5/token', () => {
    const s = summarizeUsage([ev({ kind: 'chat', model: 'deepseek-reasoner', inputTokens: 1000, outputTokens: 1000 })]);
    expect(s.estCostUsd).toBeCloseTo(1000 * MODEL_PRICES.flagship.inputPerToken + 1000 * MODEL_PRICES.flagship.outputPerToken, 9);
    expect(s.estCostUsd).toBeCloseTo(0.018, 9); // 3e-3 + 1.5e-2
  });

  it('经济档（普通命名模型）：输入 1e-3/千 token、输出 5e-7/token', () => {
    const s = summarizeUsage([ev({ kind: 'workflow', model: 'qwen-turbo', inputTokens: 1000, outputTokens: 1000 })]);
    expect(s.estCostUsd).toBeCloseTo(0.0015, 9); // 1e-3 + 5e-4
  });

  it('无 model 按经济档计', () => {
    const s = summarizeUsage([ev({ kind: 'chat', inputTokens: 2000, outputTokens: 1000 })]);
    expect(s.estCostUsd).toBeCloseTo(2000 * MODEL_PRICES.cheap.inputPerToken + 1000 * MODEL_PRICES.cheap.outputPerToken, 9);
  });

  it('多事件成本累加', () => {
    const s = summarizeUsage([
      ev({ kind: 'chat', model: 'glm-4.6', inputTokens: 1000, outputTokens: 0 }),
      ev({ kind: 'chat', model: 'qwen-turbo', inputTokens: 1000, outputTokens: 0 }),
    ]);
    expect(s.estCostUsd).toBeCloseTo(3e-3 + 1e-3, 9);
  });
});

describe('summarizeUsage · 预算百分比', () => {
  it('budgetPct = 成本/预算×100（四舍五入整数）', () => {
    const events = [ev({ kind: 'chat', model: 'deepseek-reasoner', inputTokens: 1000, outputTokens: 1000 })]; // 0.018
    expect(summarizeUsage(events, 0.036).budgetPct).toBe(50);
    expect(summarizeUsage(events, 0.001).budgetPct).toBe(1800); // 不封顶，超 100 由 UI 标红
  });

  it('未设置预算或预算非法 → budgetPct 缺省', () => {
    const events = [ev({ kind: 'chat', inputTokens: 100 })];
    expect(summarizeUsage(events).budgetPct).toBeUndefined();
    expect(summarizeUsage(events, 0).budgetPct).toBeUndefined();
    expect(summarizeUsage(events, Number.NaN).budgetPct).toBeUndefined();
  });
});

describe('useAgentUsageStore · record', () => {
  it('ts 缺省回填当前时间；token 负值钳 0、小数四舍五入', () => {
    const before = Date.now();
    useAgentUsageStore.getState().record({
      kind: 'research',
      model: 'glm-4.6',
      inputTokens: -5,
      outputTokens: 10.4,
      latencyMs: 12.6,
    });
    const e = useAgentUsageStore.getState().events;
    expect(e).toHaveLength(1);
    expect(e[0]!.ts).toBeGreaterThanOrEqual(before);
    expect(e[0]!.inputTokens).toBe(0);
    expect(e[0]!.outputTokens).toBe(10);
    expect(e[0]!.latencyMs).toBe(13);
    expect(e[0]!.kind).toBe('research');
  });

  it('滚动上限 500 条：旧的先出队', () => {
    for (let i = 0; i < AGENT_USAGE_LIMIT + 2; i++) {
      useAgentUsageStore.getState().record({ kind: 'chat', model: `m${i}` });
    }
    const events = useAgentUsageStore.getState().events;
    expect(events).toHaveLength(AGENT_USAGE_LIMIT);
    expect(events[0]!.model).toBe('m2'); // m0/m1 已滚出
    expect(events[events.length - 1]!.model).toBe(`m${AGENT_USAGE_LIMIT + 1}`);
  });
});

describe('useAgentUsageStore · 预算与清空', () => {
  it('setBudget 合法值落库，非法/undefined 清除', () => {
    useAgentUsageStore.getState().setBudget(10);
    expect(useAgentUsageStore.getState().monthlyBudgetUsd).toBe(10);
    useAgentUsageStore.getState().setBudget(-1);
    expect(useAgentUsageStore.getState().monthlyBudgetUsd).toBeUndefined();
    useAgentUsageStore.getState().setBudget(5);
    useAgentUsageStore.getState().setBudget(undefined);
    expect(useAgentUsageStore.getState().monthlyBudgetUsd).toBeUndefined();
  });

  it('clear 清空事件但保留预算', () => {
    useAgentUsageStore.getState().setBudget(8);
    useAgentUsageStore.getState().record({ kind: 'chat' });
    useAgentUsageStore.getState().clear();
    const s = useAgentUsageStore.getState();
    expect(s.events).toEqual([]);
    expect(s.monthlyBudgetUsd).toBe(8);
  });
});

describe('localStorage 持久化（sf-agent-usage）', () => {
  it('record / setBudget 写入 localStorage，readPersistedUsage 原样读回', () => {
    useAgentUsageStore.getState().record({ kind: 'research', model: 'glm-4.6', inputTokens: 10, outputTokens: 20 });
    useAgentUsageStore.getState().setBudget(3.5);
    const raw = localStorage.getItem(AGENT_USAGE_STORAGE_KEY)!;
    expect(raw).toBeTruthy();
    const parsed = readPersistedUsage();
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ kind: 'research', model: 'glm-4.6', inputTokens: 10, outputTokens: 20 });
    expect(parsed.monthlyBudgetUsd).toBe(3.5);
  });

  it('脏数据回退：非法 JSON / 结构不符 → 空；单条非法事件被过滤、合法事件保留', () => {
    localStorage.setItem(AGENT_USAGE_STORAGE_KEY, '{oops');
    expect(readPersistedUsage().events).toEqual([]);

    localStorage.setItem(AGENT_USAGE_STORAGE_KEY, JSON.stringify({ events: 'not-array' }));
    expect(readPersistedUsage().events).toEqual([]);

    localStorage.setItem(
      AGENT_USAGE_STORAGE_KEY,
      JSON.stringify({
        events: [
          { ts: 1, kind: 'chat', model: 'ok' },
          { kind: 'chat' }, // 缺 ts
          { ts: 2, kind: 'unknown-kind' }, // 非法 kind
          { ts: 3, kind: 'workflow', model: 42 }, // model 类型不符
        ],
        monthlyBudgetUsd: -3, // 负预算视为未设置
      }),
    );
    const parsed = readPersistedUsage();
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ ts: 1, kind: 'chat', model: 'ok' });
    expect(parsed.monthlyBudgetUsd).toBeUndefined();
  });
});

describe('eventsInCurrentMonth', () => {
  it('只保留与 now 同年同月的事件', () => {
    const now = Date.now();
    const monthAgo = now - 45 * 24 * 3600 * 1000;
    const events = [
      ev({ kind: 'chat', ts: now - 1000 }),
      ev({ kind: 'chat', ts: monthAgo }),
    ];
    const kept = eventsInCurrentMonth(events, now);
    expect(kept).toHaveLength(1);
    expect(kept[0]!.ts).toBe(now - 1000);
    expect(eventsInCurrentMonth([], now)).toEqual([]);
  });
});
