/**
 * WF-1 投稿工作台状态：目标 venue 选择与最近一次导出时间。
 * 持久化到 localStorage（key: sf-submit），模式与 settingsStore / libraryStore 一致。
 */

import { create } from 'zustand';

export const SUBMIT_STORAGE_KEY = 'sf-submit';

export interface SubmitState {
  /** 目标期刊/会议档案 id（submission/venues.ts；null = 未选择） */
  venueId: string | null;
  /** 最近一次打包导出的时间戳（ms；null = 尚未导出过） */
  lastExportAt: number | null;
  setVenueId(id: string | null): void;
  markExported(): void;
}

interface PersistedSubmit {
  venueId: string | null;
  lastExportAt: number | null;
}

const EMPTY: PersistedSubmit = { venueId: null, lastExportAt: null };

function readPersisted(): PersistedSubmit {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SUBMIT_STORAGE_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw) as Partial<PersistedSubmit>;
    if (!v || typeof v !== 'object') return EMPTY;
    return {
      venueId: typeof v.venueId === 'string' && v.venueId ? v.venueId : null,
      lastExportAt: typeof v.lastExportAt === 'number' && Number.isFinite(v.lastExportAt) ? v.lastExportAt : null,
    };
  } catch {
    return EMPTY;
  }
}

const initial = readPersisted();

export const useSubmitStore = create<SubmitState>((set) => ({
  venueId: initial.venueId,
  lastExportAt: initial.lastExportAt,

  setVenueId: (id) => set({ venueId: id }),
  markExported: () => set({ lastExportAt: Date.now() }),
}));

useSubmitStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedSubmit = { venueId: s.venueId, lastExportAt: s.lastExportAt };
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
