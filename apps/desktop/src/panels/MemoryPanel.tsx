/**
 * 记忆管理面板（Agent 记忆系统的 UI）：
 * - 风格偏好列表：增删 + 忽略（忽略后不注入 Context Pack，记录保留，可恢复）；
 * - 审批统计卡：近期采纳率 / 采纳与拒绝计数 / 部分采纳（保守）提示 / 最高频拒绝原因；
 * - 忽略建议列表 + 总开关 + 清空全部学习数据。
 * 壳层契约：export function MemoryPanel()，无 props（LazyPanel 动态发现；
 * 集成者将 'MemoryPanel' 加入 LazyPanel 的 LazyPanelFile 联合与 glob 后挂「知识」页签）。
 * 文案：组件内自包含 zh/en 字典（不碰全局 i18n.ts）；样式：复用全局 sf-* 类 + 内联（不新增 css）。
 */

import { useMemo, useState } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import {
  PARTIAL_NOTE,
  REJECT_NO_GAIN_NOTE,
  memoryStats,
  useAgentMemoryStore,
} from '../state/agentMemory';
import { confirmDialog } from '../dialogs';

// ---------------------------------------------------------------------------
// 双语文案
// ---------------------------------------------------------------------------

interface MemoryDict {
  title: string;
  subtitle: string;
  enabledChip: string;
  disabledChip: string;
  turnOn: string;
  turnOff: string;
  clear: string;
  clearConfirm: string;
  disabledHint: string;
  notesTitle: string;
  notesEmpty: string;
  notesPh: string;
  add: string;
  remove: string;
  ignore: string;
  ignoredChip: string;
  statsTitle: string;
  statsEmpty: string;
  rateLabel: (pct: number) => string;
  countsLabel: (accepted: number, rejected: number) => string;
  partialHint: string;
  topReject: (reason: string) => string;
  ignoredTitle: string;
  ignoredEmpty: string;
  restore: string;
  patternsTitle: string;
  patternRow: (label: string, accepted: number, rejected: number) => string;
}

const DICT: Record<Language, MemoryDict> = {
  zh: {
    title: 'Agent 记忆',
    subtitle: '从你的审批历史学习偏好，注入后续 AI 生成的 Context Pack',
    enabledChip: '记忆已启用',
    disabledChip: '记忆已停用',
    turnOn: '启用记忆',
    turnOff: '停用记忆',
    clear: '清空全部',
    clearConfirm: '确认清空全部学习到的偏好与审批统计？（不可恢复）',
    disabledHint: '记忆已停用：偏好与统计不再注入 Context Pack（学习记录保留，可随时恢复）。',
    notesTitle: '风格偏好',
    notesEmpty: '暂无偏好。采纳 AI 修改时会自动归纳，也可在下方手动添加。',
    notesPh: '添加一条风格偏好（如：偏好更简洁的表达）…',
    add: '添加',
    remove: '删除',
    ignore: '忽略',
    ignoredChip: '已忽略',
    statsTitle: '审批统计',
    statsEmpty: '尚无审批记录——采纳或拒绝一次 AI 修改后，这里会出现采纳率与拒绝原因。',
    rateLabel: (pct) => `近期采纳率 ${pct}%`,
    countsLabel: (accepted, rejected) => `${accepted} 采纳 / ${rejected} 拒绝`,
    partialHint: '出现过部分采纳：你倾向保守，AI 将把重大改动拆分为小步提案',
    topReject: (reason) => `最高频拒绝原因：${reason}`,
    ignoredTitle: '忽略的建议',
    ignoredEmpty: '没有忽略的建议',
    restore: '恢复',
    patternsTitle: '近期审批模式',
    patternRow: (label, accepted, rejected) => `${label}：${accepted} 采纳 / ${rejected} 拒绝`,
  },
  en: {
    title: 'Agent memory',
    subtitle: 'Learns preferences from your approval history and injects them into the Context Pack',
    enabledChip: 'Memory on',
    disabledChip: 'Memory off',
    turnOn: 'Enable memory',
    turnOff: 'Disable memory',
    clear: 'Clear all',
    clearConfirm: 'Clear all learned preferences and approval stats? (irreversible)',
    disabledHint: 'Memory is off: preferences and stats are no longer injected (records are kept; re-enable anytime).',
    notesTitle: 'Style preferences',
    notesEmpty: 'No preferences yet. They are derived automatically when you accept AI edits, or add one below.',
    notesPh: 'Add a style preference (e.g. prefer more concise wording)…',
    add: 'Add',
    remove: 'Remove',
    ignore: 'Ignore',
    ignoredChip: 'Ignored',
    statsTitle: 'Approval stats',
    statsEmpty: 'No approvals yet — accept or reject an AI edit and the acceptance rate appears here.',
    rateLabel: (pct) => `Recent acceptance ${pct}%`,
    countsLabel: (accepted, rejected) => `${accepted} accepted / ${rejected} rejected`,
    partialHint: 'Partial acceptance seen: you prefer conservative changes; the AI will split big edits into small proposals',
    topReject: (reason) => `Most frequent rejection reason: ${reason}`,
    ignoredTitle: 'Ignored suggestions',
    ignoredEmpty: 'No ignored suggestions',
    restore: 'Restore',
    patternsTitle: 'Recent approval patterns',
    patternRow: (label, accepted, rejected) => `${label}: ${accepted} accepted / ${rejected} rejected`,
  },
};

// 拒绝原因的展示文案（store 中存中文常量，面板按语言映射）
const REASON_DISPLAY: Record<Language, Record<string, string>> = {
  zh: { [PARTIAL_NOTE]: PARTIAL_NOTE, [REJECT_NO_GAIN_NOTE]: REJECT_NO_GAIN_NOTE },
  en: {
    [PARTIAL_NOTE]: 'partial acceptance: user prefers conservative edits',
    [REJECT_NO_GAIN_NOTE]: 'rejected edits without clear stylistic gain',
  },
};

export function MemoryPanel() {
  const language = useSettingsStore((s) => s.language);
  const t = DICT[language];
  const styleNotes = useAgentMemoryStore((s) => s.styleNotes);
  const ignored = useAgentMemoryStore((s) => s.ignoredSuggestions);
  const patterns = useAgentMemoryStore((s) => s.approvedPatterns);
  const enabled = useAgentMemoryStore((s) => s.enabled);
  const [draft, setDraft] = useState('');

  const stats = useMemo(() => memoryStats(patterns), [patterns]);
  const visibleNotes = useMemo(
    () => styleNotes.filter((n) => !ignored.includes(n)),
    [styleNotes, ignored],
  );
  const recentPatterns = useMemo(
    () => [...patterns].sort((x, y) => y.ts - x.ts).slice(0, 5),
    [patterns],
  );
  const reasonText = (reason: string): string => REASON_DISPLAY[language][reason] ?? reason;

  const addNote = () => {
    const value = draft.trim();
    if (!value) return;
    useAgentMemoryStore.getState().addStyleNote(value);
    setDraft('');
  };

  const clearAll = () => {
    void confirmDialog(t.clearConfirm).then((ok) => {
      if (ok) useAgentMemoryStore.getState().clearAll();
    });
  };

  return (
    <div className="sf-memory-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
      {/* 头部：标题 + 总开关 + 清空 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>{t.title}</strong>
        <span className={`sf-chip ${enabled ? 'ok' : 'dim'}`}>{enabled ? t.enabledChip : t.disabledChip}</span>
        <span style={{ flex: 1 }} />
        <button
          className="sf-btn"
          onClick={() => useAgentMemoryStore.getState().setEnabled(!enabled)}
          aria-pressed={enabled}
        >
          {enabled ? t.turnOff : t.turnOn}
        </button>
        <button className="sf-btn" onClick={clearAll} disabled={styleNotes.length === 0 && patterns.length === 0}>
          {t.clear}
        </button>
      </div>
      <p className="sf-agent-note" style={{ margin: 0 }}>
        {t.subtitle}
      </p>
      {!enabled && (
        <p className="sf-agent-note" role="status" style={{ margin: 0 }}>
          {t.disabledHint}
        </p>
      )}

      {/* 区一：风格偏好（增删 + 忽略） */}
      <section className="sf-memory-notes" aria-label={t.notesTitle}>
        <div className="sf-agent-wf-title" style={{ margin: 0 }}>
          {t.notesTitle}
        </div>
        {visibleNotes.length === 0 ? (
          <p className="placeholder" style={{ margin: '4px 0' }}>
            {t.notesEmpty}
          </p>
        ) : (
          <ul style={{ margin: '4px 0', paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {visibleNotes.map((note) => (
              <li key={note} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ flex: 1 }}>{note}</span>
                <button
                  className="sf-link-btn"
                  onClick={() => useAgentMemoryStore.getState().toggleIgnored(note)}
                  title={t.ignore}
                >
                  {t.ignore}
                </button>
                <button
                  className="sf-link-btn"
                  onClick={() => useAgentMemoryStore.getState().removeStyleNote(styleNotes.indexOf(note))}
                  title={t.remove}
                >
                  {t.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            className="sf-input"
            value={draft}
            placeholder={t.notesPh}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addNote();
            }}
          />
          <button className="sf-btn" onClick={addNote} disabled={!draft.trim()}>
            {t.add}
          </button>
        </div>
      </section>

      {/* 区二：审批统计卡（采纳率 / 部分采纳提示 / 拒绝原因 / 近期模式） */}
      <section className="sf-memory-stats" aria-label={t.statsTitle}>
        <div className="sf-agent-wf-title" style={{ margin: 0 }}>
          {t.statsTitle}
        </div>
        {stats.total === 0 ? (
          <p className="placeholder" style={{ margin: '4px 0' }}>
            {t.statsEmpty}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '4px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="sf-chip ok">{t.rateLabel(Math.round((stats.rate ?? 0) * 100))}</span>
              <span className="sf-chip dim">{t.countsLabel(stats.accepted, stats.rejected)}</span>
            </div>
            {stats.partialHint && <p style={{ margin: 0 }}>{t.partialHint}</p>}
            {stats.topRejectReason && <p style={{ margin: 0 }}>{t.topReject(reasonText(stats.topRejectReason))}</p>}
            {recentPatterns.length > 0 && (
              <details>
                <summary className="sf-link-btn">{t.patternsTitle}</summary>
                <ul style={{ margin: '4px 0', paddingInlineStart: 18 }}>
                  {recentPatterns.map((p) => (
                    <li key={`${p.label}\u0000${p.via}`}>{t.patternRow(p.label, p.acceptedCount, p.rejectedCount)}</li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </section>

      {/* 区三：忽略的建议（恢复） */}
      <section className="sf-memory-ignored" aria-label={t.ignoredTitle}>
        <div className="sf-agent-wf-title" style={{ margin: 0 }}>
          {t.ignoredTitle}
        </div>
        {ignored.length === 0 ? (
          <p className="placeholder" style={{ margin: '4px 0' }}>
            {t.ignoredEmpty}
          </p>
        ) : (
          <ul style={{ margin: '4px 0', paddingInlineStart: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ignored.map((suggestion) => (
              <li key={suggestion} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="sf-chip dim">{t.ignoredChip}</span>
                <span style={{ flex: 1 }}>{suggestion}</span>
                <button
                  className="sf-link-btn"
                  onClick={() => useAgentMemoryStore.getState().toggleIgnored(suggestion)}
                >
                  {t.restore}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
