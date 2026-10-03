/**
 * 写作统计（每日字数目标 / 连续达标天数 / 项目统计）：
 * - 自动统计接线：模块加载即订阅 workspaceStore（只读，不改其文件），比较前后项目总字数
 *   （全部 .tex 文件 countWords 之和），正增量经 recordDelta 计入当日；负增量（删稿）不回退当日。
 *   项目切换（projectName 变化）只重置基线，不把换项目带来的字数差计入写作。
 * - 纯函数（todayKey / shiftDay / lastNDays / computeStreak / computeProjectWords / wordsDelta）
 *   一并导出，便于单测与 StatsDialog 复用。
 * - 持久化：localStorage（key: sf-writing-stats），读取做 shape 校验，坏数据回退默认值。
 */

import { create } from 'zustand';
import { useWorkspaceStore } from './workspaceStore';
import { countTexWords } from '../components/StatusBar';

export const WRITING_STATS_STORAGE_KEY = 'sf-writing-stats';

export const DAILY_GOAL_MIN = 50;
export const DAILY_GOAL_MAX = 10_000;
export const DEFAULT_DAILY_GOAL = 500;

/** 历史归档最多保留天数（约一年，防 localStorage 无限膨胀） */
const HISTORY_LIMIT_DAYS = 366;
/** streak 计算的安全上限（约 10 年），防御坏数据导致的超长循环 */
const STREAK_HARD_CAP = 3660;

/** 预计阅读速度（字/分钟），StatsDialog 的项目统计用 */
export const READ_WPM = 200;

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 纯函数：日期键（本地时区）
// ---------------------------------------------------------------------------

/** 本地时区的日期键 YYYY-MM-DD */
export function todayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 日期键平移 n 天（本地时区，n 可为负）；非法 key 原样返回 */
export function shiftDay(key: string, n: number): string {
  if (!DATE_KEY_RE.test(key)) return key;
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y!, (m! - 1)!, d! + n);
  return todayKey(dt);
}

/** 最近 n 天的日期键（升序，含 today）；n <= 0 或 today 非法返回空数组 */
export function lastNDays(n: number, today: string = todayKey()): string[] {
  if (n <= 0 || !DATE_KEY_RE.test(today)) return [];
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) days.push(shiftDay(today, -i));
  return days;
}

// ---------------------------------------------------------------------------
// 纯函数：连续达标天数
// ---------------------------------------------------------------------------

/**
 * 从今天往前连续 words >= goal 的天数。今天已达标则计入今天；
 * 今天未达标不计入但不断链（从昨天开始数）。goal <= 0 或 today 非法时恒为 0。
 */
export function computeStreak(history: Record<string, number>, goal: number, today: string): number {
  if (goal <= 0 || !DATE_KEY_RE.test(today)) return 0;
  let streak = (history[today] ?? 0) >= goal ? 1 : 0;
  let cursor = shiftDay(today, -1);
  while (streak < STREAK_HARD_CAP && (history[cursor] ?? 0) >= goal) {
    streak += 1;
    cursor = shiftDay(cursor, -1);
  }
  return streak;
}

// ---------------------------------------------------------------------------
// 纯函数：项目总字数 / 增量
// ---------------------------------------------------------------------------

/** 项目总字数：全部 .tex 文件（路径后缀不区分大小写）countWords 之和 */
export function computeProjectWords(files: Record<string, string>): number {
  let total = 0;
  for (const [path, content] of Object.entries(files)) {
    if (path.toLowerCase().endsWith('.tex')) total += countTexWords(content);
  }
  return total;
}

/** 前后总字数增量（可为负；调用方只在 > 0 时计入当日写作） */
export function wordsDelta(prev: number, next: number): number {
  return next - prev;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export interface WritingStatsState {
  /** 当日日期键（本地时区）；与实际日期不符时在下次写入 / ensureToday 触发 rollover */
  today: string;
  /** 每日字数目标（50–10000） */
  dailyGoal: number;
  /** 今日已写字数（仅正增量累计） */
  wordsToday: number;
  /** 归档的每日字数（key: YYYY-MM-DD） */
  history: Record<string, number>;
  /** 连续达标天数（今天未达标不计入但不断昨天链） */
  streakDays: number;
  /** 今日专注写作分钟数（击键间隔 <30s 的连续段累计） */
  focusMinutes: number;
  /** 记一笔增量：仅正增量累计；跨天时先归档昨日并重置（rollover） */
  recordDelta(n: number): void;
  /** 设置每日目标（50–10000 钳制），并按新目标重算 streak */
  setDailyGoal(n: number): void;
  /** 校正跨天展示（挂载时调用；today 落后于实际日期则 rollover） */
  ensureToday(): void;
  /** 写作活动心跳：由编辑器 onChange 调用；距上次心跳 <FOCUS_GAP_S 秒视为持续专注，
   *  累计一段；超间隔开新段。内部节流（每 tick 只在整分钟变更时 set）。 */
  recordFocusTick(): void;
}

type StatsCore = Pick<WritingStatsState, 'today' | 'dailyGoal' | 'wordsToday' | 'history'>;

function clampGoal(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_DAILY_GOAL;
  return Math.min(DAILY_GOAL_MAX, Math.max(DAILY_GOAL_MIN, Math.round(n)));
}

/** 历史只保留最近 HISTORY_LIMIT_DAYS 天（按日期键排序取新） */
function pruneHistory(history: Record<string, number>): Record<string, number> {
  const keys = Object.keys(history);
  if (keys.length <= HISTORY_LIMIT_DAYS) return history;
  const keep = new Set(keys.sort().slice(keys.length - HISTORY_LIMIT_DAYS));
  return Object.fromEntries(Object.entries(history).filter(([k]) => keep.has(k)));
}

/** 跨天 rollover：归档当日 → 重置计数 → 以首笔增量 n 开启新的一天，并重算 streak */
function roll<T extends StatsCore>(s: T, n: number): T & { streakDays: number } {
  const now = todayKey();
  const history = pruneHistory({ ...s.history, [s.today]: s.wordsToday });
  const wordsToday = n > 0 ? n : 0;
  return {
    ...s,
    today: now,
    wordsToday,
    history,
    streakDays: computeStreak({ ...history, [now]: wordsToday }, s.dailyGoal, now),
  };
}

/** 今日（含尚未归档的当日计数）参与 streak 判定的历史视图 */
function historyWithToday(s: StatsCore, wordsToday: number): Record<string, number> {
  return { ...s.history, [s.today]: wordsToday };
}

// ---------------------------------------------------------------------------
// 持久化（sf-writing-stats，shape 校验 + 坏数据回退）
// ---------------------------------------------------------------------------

interface PersistedStats {
  today: string;
  dailyGoal: number;
  wordsToday: number;
  history: Record<string, number>;
  streakDays: number;
  focusMinutes: number;
}

function defaultPersisted(): PersistedStats {
  const today = todayKey();
  return { today, dailyGoal: DEFAULT_DAILY_GOAL, wordsToday: 0, history: {}, streakDays: 0, focusMinutes: 0 };
}

function readPersisted(): PersistedStats {
  try {
    const raw =
      typeof localStorage === 'undefined'
        ? null
        : localStorage.getItem(WRITING_STATS_STORAGE_KEY);
    if (!raw) return defaultPersisted();
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== 'object' || Array.isArray(v)) return defaultPersisted();
    const o = v as Partial<PersistedStats>;

    const history: Record<string, number> = {};
    if (o.history && typeof o.history === 'object' && !Array.isArray(o.history)) {
      for (const [k, val] of Object.entries(o.history)) {
        if (DATE_KEY_RE.test(k) && typeof val === 'number' && Number.isFinite(val) && val >= 0) {
          history[k] = val;
        }
      }
    }

    const today =
      typeof o.today === 'string' && DATE_KEY_RE.test(o.today) ? o.today : todayKey();
    const dailyGoal =
      typeof o.dailyGoal === 'number' && Number.isFinite(o.dailyGoal)
        ? clampGoal(o.dailyGoal)
        : DEFAULT_DAILY_GOAL;
    const wordsToday =
      typeof o.wordsToday === 'number' && Number.isFinite(o.wordsToday) && o.wordsToday >= 0
        ? o.wordsToday
        : 0;
    // streakDays 不信任持久化值，由历史重算（含尚未归档的当日计数）
    return {
      today,
      dailyGoal,
      wordsToday,
      history: pruneHistory(history),
      streakDays: computeStreak(historyWithToday({ today, dailyGoal, wordsToday, history }, wordsToday), dailyGoal, today),
      focusMinutes: typeof o.focusMinutes === 'number' && Number.isFinite(o.focusMinutes) && o.focusMinutes >= 0 ? o.focusMinutes : 0,
    };
  } catch {
    return defaultPersisted();
  }
}

const initial = readPersisted();
// 启动即校正跨天（隔天重开应用时不把昨日的 wordsToday 当成今天）
const startingState = initial.today === todayKey() ? initial : roll(initial, 0);

export const useWritingStatsStore = create<WritingStatsState>()((set) => ({
  ...startingState,

  recordDelta(n) {
    set((s) => {
      if (s.today !== todayKey()) return roll(s, n);
      if (!(n > 0)) return s;
      const wordsToday = s.wordsToday + n;
      return {
        wordsToday,
        streakDays: computeStreak(historyWithToday(s, wordsToday), s.dailyGoal, s.today),
      };
    });
  },

  setDailyGoal(n) {
    set((s) => {
      const dailyGoal = clampGoal(n);
      const base = s.today === todayKey() ? s : roll(s, 0);
      return {
        ...base,
        dailyGoal,
        streakDays: computeStreak(historyWithToday(base, base.wordsToday), dailyGoal, base.today),
      };
    });
  },

  recordFocusTick() {
    recordFocusTickImpl(
      (patch) => set((s) => ({ ...s, ...patch })),
      () => useWritingStatsStore.getState(),
    );
  },

  ensureToday() {
    set((s) => (s.today === todayKey() ? s : roll(s, 0)));
  },
}));

useWritingStatsStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedStats = {
        today: s.today,
        dailyGoal: s.dailyGoal,
        wordsToday: s.wordsToday,
        history: s.history,
        streakDays: s.streakDays,
      focusMinutes: s.focusMinutes,
      };
      localStorage.setItem(WRITING_STATS_STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});

/** 读取当前持久化内容（测试与调试用）。 */
export function readPersistedStats(): PersistedStats | null {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(WRITING_STATS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedStats) : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 自动统计接线：项目总字数正向增量 → 当日写作字数
// （订阅在模块加载时注册；workspaceStore 为只读依赖，不在其文件内改动）
// ---------------------------------------------------------------------------

/** 基线 = { 项目名, 项目总字数 }；项目名变化视为切换项目，只重置基线不计增量 */
let statsBaseline: { project: string; words: number } | null = null;

useWorkspaceStore.subscribe((s, prev) => {
  if (s.files === prev.files) return;
  const words = computeProjectWords(s.files);
  if (statsBaseline === null || statsBaseline.project !== s.projectName) {
    statsBaseline = { project: s.projectName, words };
    return;
  }
  const delta = wordsDelta(statsBaseline.words, words);
  if (delta > 0) useWritingStatsStore.getState().recordDelta(delta);
  statsBaseline = { project: statsBaseline.project, words };
});


// ---------------------------------------------------------------------------
// 专注计时（v1.9.0 ③）：模块级时间戳追踪
// ---------------------------------------------------------------------------

/** 击键间隔超过此秒数视为专注中断 */
export const FOCUS_GAP_S = 30;
/** 心跳最小间隔（秒）：避免高频 set */
const TICK_MIN_S = 5;

let lastTickAt = 0;
let lastPersistAt = 0;

function recordFocusTickImpl(set: (patch: Partial<WritingStatsState>) => void, get: () => WritingStatsState): void {
  const now = Date.now();
  if (lastTickAt === 0) {
    lastTickAt = now;
    return;
  }
  const gapS = (now - lastTickAt) / 1000;
  lastTickAt = now;
  if (gapS > FOCUS_GAP_S) return; // 中断后重新开始，不计入
  if (now - lastPersistAt < TICK_MIN_S * 1000) return; // 节流
  lastPersistAt = now;
  const s = get();
  // 每心跳约 5s → 换算分钟（粗粒度累计）
  set({ focusMinutes: s.focusMinutes + Math.round(gapS / 60 * 10) / 10 });
}
