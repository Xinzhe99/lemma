/**
 * 写作统计对话框（命令 stats.open）：
 * - 今日字数 + 目标进度条（div 宽度百分比，超 100% 封顶并显示 ✓）；
 * - 连续达标天数（🔥 N 天，0 天灰显）；
 * - 最近 7 天柱状图（纯 div 高度柱，悬停 title 含日期与字数）；
 * - 目标设置（number input + 保存，50–10000 钳制在 store 内完成）；
 * - 项目统计：各 .tex 文件字数列表（降序）+ 总字数 + 预计阅读时长（200 字/分钟）。
 * 数据源：writingStatsStore（读写）+ workspaceStore.files（只读）；zh/en 组件内字典；
 * 不新增 CSS（进度条 / 柱状图用内联样式）。
 */

import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import {
  READ_WPM,
  computeProjectWords,
  lastNDays,
  todayKey,
  useWritingStatsStore,
} from '../state/writingStats';
import { countWords } from './StatusBar';

const STRINGS = {
  zh: {
    title: '写作统计',
    todayWords: '今日字数',
    dailyGoal: '每日目标',
    streakLabel: '连续达标',
    days: '天',
    recent: '最近 7 天',
    goalSetting: '目标设置',
    goalHint: '范围 50 – 10000 字',
    save: '保存',
    projectStats: '项目统计',
    perFile: '各文件字数',
    totalWords: '总字数',
    readingTime: '预计阅读时长',
    wordsUnit: '字',
    perMinUnit: '字/分钟',
    noTex: '项目中暂无 .tex 文件',
    close: '关闭',
  },
  en: {
    title: 'Writing statistics',
    todayWords: 'Words today',
    dailyGoal: 'Daily goal',
    streakLabel: 'Streak',
    days: 'days',
    recent: 'Last 7 days',
    goalSetting: 'Goal setting',
    goalHint: 'Range 50 – 10,000 words',
    save: 'Save',
    projectStats: 'Project stats',
    perFile: 'Words per file',
    totalWords: 'Total words',
    readingTime: 'Est. reading time',
    wordsUnit: 'words',
    perMinUnit: 'wpm',
    noTex: 'No .tex files in this project',
    close: 'Close',
  },
} as const;

const SECTION_GAP = { marginTop: 20 } as const;

export function StatsDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];

  const files = useWorkspaceStore((s) => s.files);
  const today = useWritingStatsStore((s) => s.today);
  const dailyGoal = useWritingStatsStore((s) => s.dailyGoal);
  const wordsToday = useWritingStatsStore((s) => s.wordsToday);
  const history = useWritingStatsStore((s) => s.history);
  const streakDays = useWritingStatsStore((s) => s.streakDays);
  const setDailyGoal = useWritingStatsStore((s) => s.setDailyGoal);
  const ensureToday = useWritingStatsStore((s) => s.ensureToday);

  const [goalInput, setGoalInput] = useState(String(dailyGoal));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 挂载即校正跨天（应用跨午夜打开时不把昨日的计数当成今天）
  useEffect(() => {
    ensureToday();
  }, [ensureToday]);

  // —— 今日进度 ——
  const rawPct = dailyGoal > 0 ? (wordsToday / dailyGoal) * 100 : 0;
  const pct = Math.min(100, Math.max(0, Math.round(rawPct)));
  const goalMet = dailyGoal > 0 && wordsToday >= dailyGoal;

  // —— 最近 7 天柱状图（升序，最后一天为今日） ——
  const days = useMemo(() => lastNDays(7, todayKey()), []);
  const wordsByDay = useMemo(() => {
    const map: Record<string, number> = {};
    for (const day of days) map[day] = day === today ? wordsToday : (history[day] ?? 0);
    return map;
  }, [days, today, wordsToday, history]);
  const chartMax = useMemo(
    () => Math.max(dailyGoal, ...days.map((d) => wordsByDay[d] ?? 0), 1),
    [days, wordsByDay, dailyGoal],
  );

  // —— 项目统计（.tex 文件字数降序 + 总字数 + 预计阅读时长） ——
  const texFiles = useMemo(
    () =>
      Object.entries(files)
        .filter(([path]) => path.toLowerCase().endsWith('.tex'))
        .map(([path, content]) => ({ path, words: countWords(content) }))
        .sort((a, b) => b.words - a.words || a.path.localeCompare(b.path)),
    [files],
  );
  const totalWords = useMemo(() => computeProjectWords(files), [files]);
  const readMinutes = Math.round(totalWords / READ_WPM);

  const handleSaveGoal = (): void => {
    const trimmed = goalInput.trim();
    if (!trimmed) return;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    setDailyGoal(n);
    // 回填钳制后的实际值（输入越界时输入框同步为 50/10000）
    setGoalInput(String(useWritingStatsStore.getState().dailyGoal));
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          {/* —— 今日：字数 + 进度条 + 连续达标 —— */}
          <section className="sf-stats-today">
            <div className="sf-stats-today-row" style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
              <span className="sf-stats-today-words" style={{ fontSize: 22, fontWeight: 600 }}>
                {L.todayWords} {wordsToday}
              </span>
              <span className="sf-stats-streak" style={streakDays > 0 ? undefined : { opacity: 0.45 }}>
                🔥 {streakDays} {L.days}
              </span>
            </div>
            <div className="sf-stats-progress" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div
                className="sf-stats-progress-track"
                style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--bg-3)', overflow: 'hidden' }}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct}
              >
                <div
                  className="sf-stats-progress-fill"
                  style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }}
                />
              </div>
              <span className="sf-stats-progress-pct" style={{ minWidth: 48, textAlign: 'right' }}>
                {goalMet ? `✓ ${pct}%` : `${pct}%`}
              </span>
            </div>
            <div style={{ marginTop: 4, color: 'var(--fg-1)', fontSize: 12 }}>
              {L.dailyGoal} {dailyGoal} {L.wordsUnit}
            </div>
          </section>

          {/* —— 最近 7 天柱状图（纯 div） —— */}
          <section className="sf-stats-chart-section" style={SECTION_GAP}>
            <div className="sf-stats-chart-title" style={{ marginBottom: 8 }}>
              {L.recent}
            </div>
            <div
              className="sf-stats-chart"
              style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 96 }}
            >
              {days.map((day) => {
                const words = wordsByDay[day] ?? 0;
                const height = words > 0 ? Math.max(3, Math.round((words / chartMax) * 100)) : 0;
                return (
                  <div
                    key={day}
                    className="sf-stats-bar-col"
                    style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center', gap: 4, height: '100%' }}
                    title={`${day} · ${words} ${L.wordsUnit}`}
                  >
                    <div
                      className="sf-stats-bar"
                      style={{
                        width: '62%',
                        height: `${height}%`,
                        minHeight: words > 0 ? 3 : 0,
                        borderRadius: 2,
                        background: words >= dailyGoal ? 'var(--accent)' : 'var(--border-strong)',
                      }}
                    />
                    <span style={{ fontSize: 10, color: 'var(--fg-2)' }}>{day.slice(5)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* —— 目标设置 —— */}
          <section className="sf-stats-goal" style={SECTION_GAP}>
            <div style={{ marginBottom: 8 }}>{L.goalSetting}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                className="sf-input sf-stats-goal-input"
                type="number"
                min={50}
                max={10000}
                step={50}
                aria-label={L.dailyGoal}
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                style={{ width: 120 }}
              />
              <button className="sf-btn" onClick={handleSaveGoal}>
                {L.save}
              </button>
              <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>{L.goalHint}</span>
            </div>
          </section>

          {/* —— 项目统计 —— */}
          <section className="sf-stats-project" style={SECTION_GAP}>
            <div style={{ marginBottom: 8 }}>{L.projectStats}</div>
            {texFiles.length === 0 ? (
              <p className="placeholder">{L.noTex}</p>
            ) : (
              <ul className="sf-stats-files" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {texFiles.map(({ path, words }) => (
                  <li
                    key={path}
                    className="sf-stats-file-row"
                    style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '3px 0' }}
                  >
                    <span className="sf-stats-file-path" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {path}
                    </span>
                    <span className="sf-stats-file-words" style={{ flexShrink: 0, color: 'var(--fg-1)' }}>
                      {words}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="sf-stats-total" style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
              <span>
                {L.totalWords} · {L.perFile}
              </span>
              <span>{totalWords}</span>
            </div>
            <div className="sf-stats-reading" style={{ marginTop: 4, display: 'flex', justifyContent: 'space-between', color: 'var(--fg-1)' }}>
              <span>
                {L.readingTime}（{READ_WPM} {L.perMinUnit}）
              </span>
              <span>
                {language === 'en' ? `~${readMinutes} min` : `约 ${readMinutes} 分钟`}
              </span>
            </div>
          </section>

          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={onClose}>
              {L.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
