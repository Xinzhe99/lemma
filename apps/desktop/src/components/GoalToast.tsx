/**
 * 每日目标达成通知（v2.7.0 ④）：wordsToday ≥ dailyGoal 时在顶部弹出激励横幅。
 * 只在首次达标的瞬间显示（本会话），点击关闭或 5 秒自动消失。
 */

import { useEffect, useState, useRef } from 'react';
import { useWritingStatsStore } from '../state/writingStats';
import { useSettingsStore, type Language } from '../state/settingsStore';

const STRINGS = {
  zh: {
    message: (n: number, goal: number) => `🎉 今日目标达成！已写 ${n} 字 / 目标 ${goal} 字`,
    close: '知道了',
  },
  en: {
    message: (n: number, goal: number) => `🎉 Daily goal reached! ${n} / ${goal} words`,
    close: 'Got it',
  },
} as const;

export function GoalToast() {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];
  const wordsToday = useWritingStatsStore((s) => s.wordsToday);
  const dailyGoal = useWritingStatsStore((s) => s.dailyGoal);

  const [visible, setVisible] = useState(false);
  const celebratedRef = useRef(false);

  useEffect(() => {
    if (dailyGoal <= 0) return;
    const justHit = wordsToday >= dailyGoal;
    if (justHit && !celebratedRef.current) {
      celebratedRef.current = true;
      setVisible(true);
      const t = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(t);
    }
    // 新的一天（wordsToday 归零）重置庆祝标记
    if (!justHit && celebratedRef.current && wordsToday < dailyGoal * 0.5) {
      celebratedRef.current = false;
    }
  }, [wordsToday, dailyGoal]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 50,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1000,
        background: 'var(--accent)',
        color: '#ffffff',
        borderRadius: '10px',
        padding: '10px 20px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        display: 'flex',
        gap: 12,
        alignItems: 'center',
        fontSize: 14,
        fontWeight: 600,
        animation: 'sf-goal-toast-in 0.4s ease',
      }}
    >
      <span>{L.message(wordsToday, dailyGoal)}</span>
      <button
        type="button"
        onClick={() => setVisible(false)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(255,255,255,0.4)',
          borderRadius: 999,
          color: '#ffffff',
          padding: '2px 10px',
          fontSize: 12,
          cursor: 'pointer',
        }}
      >
        {L.close}
      </button>
    </div>
  );
}
