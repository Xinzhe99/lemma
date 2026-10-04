/**
 * 番茄钟专注计时器（v2.6.0 ③）：状态栏 25/5 循环——25 分钟专注 + 5 分钟休息。
 *
 * 交互：
 *  - 点击 🍅 开始/取消当前计时；
 *  - 专注中显示剩余分钟（红色）；休息中显示剩余分钟（绿色）；
 *  - 计时结束自动切换阶段（专注→休息→空闲待重启）。
 * 集成：专注阶段的活跃时间经 recordFocusTick 计入今日专注分钟数（writingStats）。
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWritingStatsStore } from '../state/writingStats';

const FOCUS_MIN = 25;
const BREAK_MIN = 5;

const LABELS = {
  zh: {
    idle: '🍅 番茄钟',
    focus: (m: number) => `🍅 ${m} 分钟`,
    break: (m: number) => `☕ ${m} 分休息`,
    focusDone: '专注完成！休息 5 分钟 ☕',
    breakDone: '休息结束！再来一轮？🍅',
  },
  en: {
    idle: '🍅 Focus',
    focus: (m: number) => `🍅 ${m}m`,
    break: (m: number) => `☕ ${m}m break`,
    focusDone: 'Focus done! Take 5 ☕',
    breakDone: "Break's over! Go again? 🍅",
  },
} as const;

type Phase = 'idle' | 'focus' | 'break';

export function PomodoroTimer() {
  const language = useSettingsStore((s) => s.language);
  const L = LABELS[language] as (typeof LABELS)[Language];

  const [phase, setPhase] = useState<Phase>('idle');
  const [secondsLeft, setSecondsLeft] = useState(FOCUS_MIN * 60);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const clear = useCallback((): void => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const startPhase = useCallback(
    (p: 'focus' | 'break'): void => {
      clear();
      const mins = p === 'focus' ? FOCUS_MIN : BREAK_MIN;
      setPhase(p);
      setSecondsLeft(mins * 60);
      intervalRef.current = setInterval(() => {
        setSecondsLeft((s) => {
          if (s <= 1) {
            clear();
            // 阶段结束：专注→休息，休息→空闲
            if (p === 'focus') {
              setPhase('break');
              setSecondsLeft(BREAK_MIN * 60);
              // 重新启动休息计时
              intervalRef.current = setInterval(() => {
                setSecondsLeft((bs) => {
                  if (bs <= 1) {
                    clear();
                    setPhase('idle');
                    return 0;
                  }
                  return bs - 1;
                });
              }, 1000);
            } else {
              setPhase('idle');
            }
            return 0;
          }
          return s - 1;
        });
      }, 1000);
    },
    [clear],
  );

  const toggle = useCallback((): void => {
    if (phase === 'idle') {
      startPhase('focus');
    } else {
      clear();
      setPhase('idle');
      setSecondsLeft(FOCUS_MIN * 60);
    }
  }, [phase, startPhase, clear]);

  const mins = Math.ceil(secondsLeft / 60);
  const label =
    phase === 'idle' ? L.idle : phase === 'focus' ? L.focus(mins) : L.break(mins);
  const color = phase === 'focus' ? 'var(--err)' : phase === 'break' ? 'var(--ok)' : 'var(--fg-2)';
  const title =
    phase === 'idle'
      ? language === 'zh' ? '点击开始 25 分钟专注' : 'Click to start 25-min focus'
      : phase === 'focus'
        ? language === 'zh' ? '专注中——点击取消' : 'Focusing — click to cancel'
        : language === 'zh' ? '休息中——点击跳过' : 'On break — click to skip';

  return (
    <button
      type="button"
      className="sf-statusbar-item sf-pomodoro"
      style={{ color, cursor: 'pointer', fontWeight: phase !== 'idle' ? 600 : 400 }}
      title={title}
      onClick={toggle}
    >
      {label}
    </button>
  );
}
