/**
 * WF-1 投稿工作台状态：目标 venue 选择、投稿 deadline 与最近一次导出时间。
 * 持久化到 localStorage（key: sf-submit），模式与 settingsStore / libraryStore 一致。
 */

import { create } from 'zustand';

export const SUBMIT_STORAGE_KEY = 'sf-submit';

export interface SubmitState {
  /** 目标期刊/会议档案 id（submission/venues.ts；null = 未选择） */
  venueId: string | null;
  /** 最近一次打包导出的时间戳（ms；null = 尚未导出过） */
  lastExportAt: number | null;
  /** 投稿 deadline（ISO 日期字符串 YYYY-MM-DD，来自 <input type="date">；null = 未设置） */
  deadline: string | null;
  setVenueId(id: string | null): void;
  markExported(): void;
  setDeadline(deadline: string | null): void;
}

interface PersistedSubmit {
  venueId: string | null;
  lastExportAt: number | null;
  deadline: string | null;
}

const EMPTY: PersistedSubmit = { venueId: null, lastExportAt: null, deadline: null };

function readPersisted(): PersistedSubmit {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SUBMIT_STORAGE_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<PersistedSubmit>;
    if (!v || typeof v !== 'object') return EMPTY;
    return {
      venueId: typeof v.venueId === 'string' && v.venueId ? v.venueId : null,
      lastExportAt: typeof v.lastExportAt === 'number' && Number.isFinite(v.lastExportAt) ? v.lastExportAt : null,
      deadline: typeof v.deadline === 'string' && v.deadline ? v.deadline : null,
    };
  } catch {
    return EMPTY;
  }
}

const initial = readPersisted();

export const useSubmitStore = create<SubmitState>((set) => ({
  venueId: initial.venueId,
  lastExportAt: initial.lastExportAt,
  deadline: initial.deadline,

  setVenueId: (id) => set({ venueId: id }),
  markExported: () => set({ lastExportAt: Date.now() }),
  setDeadline: (deadline) => set({ deadline }),
}));

useSubmitStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedSubmit = { venueId: s.venueId, lastExportAt: s.lastExportAt, deadline: s.deadline };
      localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});

/** 读取当前持久化内容（测试与调试用）。 */
export function readPersistedSubmit(): PersistedSubmit {
  return readPersisted();
}

/** 解析 deadline：type="date" 的 YYYY-MM-DD 按本地时区当日零点（避免 UTC 偏移吞掉一天），其余走 Date 兜底。 */
function parseDeadlineDate(deadline: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(deadline.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(deadline);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 投稿 deadline 倒计时（纯函数，SubmitPanel 的倒计时 chip 与测试直接使用）。
 * - deadline：ISO 日期字符串；无法解析时返回 null（UI 不渲染 chip）；
 * - days：按自然日差计算，deadline 当天为 0，已过为负数；
 * - label：已过期为「已过期 N 天」；不足 3 天的临近期限带「⚠」前缀（对应 chip 的 err 色）。
 */
export function deadlineCountdown(
  deadline: string,
  now: Date = new Date(),
): { days: number; label: string } | null {
  const target = parseDeadlineDate(deadline);
  if (!target) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(target) - startOfDay(now)) / 86_400_000);
  if (days < 0) return { days, label: `已过期 ${-days} 天` };
  if (days === 0) return { days, label: '⚠ 今天截止' };
  if (days < 3) return { days, label: `⚠ 剩 ${days} 天` };
  return { days, label: `剩 ${days} 天` };
}
