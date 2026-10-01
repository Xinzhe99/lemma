// @vitest-environment jsdom
/**
 * onboardingStore 单元测试：
 *  - 初始默认状态（未完成导览、未 dismissal、清单未Dismiss、无已完成步骤）；
 *  - completeTour / skipTour 永久收口（tourDone=true，shouldShowTour=false）并持久化；
 *  - dismissTour 记录时间戳（24h 内 shouldShowTour=false，过期后 true）；
 *  - dismissChecklist / markStep（幂等、空白 id 忽略）/ resetAll；
 *  - 模块重载恢复（sf-onboarding 通道）；
 *  - 坏数据回退（坏 JSON / 字段类型不符 / 非对象）；
 *  - 旧版 OnboardingCard 的 sf-onboarding-dismissed=1 迁移为 tourDone。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHECKLIST_STEP_IDS,
  LEGACY_ONBOARDING_DISMISS_KEY,
  ONBOARDING_STORAGE_KEY,
  TOUR_DISMISS_SUPPRESS_MS,
  readPersistedOnboarding,
  shouldShowTour,
  useOnboardingStore,
} from './onboardingStore';

const HOUR = 3_600_000;

beforeEach(() => {
  localStorage.clear();
  useOnboardingStore.getState().resetAll();
});

describe('onboardingStore · 初始状态与判定', () => {
  it('默认状态：导览未完成、未 dismissal、清单未隐藏、无已完成步骤；shouldShowTour 为真', () => {
    const s = useOnboardingStore.getState();
    expect(s.tourDone).toBe(false);
    expect(s.tourDismissedAt).toBeNull();
    expect(s.checklistDismissed).toBe(false);
    expect(s.completedSteps).toEqual([]);
    expect(shouldShowTour()).toBe(true);
  });

  it('completeTour 与 skipTour 均永久收口：tourDone=true 且清掉 dismissal 时间戳，并持久化', () => {
    useOnboardingStore.getState().dismissTour();
    useOnboardingStore.getState().completeTour();
    expect(useOnboardingStore.getState().tourDone).toBe(true);
    expect(useOnboardingStore.getState().tourDismissedAt).toBeNull();
    expect(shouldShowTour()).toBe(false);
    expect(readPersistedOnboarding()?.tourDone).toBe(true);

    useOnboardingStore.getState().resetAll();
    useOnboardingStore.getState().skipTour();
    expect(useOnboardingStore.getState().tourDone).toBe(true);
    expect(shouldShowTour()).toBe(false);
    expect(readPersistedOnboarding()?.tourDone).toBe(true);
  });

  it('dismissTour：24h 内不再弹，满 24h 后恢复可弹（纯函数按注入 now 判定）', () => {
    const before = Date.now();
    useOnboardingStore.getState().dismissTour();
    const at = useOnboardingStore.getState().tourDismissedAt!;
    expect(at).toBeGreaterThanOrEqual(before);

    const state = useOnboardingStore.getState();
    expect(shouldShowTour(state, at + TOUR_DISMISS_SUPPRESS_MS - 1)).toBe(false); // 窗口内
    expect(shouldShowTour(state, at + TOUR_DISMISS_SUPPRESS_MS)).toBe(true); // 刚过期
    expect(readPersistedOnboarding()?.tourDismissedAt).toBe(at); // 时间戳已持久化
  });

  it('tourDone 优先生效：即使 24h 窗口已过期也不再弹', () => {
    const dismissedLongAgo = { tourDone: true, tourDismissedAt: Date.now() - 10 * TOUR_DISMISS_SUPPRESS_MS };
    expect(shouldShowTour(dismissedLongAgo, Date.now())).toBe(false);
  });
});

describe('onboardingStore · 清单动作', () => {
  it('dismissChecklist 持久隐藏清单', () => {
    useOnboardingStore.getState().dismissChecklist();
    expect(useOnboardingStore.getState().checklistDismissed).toBe(true);
    expect(readPersistedOnboarding()?.checklistDismissed).toBe(true);
  });

  it('markStep 追加步骤且幂等；空白 id 忽略', () => {
    useOnboardingStore.getState().markStep('write');
    useOnboardingStore.getState().markStep('compile');
    useOnboardingStore.getState().markStep('write'); // 重复
    useOnboardingStore.getState().markStep('   '); // 空白
    expect(useOnboardingStore.getState().completedSteps).toEqual(['write', 'compile']);
    expect(readPersistedOnboarding()?.completedSteps).toEqual(['write', 'compile']);
  });

  it('resetAll 恢复初始状态并同步持久化', () => {
    useOnboardingStore.getState().markStep('project');
    useOnboardingStore.getState().dismissChecklist();
    useOnboardingStore.getState().completeTour();
    useOnboardingStore.getState().resetAll();
    const s = useOnboardingStore.getState();
    expect(s.tourDone).toBe(false);
    expect(s.tourDismissedAt).toBeNull();
    expect(s.checklistDismissed).toBe(false);
    expect(s.completedSteps).toEqual([]);
    expect(shouldShowTour()).toBe(true);
    expect(readPersistedOnboarding()).toEqual({
      tourDone: false,
      tourDismissedAt: null,
      checklistDismissed: false,
      completedSteps: [],
    });
  });

  it('步骤 id 常量固定为 5 步且有序（与 GettingStarted 渲染顺序一致）', () => {
    expect([...CHECKLIST_STEP_IDS]).toEqual(['project', 'write', 'compile', 'chat', 'provider']);
  });
});

describe('onboardingStore · 持久化恢复与坏数据回退', () => {
  it('模块重载时从 sf-onboarding 恢复（含 dismissal 与清单进度）', async () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        tourDone: false,
        tourDismissedAt: 123,
        checklistDismissed: true,
        completedSteps: ['project', 'chat'],
      }),
    );
    vi.resetModules();
    const mod = await import('./onboardingStore');
    const s = mod.useOnboardingStore.getState();
    expect(s.tourDone).toBe(false);
    expect(s.tourDismissedAt).toBe(123);
    expect(s.checklistDismissed).toBe(true);
    expect(s.completedSteps).toEqual(['project', 'chat']);
  });

  it('坏 JSON 与非对象整体回退默认值', async () => {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '{{{not json');
    vi.resetModules();
    const mod1 = await import('./onboardingStore');
    expect(mod1.useOnboardingStore.getState().tourDone).toBe(false);

    localStorage.setItem(ONBOARDING_STORAGE_KEY, '[1,2,3]');
    vi.resetModules();
    const mod2 = await import('./onboardingStore');
    expect(mod2.useOnboardingStore.getState().tourDismissedAt).toBeNull();
  });

  it('字段类型不符按字段回落：tourDone 字符串/false 混写、completedSteps 混入非字符串被剔除', async () => {
    localStorage.setItem(
      ONBOARDING_STORAGE_KEY,
      JSON.stringify({
        tourDone: 'yes', // 非法 → false
        tourDismissedAt: 'yesterday', // 非法 → null
        checklistDismissed: true,
        completedSteps: ['write', 42, null, 'compile'], // 仅保留字符串
      }),
    );
    vi.resetModules();
    const mod = await import('./onboardingStore');
    const s = mod.useOnboardingStore.getState();
    expect(s.tourDone).toBe(false);
    expect(s.tourDismissedAt).toBeNull();
    expect(s.checklistDismissed).toBe(true);
    expect(s.completedSteps).toEqual(['write', 'compile']);
  });

  it('旧版 OnboardingCard 的 dismissed=1 迁移为 tourDone（老用户不再被全屏导览打扰）', async () => {
    localStorage.setItem(LEGACY_ONBOARDING_DISMISS_KEY, '1');
    vi.resetModules();
    const mod = await import('./onboardingStore');
    expect(mod.useOnboardingStore.getState().tourDone).toBe(true);
    expect(mod.shouldShowTour()).toBe(false);
  });

  it('dismissTour 在已完成后是 no-op（不覆盖 tourDone 的收口语义）', () => {
    useOnboardingStore.getState().completeTour();
    useOnboardingStore.getState().dismissTour();
    const s = useOnboardingStore.getState();
    expect(s.tourDone).toBe(true);
    expect(s.tourDismissedAt).toBeNull();
  });

  it('近 24h 边界：dismiss 至今不足一小时 → 不弹', () => {
    useOnboardingStore.getState().dismissTour();
    const at = useOnboardingStore.getState().tourDismissedAt!;
    expect(shouldShowTour(useOnboardingStore.getState(), at + HOUR)).toBe(false);
  });
});
