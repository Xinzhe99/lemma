/**
 * Agent 记忆系统（设计 5.4「项目记忆」的自学习侧）：
 * 从用户的 diff 审批历史学习偏好（采纳了什么 / 拒绝了什么 / 风格倾向），
 * 经 buildMemoryInjection() 注入 Context Pack 的 projectMemory 段，影响后续生成——
 * 解决「每次对话都从零开始」的初级感。
 *
 * 数据面：
 * - styleNotes：风格偏好短句（自动从审批差异归纳 + 用户手工增删，上限 30 条）；
 * - approvedPatterns：按（label, via）聚合的审批模式（计数 + 最近一次观察 note，上限 200 条）；
 * - ignoredSuggestions：用户显式忽略的偏好建议（保留记录但从注入中排除）；
 * - enabled：总开关（关闭后注入为空，学习记录仍会累积，便于随时恢复）。
 *
 * 持久化：localStorage（key: sf-agent-memory），读侧逐字段校验、坏数据整体回退。
 * 接线（approval.ts / proposalStore 归宿主侧，本模块不订阅）：
 * 集成者在 AgentPanel 的 onAccept/onReject 各加一行 `recordApproval(...)`（见仓库报告）。
 */

import { create } from 'zustand';
import type { AgentMessage, AgentMessageRole } from '@scholarforge/shared';

// ---------------------------------------------------------------------------
// 常量与类型
// ---------------------------------------------------------------------------

export const AGENT_MEMORY_STORAGE_KEY = 'sf-agent-memory';
export const STYLE_NOTES_CAP = 30;
export const PATTERNS_CAP = 200;
/** 注入摘要统计的审批事件窗口（条） */
export const STATS_WINDOW = 20;

/** 部分采纳（未选全部 hunk）时归纳的保守倾向提示（兼作最高频拒绝原因候选） */
export const PARTIAL_NOTE = '部分采纳：用户倾向保守';
/** 拒绝且 before/after 无显著风格差异时归纳的拒绝原因 */
export const REJECT_NO_GAIN_NOTE = '拒绝风格增益不明显的修改';

/** 一类审批模式：同一（label, via）的提案聚合计数，note 为最近一次归纳观察 */
export interface ApprovedPattern {
  /** 最近一次裁决时间（ms） */
  ts: number;
  label: string;
  via: string;
  acceptedCount: number;
  rejectedCount: number;
  /** 最近一次归纳出的观察（风格偏好 / 保守倾向 / 拒绝原因）；无观察时缺省 */
  note?: string;
}

/** recordApproval 的提案输入（EditProposal 的字段子集，宿主可直接传 proposal） */
export interface MemoryApprovalInput {
  label: string;
  via: string;
  before: string;
  after: string;
  /** 阻塞式审批令牌（agent 工具触发的提案携带；记忆侧仅透传不使用） */
  token?: string;
}

export interface AgentMemoryState {
  styleNotes: string[];
  approvedPatterns: ApprovedPattern[];
  ignoredSuggestions: string[];
  enabled: boolean;
  /** 记录一次裁决：更新模式计数 + 自动归纳风格偏好（见 deriveStyleNote） */
  recordApproval(proposal: MemoryApprovalInput, accepted: boolean, partialCount?: number): void;
  addStyleNote(note: string): void;
  removeStyleNote(index: number): void;
  /** 忽略 / 恢复一条建议（忽略后不再注入，记录保留） */
  toggleIgnored(suggestion: string): void;
  setEnabled(enabled: boolean): void;
  /** 清空全部学习数据（enabled 开关保留） */
  clearAll(): void;
}

// ---------------------------------------------------------------------------
// 纯函数：偏好归纳
// ---------------------------------------------------------------------------

/** after 中新出现的强调 / 衔接连接词（before 中没有或更少） */
const CONNECTOR_WORDS = [
  'Notably',
  'Specifically',
  'Importantly',
  'Furthermore',
  'Moreover',
  'However',
  'Therefore',
  'In contrast',
] as const;

/** 显著更短的判定：after ≤ before 的 85%（即压缩 ≥15%）且原文足够长（避免小样本噪声） */
const SHORTER_RATIO = 0.85;
const SHORTER_MIN_LEN = 20;

function countWord(text: string, word: string): number {
  return (text.match(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g')) ?? []).length;
}

function citationsOf(text: string): string[] {
  return text.match(/\\cite[tp]?\{[^}]*\}/g) ?? [];
}

function digitsOf(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

function sameMultiset(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sorted = [...a].sort();
  const other = [...b].sort();
  return sorted.every((v, i) => v === other[i]);
}

/**
 * 从 before/after 差异归纳一条风格偏好（启发式，纯函数）：
 * - after 显著更短（≥15% 压缩）→ 「偏好更简洁的表达」；
 * - after 新引入 Notably/Specifically 等连接词 → 「偏好 X 类连接词」；
 * - 引用 / 数字发生变化 → 内容编辑而非风格调整 → null；
 * - 无显著差异（含完全相同）→ null。
 */
export function deriveStyleNote(before: string, after: string): string | null {
  const b = before.trim();
  const a = after.trim();
  if (!a || !b || a === b) return null;
  // 引用 / 数字被增删改 = 内容变化，不是风格偏好，不产 note
  if (!sameMultiset(citationsOf(b), citationsOf(a)) || !sameMultiset(digitsOf(b), digitsOf(a))) {
    return null;
  }
  if (b.length >= SHORTER_MIN_LEN && a.length <= Math.floor(b.length * SHORTER_RATIO)) {
    return '偏好更简洁的表达';
  }
  for (const w of CONNECTOR_WORDS) {
    if (countWord(a, w) > countWord(b, w)) return `偏好 ${w} 类连接词`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 纯函数：统计与注入
// ---------------------------------------------------------------------------

/** 窗口内审批统计（事件按 pattern 最近裁决时间倒序累计，窗口封顶） */
export interface MemoryStats {
  /** 窗口内计入的裁决事件总数 */
  total: number;
  accepted: number;
  rejected: number;
  /** 采纳率 0..1；无数据为 null */
  rate: number | null;
  /** 窗口内出现过部分采纳（保守倾向提示） */
  partialHint: boolean;
  /** 最高频拒绝原因（拒绝类 note 按出现次数取最大）；无则 null */
  topRejectReason: string | null;
}

/**
 * 按最近裁决时间从新到旧累计审批事件，封顶 window 条；
 * 每个 pattern 内先计 accepted 再计 rejected（确定性截断，便于断言）。
 * 拒绝原因统计：REJECT_NO_GAIN_NOTE / PARTIAL_NOTE 两类 note 按出现的 pattern 计数。
 */
export function memoryStats(patterns: ApprovedPattern[], window = STATS_WINDOW): MemoryStats {
  const ordered = [...patterns].sort((x, y) => y.ts - x.ts);
  let accepted = 0;
  let rejected = 0;
  let remaining = window;
  let partialHint = false;
  const rejectReasons = new Map<string, number>();
  for (const p of ordered) {
    if (remaining <= 0) break;
    const a = Math.min(Math.max(0, p.acceptedCount), remaining);
    accepted += a;
    remaining -= a;
    const r = Math.min(Math.max(0, p.rejectedCount), remaining);
    rejected += r;
    remaining -= r;
    if (a + r === 0) continue; // 未计入窗口的 pattern 不参与 note 统计
    if (p.note === PARTIAL_NOTE) partialHint = true;
    // 拒绝类 note 计频：无增益拒绝（经 rejectedCount 出现）与保守部分采纳（经部分采纳事件出现）
    const reason = p.note;
    if (reason === REJECT_NO_GAIN_NOTE && p.rejectedCount > 0) {
      rejectReasons.set(reason, (rejectReasons.get(reason) ?? 0) + 1);
    } else if (reason === PARTIAL_NOTE && (p.rejectedCount > 0 || p.acceptedCount > 0)) {
      rejectReasons.set(reason, (rejectReasons.get(reason) ?? 0) + 1);
    }
  }
  const total = accepted + rejected;
  let topRejectReason: string | null = null;
  let best = 0;
  for (const [reason, count] of rejectReasons) {
    if (count > best) {
      best = count;
      topRejectReason = reason;
    }
  }
  return { total, accepted, rejected, rate: total > 0 ? accepted / total : null, partialHint, topRejectReason };
}

/**
 * 生成注入 Context Pack「项目记忆」段的记忆文本（多行）。
 * enabled=false 或空记忆（无可注入偏好且无审批事件）返回 ''。
 * 被忽略（ignoredSuggestions）的偏好不会注入。
 */
export function buildMemoryInjection(state: AgentMemoryState = useAgentMemoryStore.getState()): string {
  if (!state.enabled) return '';
  const notes = state.styleNotes.filter((n) => !state.ignoredSuggestions.includes(n));
  const stats = memoryStats(state.approvedPatterns);
  if (notes.length === 0 && stats.total === 0) return '';
  const lines: string[] = [];
  if (notes.length > 0) {
    lines.push('用户风格偏好（从审批历史学习，生成时须遵循）：');
    for (const n of notes) lines.push(`- ${n}`);
  }
  if (stats.total > 0) {
    const pct = Math.round((stats.rate ?? 0) * 100);
    lines.push(`近期 AI 修改采纳率 ${pct}%（${stats.accepted} 采纳 / ${stats.rejected} 拒绝）`);
    if (stats.partialHint) lines.push('部分采纳提示：用户倾向保守，重大改动宜拆分为小步提案');
    if (stats.topRejectReason) lines.push(`最高频拒绝原因：${stats.topRejectReason}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 纯函数：会话摘要压缩（P1）
// ---------------------------------------------------------------------------

export interface SummarizeResult {
  /** 压缩后应保留（继续发给模型）的消息：首 2 条 + 最近 30% */
  keep: AgentMessage[];
  /** 中间段的结构性摘要（宿主作为 system 附注注入）；未触发压缩时缺省 */
  summary?: string;
}

const SUMMARY_LINE_MAX = 80;
const SUMMARY_MAX_LINES = 20;

function firstLine(text: string, max = SUMMARY_LINE_MAX): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

/**
 * 长会话自动摘要压缩（纯函数，不调 AI）：
 * 全部消息 content 总长 ≤ maxChars 时原样返回；
 * 超限时保留首 2 条与最近 30% 消息，中间段生成朴素结构性摘要——
 * 各消息「首行 + 角色」拼接并给出角色计数，诚实标注
 * 「结构性摘要，语义摘要待接 provider」。消息过少（中间段为空）时不压缩原样返回。
 */
export function summarizeIfNeeded(messages: AgentMessage[], maxChars = 12000): SummarizeResult {
  const total = messages.reduce((n, m) => n + m.content.length, 0);
  if (total <= maxChars) return { keep: messages };
  const n = messages.length;
  const tailCount = Math.max(1, Math.ceil(n * 0.3));
  const tailStart = Math.max(2, n - tailCount);
  if (tailStart <= 2) return { keep: messages }; // 中间段为空，结构性压缩无从下手
  const head = messages.slice(0, 2);
  const middle = messages.slice(2, tailStart);
  const tail = messages.slice(tailStart);

  const counts = new Map<AgentMessageRole, number>();
  for (const m of middle) counts.set(m.role, (counts.get(m.role) ?? 0) + 1);
  const countText = [...counts.entries()].map(([role, c]) => `${role} ${c}`).join(' · ');
  const lines = middle.map((m) => `- [${m.role}] ${firstLine(m.content)}`);

  const summary = [
    `【会话历史摘要】更早的 ${middle.length} 条消息已被压缩（${countText || '无消息'}）。`,
    '（结构性摘要：以下为各消息首行拼接，语义摘要待接 provider）',
    ...lines.slice(0, SUMMARY_MAX_LINES),
    ...(lines.length > SUMMARY_MAX_LINES ? [`…其余 ${lines.length - SUMMARY_MAX_LINES} 条略`] : []),
  ].join('\n');
  return { keep: [...head, ...tail], summary };
}

// ---------------------------------------------------------------------------
// 持久化（localStorage：校验 / 回退 / 上限）
// ---------------------------------------------------------------------------

interface PersistedMemory {
  styleNotes: string[];
  approvedPatterns: ApprovedPattern[];
  ignoredSuggestions: string[];
  enabled: boolean;
}

function sanitizeStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string' || !item.trim()) continue;
    if (!out.includes(item)) out.push(item);
  }
  return out;
}

function sanitizePattern(v: unknown): ApprovedPattern | null {
  if (!v || typeof v !== 'object') return null;
  const p = v as Record<string, unknown>;
  if (typeof p.ts !== 'number' || !Number.isFinite(p.ts)) return null;
  if (typeof p.label !== 'string' || !p.label) return null;
  if (typeof p.via !== 'string') return null;
  if (typeof p.acceptedCount !== 'number' || typeof p.rejectedCount !== 'number') return null;
  return {
    ts: p.ts,
    label: p.label,
    via: p.via,
    acceptedCount: Math.max(0, Math.floor(p.acceptedCount)),
    rejectedCount: Math.max(0, Math.floor(p.rejectedCount)),
    note: typeof p.note === 'string' && p.note.trim() ? p.note : undefined,
  };
}

function readPersisted(): PersistedMemory {
  const empty: PersistedMemory = {
    styleNotes: [],
    approvedPatterns: [],
    ignoredSuggestions: [],
    enabled: true,
  };
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(AGENT_MEMORY_STORAGE_KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<PersistedMemory>;
    if (!v || typeof v !== 'object') return empty;
    const patterns = Array.isArray(v.approvedPatterns)
      ? v.approvedPatterns.map(sanitizePattern).filter((p): p is ApprovedPattern => p !== null)
      : [];
    return {
      // 去重后保留最新（末尾）30 条，与运行中 capStyleNotes 的淘汰语义一致
      styleNotes: sanitizeStrings(v.styleNotes).slice(-STYLE_NOTES_CAP),
      // 超上限时保留最近（ts 新，平局取靠后者）的条目
      approvedPatterns: capPatterns(patterns),
      ignoredSuggestions: sanitizeStrings(v.ignoredSuggestions),
      enabled: v.enabled !== false,
    };
  } catch {
    return empty; // 坏 JSON / 环境异常整体回退
  }
}

const initial = readPersisted();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function capStyleNotes(notes: string[]): string[] {
  return notes.length > STYLE_NOTES_CAP ? notes.slice(notes.length - STYLE_NOTES_CAP) : notes;
}

/** 保留最近 PATTERNS_CAP 条：按 ts 降序，ts 相同（同一毫秒内多次裁决）按数组位置靠后者为新 */
function capPatterns(patterns: ApprovedPattern[]): ApprovedPattern[] {
  if (patterns.length <= PATTERNS_CAP) return patterns;
  return patterns
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p.ts - a.p.ts || b.i - a.i)
    .slice(0, PATTERNS_CAP)
    .map(({ p }) => p);
}

export const useAgentMemoryStore = create<AgentMemoryState>()((set) => ({
  styleNotes: initial.styleNotes,
  approvedPatterns: initial.approvedPatterns,
  ignoredSuggestions: initial.ignoredSuggestions,
  enabled: initial.enabled,

  recordApproval: (proposal, accepted, partialCount) =>
    set((s) => {
      const derived = deriveStyleNote(proposal.before, proposal.after);
      // note 归纳优先级：部分采纳（保守） > 采纳且可归纳（风格） > 拒绝且无风格增益（拒绝原因）；
      // 拒绝但能归纳出风格差异时，用户否决了该方向，不可记为偏好 → 保留 pattern 原有 note。
      let notePatch: Partial<Pick<ApprovedPattern, 'note'>>;
      if (accepted && partialCount !== undefined) notePatch = { note: PARTIAL_NOTE };
      else if (accepted && derived !== null) notePatch = { note: derived };
      else if (!accepted && derived === null) notePatch = { note: REJECT_NO_GAIN_NOTE };
      else notePatch = {};

      const idx = s.approvedPatterns.findIndex(
        (p) => p.label === proposal.label && p.via === proposal.via,
      );
      let approvedPatterns: ApprovedPattern[];
      if (idx >= 0) {
        approvedPatterns = s.approvedPatterns.map((p, i) =>
          i === idx
            ? {
                ...p,
                ...notePatch,
                ts: Date.now(),
                acceptedCount: p.acceptedCount + (accepted ? 1 : 0),
                rejectedCount: p.rejectedCount + (accepted ? 0 : 1),
              }
            : p,
        );
      } else {
        approvedPatterns = [
          ...s.approvedPatterns,
          {
            ts: Date.now(),
            label: proposal.label,
            via: proposal.via,
            acceptedCount: accepted ? 1 : 0,
            rejectedCount: accepted ? 0 : 1,
            ...notePatch,
          },
        ];
      }

      // 完整采纳且归纳出风格偏好 → 追加进 styleNotes（去重 + 上限淘汰最旧）
      let styleNotes = s.styleNotes;
      if (accepted && partialCount === undefined && derived !== null && !s.styleNotes.includes(derived)) {
        styleNotes = capStyleNotes([...s.styleNotes, derived]);
      }
      return { approvedPatterns: capPatterns(approvedPatterns), styleNotes };
    }),

  addStyleNote: (note) =>
    set((s) => {
      const trimmed = note.trim();
      if (!trimmed || s.styleNotes.includes(trimmed)) return {};
      return { styleNotes: capStyleNotes([...s.styleNotes, trimmed]) };
    }),

  removeStyleNote: (index) =>
    set((s) => {
      if (index < 0 || index >= s.styleNotes.length) return {};
      return { styleNotes: s.styleNotes.filter((_, i) => i !== index) };
    }),

  toggleIgnored: (suggestion) =>
    set((s) => {
      const has = s.ignoredSuggestions.includes(suggestion);
      return {
        ignoredSuggestions: has
          ? s.ignoredSuggestions.filter((x) => x !== suggestion)
          : [...s.ignoredSuggestions, suggestion],
      };
    }),

  setEnabled: (enabled) => set({ enabled }),

  clearAll: () =>
    set((s) => ({ styleNotes: [], approvedPatterns: [], ignoredSuggestions: [], enabled: s.enabled })),
}));

// 持久化订阅：任何变更即整体快照写入（失败不打断 UI）
useAgentMemoryStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedMemory = {
        styleNotes: s.styleNotes,
        approvedPatterns: s.approvedPatterns,
        ignoredSuggestions: s.ignoredSuggestions,
        enabled: s.enabled,
      };
      localStorage.setItem(AGENT_MEMORY_STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});

/** 读取当前持久化内容（测试与调试用）。 */
export function readPersistedAgentMemory(): PersistedMemory {
  return readPersisted();
}

/**
 * 审批记录便捷入口（集成者接线用）：等价
 * useAgentMemoryStore.getState().recordApproval(...)。
 * AgentPanel onAccept：recordApproval(proposal, true, accepted === 'all' ? undefined : accepted.length)
 * AgentPanel onReject（discardProposal）：recordApproval(proposal, false)
 */
export function recordApproval(proposal: MemoryApprovalInput, accepted: boolean, partialCount?: number): void {
  useAgentMemoryStore.getState().recordApproval(proposal, accepted, partialCount);
}
