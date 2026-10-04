/**
 * 写作进度图（v2.8.0 ②）：最近 30 天每日字数柱状图（纯 div，无图表库）。
 * LazyPanel 契约：export function WritingChartPanel()。
 */

import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWritingStatsStore } from '../state/writingStats';

const STRINGS = {
  zh: {
    title: '写作进度',
    desc: '最近 30 天每日字数',
    empty: '还没有写作记录——写下第一个字就出现在这里',
    total: (n: number) => `30 天累计 ${n.toLocaleString()} 字`,
    best: (n: number, d: string) => `最佳 ${n} 字（${d}）`,
    streak: (n: number) => `连续 ${n} 天`,
  },
  en: {
    title: 'Writing progress',
    desc: 'Words per day, last 30 days',
    empty: 'No writing yet — your first word will appear here',
    total: (n: number) => `${n.toLocaleString()} words in 30d`,
    best: (n: number, d: string) => `Best ${n} (${d})`,
    streak: (n: number) => `${n}-day streak`,
  },
} as const;

const BAR_MAX_H = 60;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function WritingChartPanel() {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];
  const history = useWritingStatsStore((s) => s.history);
  const wordsToday = useWritingStatsStore((s) => s.wordsToday);
  const streakDays = useWritingStatsStore((s) => s.streakDays);

  const chart = useMemo(() => {
    const days: { date: string; words: number; isToday: boolean }[] = [];
    const now = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      const isToday = i === 0;
      const words = isToday ? wordsToday : (history[key] ?? 0);
      days.push({ date: key, words, isToday });
    }
    const max = Math.max(1, ...days.map((d) => d.words));
    const total = days.reduce((s, d) => s + d.words, 0);
    const best = days.reduce((a, b) => (b.words > a.words ? b : a), days[0]!);
    return { days, max, total, best };
  }, [history, wordsToday]);

  if (chart.total === 0) {
    return (
      <div style={{ padding: '12px 10px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{L.title}</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>{L.empty}</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 10px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
        <BarChart3 size={14} /> {L.title}
      </h3>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--fg-2)' }}>{L.desc}</p>

      <div
        style={{
          display: 'flex',
          gap: 2,
          alignItems: 'flex-end',
          height: BAR_MAX_H + 18,
          borderBottom: '1px solid var(--border)',
          paddingBottom: 2,
        }}
      >
        {chart.days.map((d) => (
          <div
            key={d.date}
            title={`${d.date}: ${d.words} words`}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              alignItems: 'center',
              gap: 2,
            }}
          >
            {d.words > 0 && (
              <span style={{ fontSize: 8.5, color: 'var(--fg-2)', lineHeight: 1 }}>
                {d.words >= 100 ? d.words : ''}
              </span>
            )}
            <div
              style={{
                width: '100%',
                minHeight: d.words > 0 ? 3 : 1,
                height: Math.max(d.words > 0 ? 3 : 1, (d.words / chart.max) * BAR_MAX_H),
                borderRadius: 2,
                background: d.isToday
                  ? 'var(--accent)'
                  : d.words >= chart.best.words * 0.7
                    ? 'var(--accent-dim)'
                    : 'var(--border-strong)',
                opacity: d.words > 0 ? 1 : 0.3,
              }}
            />
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 6, fontSize: 11, color: 'var(--fg-2)', flexWrap: 'wrap' }}>
        <span>{L.total(chart.total)}</span>
        <span>·</span>
        <span>{L.best(chart.best.words, chart.best.date.slice(5))}</span>
        {streakDays > 1 && (
          <>
            <span>·</span>
            <span style={{ color: 'var(--accent-dim)' }}>🔥 {L.streak(streakDays)}</span>
          </>
        )}
      </div>
    </div>
  );
}
