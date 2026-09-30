// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUBMIT_STORAGE_KEY,
  deadlineCountdown,
  readPersistedSubmit,
  useSubmitStore,
} from './submitStore';

beforeEach(() => {
  localStorage.clear();
});

describe('submitStore localStorage 持久化', () => {
  it('未持久化时 deadline 为 null', async () => {
    localStorage.clear();
    vi.resetModules();
    const mod = await import('./submitStore');
    expect(mod.useSubmitStore.getState().deadline).toBeNull();
    expect(mod.readPersistedSubmit().deadline).toBeNull();
  });

  it('setDeadline 写入并持久化；置空清除', () => {
    useSubmitStore.getState().setDeadline('2026-12-31');
    expect(useSubmitStore.getState().deadline).toBe('2026-12-31');
    expect(readPersistedSubmit().deadline).toBe('2026-12-31');

    useSubmitStore.getState().setDeadline(null);
    expect(useSubmitStore.getState().deadline).toBeNull();
    expect(readPersistedSubmit().deadline).toBeNull();
  });

  it('重新加载时从 sf-submit 通道恢复 deadline（旧格式缺字段回落 null）', async () => {
    localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify({ venueId: 'acl', lastExportAt: 1, deadline: '2026-10-01' }));
    vi.resetModules();
    const mod = await import('./submitStore');
    expect(mod.useSubmitStore.getState().deadline).toBe('2026-10-01');
    expect(mod.useSubmitStore.getState().venueId).toBe('acl');

    localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify({ venueId: null, lastExportAt: null }));
    vi.resetModules();
    const mod2 = await import('./submitStore');
    expect(mod2.useSubmitStore.getState().deadline).toBeNull();
  });

  it('venue 导出时间等既有字段与 deadline 共存于同一快照', () => {
    useSubmitStore.getState().setVenueId('neurips');
    useSubmitStore.getState().setDeadline('2026-05-20');
    useSubmitStore.getState().markExported();
    const persisted = readPersistedSubmit();
    expect(persisted.venueId).toBe('neurips');
    expect(persisted.deadline).toBe('2026-05-20');
    expect(typeof persisted.lastExportAt).toBe('number');
  });
});

describe('deadlineCountdown 纯函数', () => {
  const now = new Date(2026, 8, 30, 15, 30); // 2026-09-30 15:30（自然日按 09-30 计）

  it('无效字符串返回 null', () => {
    expect(deadlineCountdown('not-a-date', now)).toBeNull();
    expect(deadlineCountdown('', now)).toBeNull();
  });

  it('当天截止：days 0，label 含 ⚠', () => {
    const r = deadlineCountdown('2026-09-30', now);
    expect(r).not.toBeNull();
    expect(r!.days).toBe(0);
    expect(r!.label).toContain('⚠');
  });

  it('1–2 天（<3 天）：days 正数，label 含 ⚠', () => {
    const one = deadlineCountdown('2026-10-01', now);
    expect(one!.days).toBe(1);
    expect(one!.label).toContain('⚠');
    const two = deadlineCountdown('2026-10-02', now);
    expect(two!.days).toBe(2);
    expect(two!.label).toContain('⚠');
  });

  it('3–14 天：正常倒计时，无 ⚠（区间边界 3 与 14）', () => {
    const three = deadlineCountdown('2026-10-03', now);
    expect(three!.days).toBe(3);
    expect(three!.label).not.toContain('⚠');
    const fourteen = deadlineCountdown('2026-10-14', now);
    expect(fourteen!.days).toBe(14);
    expect(fourteen!.label).not.toContain('⚠');
    expect(fourteen!.label).toContain('14');
  });

  it('超过 14 天：剩余天数正确', () => {
    const r = deadlineCountdown('2026-10-31', now);
    expect(r!.days).toBe(31);
    expect(r!.label).not.toContain('⚠');
  });

  it('已过期：days 为负数，label 为「已过期 N 天」', () => {
    const r = deadlineCountdown('2026-09-25', now);
    expect(r!.days).toBe(-5);
    expect(r!.label).toBe('已过期 5 天');
    expect(r!.label).not.toContain('⚠');
  });

  it('跨月/跨年按自然日计算', () => {
    expect(deadlineCountdown('2026-10-01', new Date(2026, 8, 30))!.days).toBe(1);
    expect(deadlineCountdown('2027-01-01', new Date(2026, 11, 31))!.days).toBe(1);
  });

  it('缺省 now 使用当前系统时间（不抛错）', () => {
    const future = new Date();
    future.setDate(future.getDate() + 20);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const r = deadlineCountdown(iso);
    expect(r!.days).toBeGreaterThanOrEqual(19);
  });
});
