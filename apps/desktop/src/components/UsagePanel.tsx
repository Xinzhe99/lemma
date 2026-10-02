/**
 * Agent 用量面板（对话框，LazyFeatureDialog 契约：export UsagePanel({ onClose })）：
 * - 本月调用量按 kind 分布（水平条形，纯 div 宽度百分比）；
 * - 估算成本大数字（formatCost 分档取整）+ 诚实标注「估算，非账单」；
 * - 月度预算进度条（超 100% 变红 var(--err)）+ 预算设置输入；
 * - 近 20 条事件时间线（时间 / kind / model / token / 延迟，新的在前）。
 * 数据源：useAgentUsageStore（读写）+ useSettingsStore（语言）；zh/en 组件内字典；
 * 不新增 CSS（条形/进度条用内联样式，与 StatsDialog 同范式）。
 */

import { useEffect, useState } from 'react';
import { formatCost } from '@scholarforge/agent-hub';
import { useSettingsStore } from '../state/settingsStore';
import {
  useAgentUsageStore,
  summarizeUsage,
  eventsInCurrentMonth,
  type AgentUsageEvent,
  type AgentUsageKind,
} from '../state/agentUsage';

const KIND_ORDER: readonly AgentUsageKind[] = ['chat', 'workflow', 'plan', 'research', 'tool'];

const KIND_LABELS: Record<AgentUsageKind, { zh: string; en: string }> = {
  chat: { zh: '会话', en: 'Chat' },
  workflow: { zh: '工作流', en: 'Workflow' },
  plan: { zh: '计划', en: 'Plan' },
  research: { zh: '并行研究', en: 'Research' },
  tool: { zh: '工具', en: 'Tool' },
};

const STRINGS = {
  zh: {
    title: 'Agent 用量与成本',
    monthCalls: '本月调用',
    callsUnit: '次',
    estCost: '估算成本（本月）',
    estNote: '估算，非账单：按模型档位启发计价，实际以服务商账单为准',
    byKind: '本月调用分布',
    budget: '月度预算',
    noBudget: '未设置预算',
    budgetOver: '已超预算',
    budgetSetting: '预算设置（USD）',
    budgetPlaceholder: '如 10（留空清除）',
    save: '保存',
    clear: '清空记录',
    recent: '近 20 条事件',
    empty: '本月暂无调用记录',
    close: '关闭',
    tokens: 'token',
    latency: '延迟',
    unknownModel: '未记录模型',
    kind: '类型',
  },
  en: {
    title: 'Agent usage & cost',
    monthCalls: 'Calls this month',
    callsUnit: 'calls',
    estCost: 'Est. cost (this month)',
    estNote: 'Estimate, not a bill: priced by model-tier heuristics; see your provider invoice',
    byKind: 'Calls by kind',
    budget: 'Monthly budget',
    noBudget: 'No budget set',
    budgetOver: 'Over budget',
    budgetSetting: 'Budget setting (USD)',
    budgetPlaceholder: 'e.g. 10 (blank clears)',
    save: 'Save',
    clear: 'Clear history',
    recent: 'Last 20 events',
    empty: 'No calls recorded this month',
    close: 'Close',
    tokens: 'tokens',
    latency: 'latency',
    unknownModel: 'model not recorded',
    kind: 'Kind',
  },
} as const;

const SECTION_GAP = { marginTop: 20 } as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 事件时间戳 → 「MM-DD HH:mm:ss」（本地时区；组件内展示用） */
function formatEventTime(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function eventLine(
  e: AgentUsageEvent,
  L: { tokens: string; latency: string; unknownModel: string },
  lang: 'zh' | 'en',
): string {
  const tokens =
    e.inputTokens !== undefined || e.outputTokens !== undefined
      ? ` · ↑${e.inputTokens ?? 0}/↓${e.outputTokens ?? 0} ${L.tokens}`
      : '';
  const latency = e.latencyMs !== undefined ? ` · ${L.latency} ${e.latencyMs}ms` : '';
  return `${KIND_LABELS[e.kind][lang]} · ${e.model || L.unknownModel}${tokens}${latency}`;
}

export function UsagePanel({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];

  const events = useAgentUsageStore((s) => s.events);
  const monthlyBudgetUsd = useAgentUsageStore((s) => s.monthlyBudgetUsd);
  const setBudget = useAgentUsageStore((s) => s.setBudget);
  const clear = useAgentUsageStore((s) => s.clear);

  const [budgetInput, setBudgetInput] = useState(monthlyBudgetUsd === undefined ? '' : String(monthlyBudgetUsd));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // —— 本月视图（事件按 ts 过滤到当前年月） ——
  const monthEvents = eventsInCurrentMonth(events);
  const summary = summarizeUsage(monthEvents, monthlyBudgetUsd);
  const overBudget = summary.budgetPct !== undefined && summary.budgetPct > 100;
  const budgetBarPct =
    summary.budgetPct === undefined ? 0 : Math.min(100, Math.max(0, summary.budgetPct));

  // —— kind 分布条形（计数 > 0 的 kind 按固定顺序；条宽相对最大值） ——
  const kindRows = KIND_ORDER.filter((k) => (summary.byKind[k] ?? 0) > 0).map((k) => ({
    kind: k,
    count: summary.byKind[k] ?? 0,
  }));
  const kindMax = Math.max(1, ...kindRows.map((r) => r.count));

  // —— 近 20 条事件（全历史、新的在前） ——
  const recent = [...events].slice(-20).reverse();

  const handleSaveBudget = (): void => {
    const trimmed = budgetInput.trim();
    if (!trimmed) {
      setBudget(undefined);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return; // 非法输入不落库
    setBudget(n);
    setBudgetInput(String(useAgentUsageStore.getState().monthlyBudgetUsd ?? n));
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          {/* —— 本月概览：调用量 + 估算成本大数字 —— */}
          <section className="sf-usage-overview" style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
            <div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.monthCalls}</div>
              <div className="sf-usage-total-calls" style={{ fontSize: 22, fontWeight: 600 }}>
                {summary.totalCalls} <span style={{ fontSize: 12, fontWeight: 400 }}>{L.callsUnit}</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.estCost}</div>
              <div
                className="sf-usage-est-cost"
                style={{ fontSize: 26, fontWeight: 700, fontFamily: 'monospace' }}
              >
                {formatCost(summary.estCostUsd)}
              </div>
            </div>
          </section>
          <p className="sf-usage-est-note" style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--fg-2)' }}>
            {L.estNote}
          </p>

          {/* —— 预算进度 —— */}
          <section className="sf-usage-budget" style={SECTION_GAP}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span>{L.budget}</span>
              {monthlyBudgetUsd === undefined ? (
                <span className="sf-usage-budget-none" style={{ color: 'var(--fg-2)', fontSize: 12 }}>
                  {L.noBudget}
                </span>
              ) : (
                <span
                  className="sf-usage-budget-pct"
                  style={{
                    fontSize: 12,
                    fontWeight: overBudget ? 700 : 400,
                    color: overBudget ? 'var(--err)' : 'var(--fg-2)',
                  }}
                >
                  {overBudget ? `⚠️ ${L.budgetOver} · ` : ''}
                  {summary.budgetPct}%
                </span>
              )}
            </div>
            <div
              className="sf-usage-budget-track"
              style={{ height: 8, borderRadius: 4, background: 'var(--bg-3)', overflow: 'hidden' }}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={budgetBarPct}
            >
              <div
                className="sf-usage-budget-fill"
                style={{
                  width: `${budgetBarPct}%`,
                  height: '100%',
                  background: overBudget ? 'var(--err)' : 'var(--accent)',
                }}
              />
            </div>
          </section>

          {/* —— kind 分布条形 —— */}
          <section className="sf-usage-kinds" style={SECTION_GAP}>
            <div style={{ marginBottom: 8 }}>{L.byKind}</div>
            {kindRows.length === 0 ? (
              <p className="placeholder">{L.empty}</p>
            ) : (
              <ul className="sf-usage-kind-bars" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {kindRows.map(({ kind, count }) => (
                  <li
                    key={kind}
                    className="sf-usage-kind-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
                  >
                    <span className="sf-usage-kind-label" style={{ width: 72, flexShrink: 0, fontSize: 12 }}>
                      {KIND_LABELS[kind][language]}
                    </span>
                    <div style={{ flex: 1, height: 10, background: 'var(--bg-3)', borderRadius: 3, overflow: 'hidden' }}>
                      <div
                        className="sf-usage-kind-bar"
                        style={{
                          width: `${Math.max(4, Math.round((count / kindMax) * 100))}%`,
                          height: '100%',
                          background: 'var(--accent)',
                        }}
                      />
                    </div>
                    <span className="sf-usage-kind-count" style={{ width: 48, textAlign: 'right', fontSize: 12 }}>
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* —— 预算设置 —— */}
          <section className="sf-usage-budget-setting" style={SECTION_GAP}>
            <div style={{ marginBottom: 8 }}>{L.budgetSetting}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="sf-input sf-usage-budget-input"
                type="number"
                min={0}
                step={1}
                aria-label={L.budgetSetting}
                placeholder={L.budgetPlaceholder}
                value={budgetInput}
                onChange={(e) => setBudgetInput(e.target.value)}
                style={{ width: 140 }}
              />
              <button className="sf-btn" onClick={handleSaveBudget}>
                {L.save}
              </button>
            </div>
          </section>

          {/* —— 近 20 条事件时间线 —— */}
          <section className="sf-usage-recent" style={SECTION_GAP}>
            <div style={{ marginBottom: 8 }}>{L.recent}</div>
            {recent.length === 0 ? (
              <p className="placeholder">{L.empty}</p>
            ) : (
              <ul
                className="sf-usage-events"
                style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 220, overflowY: 'auto' }}
              >
                {recent.map((e, i) => (
                  <li
                    key={`${e.ts}-${i}`}
                    className="sf-usage-event-row"
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      padding: '3px 0',
                      fontSize: 12,
                      borderBottom: '1px solid var(--bg-3)',
                    }}
                  >
                    <span className="sf-usage-event-time" style={{ color: 'var(--fg-2)', flexShrink: 0 }}>
                      {formatEventTime(e.ts)}
                    </span>
                    <span
                      className="sf-usage-event-desc"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={eventLine(e, L, language)}
                    >
                      {eventLine(e, L, language)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="sf-lib-dialog-actions" style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="sf-btn" onClick={clear}>
              {L.clear}
            </button>
            <button className="sf-btn sf-usage-close" onClick={onClose}>
              {L.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
