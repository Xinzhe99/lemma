// @vitest-environment jsdom
/**
 * storage/kvStore 迁移层测试：搬运分界 / 搬运 / 跳过 / 坏 JSON / 幂等不回退、
 * getBigData 旧键兜底、setBigData 往返（读己之写、串行落盘、失败不抛）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BIG_DATA_THRESHOLD_BYTES,
  __resetKvStoreForTests,
  getBigData,
  migrateLocalStorageToIdb,
  setBigData,
} from './kvStore';
import { __resetStorageForTests, kvGet, kvSet } from './db';

// 包装真实实现并 spy：既有行为保留（内存降级后端），失败路径可注入
vi.mock('./db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./db')>();
  return {
    ...actual,
    kvSet: vi.fn(actual.kvSet),
    kvGet: vi.fn(actual.kvGet),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  __resetStorageForTests();
  __resetKvStoreForTests();
});

/** 构造总字节数精确等于 totalBytes 的合法 JSON 字符串（["aaa…"]）。 */
function bigJson(totalBytes: number): string {
  return '["' + 'a'.repeat(totalBytes - 4) + '"]';
}

describe('migrateLocalStorageToIdb 分界与搬运', () => {
  it('≥ 32KB 的 sf-* 键搬入 IndexedDB 并删 localStorage 原键', async () => {
    localStorage.setItem('sf-notes', bigJson(BIG_DATA_THRESHOLD_BYTES));
    localStorage.setItem('sf-library', bigJson(BIG_DATA_THRESHOLD_BYTES + 100));

    const r = await migrateLocalStorageToIdb();

    // v7.0.0：sf-notes 属 localStorage-only store（保护名单内），不搬运
    expect(r.migrated.sort()).toEqual(['sf-library']);
    expect(r.skipped).toEqual(['sf-notes']); // v7.0.0：保护键入 skipped
    expect(localStorage.getItem('sf-notes')).not.toBeNull(); // 保护键保留
    expect(localStorage.getItem('sf-library')).toBeNull();
    // 搬运的是解析后的 JSON 值，不是字符串
    expect(await kvGet('sf-library')).toBeTypeOf('object'); // 大 JSON 解析后原值
  });

  it('< 32KB 的键留在 localStorage（skipped）', async () => {
    localStorage.setItem('sf-comments', JSON.stringify([{ id: 'c1' }]));
    localStorage.setItem('sf-small', bigJson(BIG_DATA_THRESHOLD_BYTES - 1));

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped.sort()).toEqual(['sf-comments', 'sf-small']);
    expect(localStorage.getItem('sf-comments')).toBe(JSON.stringify([{ id: 'c1' }]));
    expect(localStorage.getItem('sf-small')).not.toBeNull();
    expect(await kvGet('sf-small')).toBeUndefined();
  });

  it('恰好 32KB 为搬运边界（≥ 搬运）', async () => {
    localStorage.setItem('sf-edge', bigJson(BIG_DATA_THRESHOLD_BYTES));
    const r = await migrateLocalStorageToIdb();
    expect(r.migrated).toEqual(['sf-edge']);
  });

  it('坏 JSON 大键跳过：原键保留、不进 IndexedDB', async () => {
    localStorage.setItem('sf-broken', '{not json ' + 'x'.repeat(BIG_DATA_THRESHOLD_BYTES));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped).toEqual(['sf-broken']);
    expect(localStorage.getItem('sf-broken')).not.toBeNull();
    expect(await kvGet('sf-broken')).toBeUndefined();
    warn.mockRestore();
  });

  it('非 sf- 前缀键完全不扫描（不在结果中、原样保留）', async () => {
    localStorage.setItem('other-key', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    localStorage.setItem('theme', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    const r = await migrateLocalStorageToIdb();
    expect(r.migrated).toEqual([]);
    expect(r.skipped).toEqual([]);
    expect(localStorage.getItem('other-key')).not.toBeNull();
    expect(localStorage.getItem('theme')).not.toBeNull();
  });

  it('惰性读取方属主的键跳过（sf-file.* / sf-secret.* / sf-settings / sf-submit / sf-writing-stats）', async () => {
    localStorage.setItem('sf-file.main.tex', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    localStorage.setItem('sf-secret.apiKey', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    localStorage.setItem('sf-settings', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    localStorage.setItem('sf-submit', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));
    localStorage.setItem('sf-writing-stats', bigJson(BIG_DATA_THRESHOLD_BYTES + 10));

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped.sort()).toEqual([
      'sf-file.main.tex',
      'sf-secret.apiKey',
      'sf-settings',
      'sf-submit',
      'sf-writing-stats',
    ]);
    expect(localStorage.length).toBe(5);
  });

  it('v7.8.0：其余「模块加载时同步读 localStorage」的属主键同样跳过（不得搬走后读空）', async () => {
    const guarded = ['sf-workflow-overrides', 'sf-agent-runs', 'sf-custom-dict'];
    for (const key of guarded) localStorage.setItem(key, bigJson(BIG_DATA_THRESHOLD_BYTES + 10));

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped.sort()).toEqual([...guarded].sort());
    for (const key of guarded) {
      expect(localStorage.getItem(key)).not.toBeNull(); // 属主仍能同步读回
      expect(await kvGet(key)).toBeUndefined(); // 未被搬入 IndexedDB
    }
  });

  it('幂等不回退：IndexedDB 已有新值时仅清 localStorage 旧副本，不覆盖', async () => {
    await kvSet('sf-library', [{ id: 'new' }]);
    localStorage.setItem(
      'sf-library',
      JSON.stringify([{ id: 'old', pad: 'a'.repeat(BIG_DATA_THRESHOLD_BYTES) }]),
    );

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual(['sf-library']);
    expect(localStorage.getItem('sf-library')).toBeNull();
    expect(await kvGet('sf-library')).toEqual([{ id: 'new' }]);
  });

  it('已被 setBigData 接管的键跳过搬运（写方持有最新值主权）', async () => {
    localStorage.setItem('sf-library', bigJson(BIG_DATA_THRESHOLD_BYTES));
    const p = setBigData('sf-library', { papers: [], seeded: true });
    const r = await migrateLocalStorageToIdb();
    await p;

    expect(r.migrated).toEqual([]);
    expect(r.skipped).toEqual(['sf-library']);
    expect(await kvGet('sf-library')).toEqual({ papers: [], seeded: true });
  });

  it('搬运失败（kvSet 抛错）保留 localStorage 原键并计入 skipped', async () => {
    // 注意用非保护键：sf-notes 等在 LAZY_READER_KEYS 名单内时迁移不触达 kvSet，
    // mockRejectedValueOnce 会滞留队列泄漏进后续用例（v7.6.0 修复的测试隐患）
    localStorage.setItem('sf-misc-big', bigJson(BIG_DATA_THRESHOLD_BYTES));
    vi.mocked(kvSet).mockRejectedValueOnce(new Error('idb 不可用'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped).toEqual(['sf-misc-big']);
    expect(localStorage.getItem('sf-misc-big')).not.toBeNull();
    warn.mockRestore();
  });

  it('无 localStorage 环境（SSR）安全返回空结果', async () => {
    const orig = globalThis.localStorage;
    vi.stubGlobal('localStorage', undefined);
    const r = await migrateLocalStorageToIdb();
    expect(r).toEqual({ migrated: [], skipped: [] });
    vi.unstubAllGlobals();
    expect(orig).toBeDefined();
  });
});

describe('getBigData / setBigData', () => {
  it('setBigData 往返：IndexedDB 可写时不写 localStorage（不占配额）', async () => {
    vi.mocked(kvSet).mockResolvedValueOnce(undefined);
    await setBigData('sf-library', { papers: [{ id: 'p1' }], seeded: true });
    expect(await getBigData('sf-library')).toEqual({ papers: [{ id: 'p1' }], seeded: true });
    expect(localStorage.getItem('sf-library')).toBeNull();
  });

  it('setBigData：IndexedDB 写失败时降级写 localStorage（不静默丢数据，v7.6.0）', async () => {
    vi.mocked(kvSet).mockRejectedValueOnce(new Error('idb 不可用'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await setBigData('sf-library', { papers: [{ id: 'p1' }], seeded: true });
    expect(await getBigData('sf-library')).toEqual({ papers: [{ id: 'p1' }], seeded: true });
    expect(localStorage.getItem('sf-library')).not.toBeNull(); // 降级副本可供重启恢复
    warn.mockRestore();
  });

  it('getBigData 兜底读旧 localStorage 键（启动迁移前的首次运行）', async () => {
    localStorage.setItem('sf-library', JSON.stringify({ papers: [{ id: 'legacy' }] }));
    expect(await getBigData('sf-library')).toEqual({ papers: [{ id: 'legacy' }] });
    // 兜底读不搬键：localStorage 原键仍在，交给启动迁移处理
    expect(localStorage.getItem('sf-library')).not.toBeNull();
  });

  it('读己之写：setBigData 后立即 getBigData 即得新值（无需等落盘）', async () => {
    await kvSet('sf-x', 'from-idb');
    expect(await getBigData('sf-x')).toBe('from-idb');
    const p = setBigData('sf-x', 'new-value');
    expect(await getBigData('sf-x')).toBe('new-value');
    await p;
  });

  it('同键并发写按键串行落盘，最终值为最后一次写', async () => {
    const p1 = setBigData('sf-x', 'a'.repeat(BIG_DATA_THRESHOLD_BYTES));
    const p2 = setBigData('sf-x', 'b'.repeat(BIG_DATA_THRESHOLD_BYTES));
    await Promise.all([p1, p2]);
    expect(await kvGet('sf-x')).toBe('b'.repeat(BIG_DATA_THRESHOLD_BYTES));
  });

  it('setBigData 持久化失败不抛错（quota 同语义），读己之写仍返回写入值', async () => {
    vi.mocked(kvSet).mockRejectedValueOnce(new Error('QuotaExceeded'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(setBigData('sf-library', { papers: [] })).resolves.toBeUndefined();
    expect(await getBigData('sf-library')).toEqual({ papers: [] });

    warn.mockRestore();
  });

  it('getBigData：IndexedDB 读取失败回退 localStorage', async () => {
    localStorage.setItem('sf-library', JSON.stringify({ fallback: true }));
    vi.mocked(kvGet).mockRejectedValueOnce(new Error('idb 打开失败'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(await getBigData('sf-library')).toEqual({ fallback: true });

    warn.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// v7.8.0：IndexedDB 写失败后的 localStorage 降级副本必须能读回
// ---------------------------------------------------------------------------
describe('降级副本（IndexedDB 写失败 → localStorage）的权威标记', () => {
  it('IndexedDB 里是旧值时，降级副本仍能读回（此前被旧值盖掉）', async () => {
    await kvSet('sf-library', { papers: [{ id: 'old' }] }); // 库里是旧值
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(kvSet).mockRejectedValueOnce(new Error('idb 写失败'));
    await setBigData('sf-library', { papers: [{ id: 'new' }] }); // 降级写 localStorage
    warn.mockRestore();

    __resetKvStoreForTests(); // 模拟重启：清掉读己之写缓存

    expect(await getBigData('sf-library')).toEqual({ papers: [{ id: 'new' }] });
    expect(await kvGet('sf-library')).toEqual({ papers: [{ id: 'old' }] }); // IndexedDB 未被误改
  });

  it('迁移不删降级副本（标记存在 → 跳过，原键与内容保留）', async () => {
    await kvSet('sf-library', [{ id: 'old' }]);
    localStorage.setItem(
      'sf-library',
      JSON.stringify([{ id: 'new', pad: 'a'.repeat(BIG_DATA_THRESHOLD_BYTES) }]),
    );
    localStorage.setItem('idbfb:sf-library', '1'); // 等价于 setBigData 降级写后的标记

    const r = await migrateLocalStorageToIdb();

    expect(r.migrated).toEqual([]);
    expect(r.skipped).toContain('sf-library');
    expect(localStorage.getItem('sf-library')).not.toBeNull(); // 新数据未被删除
    expect(await kvGet('sf-library')).toEqual([{ id: 'old' }]); // 也未被旧值覆盖
    expect(await getBigData<{ id: string }[]>('sf-library')).toEqual([{ id: 'new', pad: 'a'.repeat(BIG_DATA_THRESHOLD_BYTES) }]);
  });

  it('IndexedDB 写成功即清标记：此后的 localStorage 遗留副本按旧副本清理', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(kvSet).mockRejectedValueOnce(new Error('idb 写失败'));
    await setBigData('sf-library', {
      papers: [{ id: 'fallback', pad: 'a'.repeat(BIG_DATA_THRESHOLD_BYTES) }],
    });
    warn.mockRestore();
    expect(localStorage.getItem('idbfb:sf-library')).not.toBeNull();

    await setBigData('sf-library', { papers: [{ id: 'ok' }] }); // IndexedDB 恢复
    expect(localStorage.getItem('idbfb:sf-library')).toBeNull();
    __resetKvStoreForTests(); // 模拟重启（清读己之写缓存，迁移才有机会处理该键）

    const r = await migrateLocalStorageToIdb();
    expect(r.migrated).toContain('sf-library'); // 旧副本清理（IndexedDB 已是新值）
    expect(localStorage.getItem('sf-library')).toBeNull();
    expect(await kvGet('sf-library')).toEqual({ papers: [{ id: 'ok' }] });
  });
});
