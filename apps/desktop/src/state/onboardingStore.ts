/**
 * 新手引导状态（完整新手引导系统）：
 *  - WelcomeTour（首启全屏导览）：tourDone / tourDismissedAt（Esc/遮罩「稍后」后 24h 内不再弹，
 *    过期后下次启动再弹，直到完成或点「开始使用」/「跳过引导」——两者都置 tourDone 永久收口）；
 *  - GettingStarted（Dashboard 新手任务清单）：checklistDismissed + completedSteps。
 *    completedSteps 是「瞬时信号的闩锁」：dirty / compileLog / 会话数等探测源重启后会复位，
 *    一旦检测为真就落盘记名，避免清单在重启后倒退。
 * 持久化到 localStorage（key: sf-onboarding），shape 校验失败回退默认值。
 * 旧版 OnboardingCard 的 sf-onboarding-dismissed=1 迁移为 tourDone（老用户不再被全屏导览打扰）。
 */

import { create } from 'zustand';

export const ONBOARDING_STORAGE_KEY = 'sf-onboarding';
/** 旧版 OnboardingCard 的「不再显示」key（只读迁移，不再写入） */
export const LEGACY_ONBOARDING_DISMISS_KEY = 'sf-onboarding-dismissed';
/** 「稍后」抑制窗口：dismissed 后 24h 内不再弹导览 */
export const TOUR_DISMISS_SUPPRESS_MS = 24 * 60 * 60 * 1000;

/** 新手任务清单的 5 个步骤 id（固定顺序） */
export const CHECKLIST_STEP_IDS = ['project', 'write', 'compile', 'chat', 'provider'] as const;
export type ChecklistStepId = (typeof CHECKLIST_STEP_IDS)[number];

interface PersistedOnboarding {
  tourDone: boolean;
  tourDismissedAt: number | null;
  checklistDismissed: boolean;
  completedSteps: string[];
}

export interface OnboardingState extends PersistedOnboarding {
  /** 完成导览（最后一页点「开始使用」）：此后不再弹 */
  completeTour(): void;
  /** 永久跳过导览（「跳过引导」链接）：此后不再弹 */
  skipTour(): void;
  /** 「稍后」（Esc/遮罩/先看看）：记录时间戳，24h 内不再弹，过期后下次启动再弹 */
  dismissTour(): void;
  /** 新手清单「不再显示」（持久） */
  dismissChecklist(): void;
  /** 记录某步骤已达成（幂等；瞬时信号闩锁，重启后不倒退） */
  markStep(id: string): void;
  /** 回到初始状态（测试用） */
  resetAll(): void;
}

/** 宽容校验持久化数据：字段类型不符时按默认值回落（不整体丢弃合法字段） */
function parsePersisted(raw: string | null): PersistedOnboarding | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<PersistedOnboarding>;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    return {
      tourDone: v.tourDone === true,
      tourDismissedAt:
        typeof v.tourDismissedAt === 'number' && Number.isFinite(v.tourDismissedAt) ? v.tourDismissedAt : null,
      checklistDismissed: v.checklistDismissed === true,
      completedSteps: Array.isArray(v.completedSteps)
        ? v.completedSteps.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return null; // 坏 JSON：整体回退默认值
  }
}

/** 读取初始状态：sf-onboarding 优先，坏数据回退；旧版 dismissed=1 迁移为 tourDone */
function readInitial(): PersistedOnboarding {
  const defaults: PersistedOnboarding = {
    tourDone: false,
    tourDismissedAt: null,
    checklistDismissed: false,
    completedSteps: [],
  };
  try {
    if (typeof localStorage === 'undefined') return defaults;
    const state = parsePersisted(localStorage.getItem(ONBOARDING_STORAGE_KEY));
    // 旧版 OnboardingCard 的「不再显示」：老用户不再被全屏导览打扰。
    // 新状态已 tourDone=true 时以新状态为准；否则合并提升为已完成。
    const legacyDismissed = localStorage.getItem(LEGACY_ONBOARDING_DISMISS_KEY) === '1';
    if (state) return legacyDismissed && !state.tourDone ? { ...state, tourDone: true } : state;
    return legacyDismissed ? { ...defaults, tourDone: true } : defaults;
  } catch {
    return defaults;
  }
}

const initial = readInitial();

function persisted(s: OnboardingState): PersistedOnboarding {
  return {
    tourDone: s.tourDone,
    tourDismissedAt: s.tourDismissedAt,
    checklistDismissed: s.checklistDismissed,
    completedSteps: s.completedSteps,
  };
}

export const useOnboardingStore = create<OnboardingState>()((set) => ({
  ...initial,

  completeTour() {
    set({ tourDone: true, tourDismissedAt: null });
  },

  skipTour() {
    set({ tourDone: true, tourDismissedAt: null });
  },

  dismissTour() {
    set((s) => (s.tourDone ? s : { tourDismissedAt: Date.now() }));
  },

  dismissChecklist() {
    set({ checklistDismissed: true });
  },

  markStep(id) {
    const trimmed = id.trim();
    if (!trimmed) return;
    set((s) => (s.completedSteps.includes(trimmed) ? s : { completedSteps: [...s.completedSteps, trimmed] }));
  },

  resetAll() {
    set({
      tourDone: false,
      tourDismissedAt: null,
      checklistDismissed: false,
      completedSteps: [],
    });
  },
}));

useOnboardingStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(persisted(s)));
    }
  } catch {
    /* 隐私模式等写入失败不打断 UI（仅本次会话有效） */
  }
});

/** 读取当前持久化内容（测试与调试用）。 */
export function readPersistedOnboarding(): PersistedOnboarding | null {
  try {
    return typeof localStorage === 'undefined'
      ? null
      : parsePersisted(localStorage.getItem(ONBOARDING_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * 是否应展示欢迎导览（纯函数，App 首屏调用）：
 * 未完成 && 未在 24h 抑制窗口内（从未「稍后」过或已过期则弹）。
 */
export function shouldShowTour(
  state: Pick<OnboardingState, 'tourDone' | 'tourDismissedAt'> = useOnboardingStore.getState(),
  now: number = Date.now(),
): boolean {
  if (state.tourDone) return false;
  if (state.tourDismissedAt === null) return true;
  return now - state.tourDismissedAt >= TOUR_DISMISS_SUPPRESS_MS;
}
