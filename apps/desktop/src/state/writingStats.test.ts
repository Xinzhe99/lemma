// @vitest-environment jsdom
/**
 * writingStats：recordDelta（正/负/零）、跨天 rollover 归档重置、computeStreak（连续/断链/
 * 今天已达标/今天未达标不断昨天链/空历史/坏参数）、goal 钳制、todayKey/shiftDay/lastNDays、
 * computeProjectWords / wordsDelta 纯函数、localStorage（sf-writing-stats）持久化往返与坏数据回退。
 * 订阅 workspaceStore 的自动接线本身不进单测（jsdom 下模块加载即注册；比较逻辑已提为纯函数）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DAILY_GOAL_MAX,
  DAILY_GOAL_MIN,
  DEFAULT_DAILY_GOAL,
  WRITING_STATS_STORAGE_KEY,
  computeProjectWords,
  computeStreak,
  lastNDays,
  shiftDay,
  todayKey,
  useWritingStatsStore,
  wordsDelta,
} from './writingStats';

/** 相对今天偏移 n 天的日期键（本地时区，跨月/跨年由 Date 归一化） */
function dayOffset(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

beforeEach(() => {
  localStorage.clear();
  useWritingStatsStore.setState({
    today: todayKey(),
    dailyGoal: DEFAULT_DAILY_GOAL,
    wordsToday: 0,
    history: {},
    streakDays: 0,
  });
});

describe('recordDelta（当日累计）', () => {
  it('正增量累计入当日；负增量与零忽略（删稿不回退）', () => {
    useWritingStatsStore.getState().recordDelta(10);
    useWritingStatsStore.getState().recordDelta(5);
    expect(useWritingStatsStore.getState().wordsToday).toBe(15);

    useWritingStatsStore.getState().recordDelta(-3);
    useWritingStatsStore.getState().recordDelta(0);
    expect(useWritingStatsStore.getState().wordsToday).toBe(15);
    expect(useWritingStatsStore.getState().history).toEqual({});
  });

  it('今日计数跨过目标时 streakDays 实时计入今天', () => {
    useWritingStatsStore.getState().recordDelta(100);
    expect(useWritingStatsStore.getState().streakDays).toBe(0); // 100 < 500
    useWritingStatsStore.getState().recordDelta(450);
    expect(useWritingStatsStore.getState().wordsToday).toBe(550);
    expect(useWritingStatsStore.getState().streakDays).toBe(1);
  });

  it('rollover：today 落后于实际日期时先归档昨日并重置，再记入当日', () => {
    const yesterday = dayOffset(-1);
    useWritingStatsStore.setState({ today: yesterday, wordsToday: 120, history: {} });
    useWritingStatsStore.getState().recordDelta(30);

    const s = useWritingStatsStore.getState();
    expect(s.today).toBe(todayKey());
    expect(s.history[yesterday]).toBe(120);
    expect(s.wordsToday).toBe(30);
  });

  it('rollover 后按归档历史重算 streakDays（昨天/前天达标而今天未达标 → 2）', () => {
    useWritingStatsStore.setState({
      today: dayOffset(-1),
      wordsToday: 600,
      history: { [dayOffset(-2)]: 600 },
    });
    useWritingStatsStore.getState().recordDelta(30); // 今天 30 < 500，不计入
    const s = useWritingStatsStore.getState();
    expect(s.streakDays).toBe(2);
    expect(s.history[dayOffset(-1)]).toBe(600);
  });

  it('ensureToday：隔天挂载时只 rollover 不记增量；同日为幂等', () => {
    useWritingStatsStore.setState({ today: dayOffset(-1), wordsToday: 88 });
    useWritingStatsStore.getState().ensureToday();
    let s = useWritingStatsStore.getState();
    expect(s.today).toBe(todayKey());
    expect(s.wordsToday).toBe(0);
    expect(s.history[dayOffset(-1)]).toBe(88);

    useWritingStatsStore.getState().ensureToday();
    s = useWritingStatsStore.getState();
    expect(s.today).toBe(todayKey());
    expect(s.wordsToday).toBe(0);
  });
});

describe('computeStreak（连续达标天数）', () => {
  const T = '2026-06-10';

  it('连续达标：今天 + 昨天 + 前天 → 3', () => {
    const history = { '2026-06-10': 600, '2026-06-09': 700, '2026-06-08': 500 };
    expect(computeStreak(history, 500, T)).toBe(3);
  });

  it('断链：昨天达标但前天为 0 → 只算到昨天', () => {
    const history = { '2026-06-09': 600, '2026-06-08': 0, '2026-06-07': 900 };
    expect(computeStreak(history, 500, T)).toBe(1);
  });

  it('今天已达标计入今天（昨天不达标 → 1）', () => {
    expect(computeStreak({ '2026-06-10': 500 }, 500, T)).toBe(1);
    expect(computeStreak({ '2026-06-10': 500, '2026-06-09': 100 }, 500, T)).toBe(1);
  });

  it('今天未达标不计入但不断昨天链（从昨天开始数）', () => {
    const history = { '2026-06-10': 100, '2026-06-09': 600, '2026-06-08': 600 };
    expect(computeStreak(history, 500, T)).toBe(2);
  });

  it('空历史 / 今天恰好达标边界（>=）', () => {
    expect(computeStreak({}, 500, T)).toBe(0);
    expect(computeStreak({ '2026-06-10': 499 }, 500, T)).toBe(0);
    expect(computeStreak({ '2026-06-10': 500 }, 500, T)).toBe(1);
  });

  it('坏参数防御：goal <= 0 或 today 非法 → 0（不死循环）', () => {
    expect(computeStreak({}, 0, T)).toBe(0);
    expect(computeStreak({}, -5, T)).toBe(0);
    expect(computeStreak({ '2026-06-10': 600 }, 500, 'not-a-date')).toBe(0);
  });
});

describe('setDailyGoal（50–10000 钳制）', () => {
  it('低于下限钳到 50，高于上限钳到 10000，区间内取整生效', () => {
    const st = useWritingStatsStore.getState();
    st.setDailyGoal(10);
    expect(useWritingStatsStore.getState().dailyGoal).toBe(DAILY_GOAL_MIN);
    useWritingStatsStore.getState().setDailyGoal(99_999);
    expect(useWritingStatsStore.getState().dailyGoal).toBe(DAILY_GOAL_MAX);
    useWritingStatsStore.getState().setDailyGoal(300.4);
    expect(useWritingStatsStore.getState().dailyGoal).toBe(300);
    useWritingStatsStore.getState().setDailyGoal(Number.NaN);
    expect(useWritingStatsStore.getState().dailyGoal).toBe(DEFAULT_DAILY_GOAL);
  });

  it('改目标后按新目标重算 streak（调低使昨天达标）', () => {
    useWritingStatsStore.setState({ history: { [dayOffset(-1)]: 120 }, wordsToday: 0 });
    useWritingStatsStore.getState().setDailyGoal(100);
    expect(useWritingStatsStore.getState().streakDays).toBe(1); // 昨天 120 >= 100
  });
});

describe('todayKey / shiftDay / lastNDays（本地时区日期键）', () => {
  it('todayKey 输出 YYYY-MM-DD 且月日补零', () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(todayKey(new Date(2026, 10, 21))).toBe('2026-11-21');
    expect(todayKey(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('shiftDay 跨月/跨年平移；lastNDays 升序含今天', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2025-12-31', 1)).toBe('2026-01-01');
    expect(lastNDays(3, '2026-06-10')).toEqual(['2026-06-08', '2026-06-09', '2026-06-10']);
    expect(lastNDays(0, '2026-06-10')).toEqual([]);
  });
});

describe('computeProjectWords / wordsDelta（自动统计的比较逻辑）', () => {
  it('只统计 .tex 文件（后缀不区分大小写）并求和', () => {
    const files = {
      'main.tex': '你好世界 hello', // 4 CJK + 1 拉丁 = 5
      'sections/intro.tex': '引言 two words', // 2 + 2 = 4
      'notes/MAIN.TEX': 'ok', // 1
      'refs.bib': 'should not count should not count', // 非 .tex
      'README.md': '不计入不计入', // 非 .tex
    };
    expect(computeProjectWords(files)).toBe(10);
    expect(computeProjectWords({})).toBe(0);
  });

  it('wordsDelta 返回 next - prev（可为负，由调用方判断 > 0）', () => {
    expect(wordsDelta(100, 150)).toBe(50);
    expect(wordsDelta(150, 100)).toBe(-50);
    expect(wordsDelta(80, 80)).toBe(0);
  });
});

describe('localStorage 持久化（sf-writing-stats）', () => {
  it('写入后可读取合法 JSON；重新加载模块恢复当日进度与目标', async () => {
    useWritingStatsStore.getState().setDailyGoal(800);
    useWritingStatsStore.getState().recordDelta(40);
    const raw = localStorage.getItem(WRITING_STATS_STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).wordsToday).toBe(40);

    vi.resetModules();
    const fresh = await import('./writingStats');
    const s = fresh.useWritingStatsStore.getState();
    expect(s.wordsToday).toBe(40);
    expect(s.dailyGoal).toBe(800);
    expect(s.today).toBe(todayKey());
    expect(s.streakDays).toBe(0); // 40 < 800
  });

  it('归档历史与 rollover 状态跨模块加载恢复', async () => {
    const yesterday = dayOffset(-1);
    useWritingStatsStore.setState({
      today: yesterday,
      wordsToday: 600,
      history: { [dayOffset(-2)]: 600 },
    });
    expect(localStorage.getItem(WRITING_STATS_STORAGE_KEY)).toBeTruthy();

    vi.resetModules();
    const fresh = await import('./writingStats');
    const s = fresh.useWritingStatsStore.getState();
    expect(s.today).toBe(todayKey()); // 启动即校正跨天
    expect(s.wordsToday).toBe(0);
    expect(s.history[yesterday]).toBe(600);
    expect(s.streakDays).toBe(2); // 昨天 + 前天达标
  });

  it('坏数据回退：损坏 JSON → 默认值', async () => {
    localStorage.setItem(WRITING_STATS_STORAGE_KEY, '{bad json');
    vi.resetModules();
    const broken = await import('./writingStats');
    const s = broken.useWritingStatsStore.getState();
    expect(s.dailyGoal).toBe(DEFAULT_DAILY_GOAL);
    expect(s.wordsToday).toBe(0);
    expect(s.history).toEqual({});
    expect(s.today).toBe(todayKey());
  });

  it('坏数据回退：字段类型错误被过滤 / 回退默认', async () => {
    localStorage.setItem(
      WRITING_STATS_STORAGE_KEY,
      JSON.stringify({
        today: todayKey(),
        dailyGoal: 'not-a-number',
        wordsToday: -5,
        history: { 'bad-key': 10, '2026-01-01': 'x', '2026-01-02': 30 },
        streakDays: 99,
      }),
    );
    vi.resetModules();
    const filtered = await import('./writingStats');
    const s = filtered.useWritingStatsStore.getState();
    expect(s.dailyGoal).toBe(DEFAULT_DAILY_GOAL);
    expect(s.wordsToday).toBe(0);
    expect(s.history).toEqual({ '2026-01-02': 30 }); // 非法键/非法值被过滤
    expect(s.streakDays).toBe(0); // 不信任持久化的 streakDays，由历史重算
  });
});
