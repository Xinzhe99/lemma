/**
 * storage/db 接口契约测试：
 *  - 内存降级路径（jsdom/node 无 indexedDB → MemoryBackend）；
 *  - Dexie 路径（vi.mock('dexie') 假实现 + stub 全局 indexedDB → 验证真实委托与单例/schema）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetStorageForTests,
  attachmentBulkDelete,
  attachmentDelete,
  attachmentGet,
  attachmentGetAll,
  attachmentPut,
  getAppDb,
  kvGet,
  kvSet,
  type AttachmentRecord,
  type KvRecord,
} from './db';

// ---------------------------------------------------------------------------
// mock dexie：假 Dexie 类按 stores() schema 建表（实例属性按表名挂载，主键取自 schema 值）
// ---------------------------------------------------------------------------
vi.mock('dexie', () => {
  class FakeTable {
    readonly rows = new Map<string, object>();
    readonly calls: string[] = [];
    constructor(private readonly primary: string) {}
    async put(rec: object): Promise<void> {
      this.calls.push('put');
      this.rows.set(String((rec as Record<string, unknown>)[this.primary]), rec);
    }
    async get(key: string): Promise<object | undefined> {
      this.calls.push('get');
      return this.rows.get(key);
    }
    async delete(key: string): Promise<void> {
      this.calls.push('delete');
      this.rows.delete(key);
    }
    async bulkDelete(keys: string[]): Promise<void> {
      this.calls.push('bulkDelete');
      for (const k of keys) this.rows.delete(k);
    }
    async toArray(): Promise<object[]> {
      this.calls.push('toArray');
      return [...this.rows.values()];
    }
  }
  class FakeDexie {
    readonly schemaCalls: Array<{ version: number; stores: Record<string, string> }> = [];
    constructor(public readonly name: string) {}
    version(version: number) {
      const self = this;
      return {
        stores(stores: Record<string, string>) {
          self.schemaCalls.push({ version, stores: { ...stores } });
          for (const [table, primary] of Object.entries(stores)) {
            (self as unknown as Record<string, unknown>)[table] = new FakeTable(primary);
          }
          return self;
        },
      };
    }
  }
  return { default: FakeDexie };
});

/** mock dexie 环境下经 getAppDb() 取回的假库实例运行时形状。 */
interface FakeDbView {
  name: string;
  schemaCalls: Array<{ version: number; stores: Record<string, string> }>;
  kv: { rows: Map<string, KvRecord>; calls: string[] };
  attachments: { rows: Map<string, AttachmentRecord>; calls: string[] };
}

function fakeDb(): FakeDbView {
  return getAppDb() as unknown as FakeDbView;
}

function makeAttachment(paperId: string, bytes: number[]): AttachmentRecord {
  return { paperId, data: new Blob([new Uint8Array(bytes)]), name: `${paperId}.pdf`, savedAt: 1 };
}

// ---------------------------------------------------------------------------
// 内存降级路径（默认环境无 indexedDB）
// ---------------------------------------------------------------------------
describe('storage/db 内存降级路径（无 indexedDB）', () => {
  beforeEach(() => {
    __resetStorageForTests();
  });

  it('kvSet / kvGet 往返；无键返回 undefined', async () => {
    await kvSet('sf-library', { papers: [{ id: 'p1' }], seeded: true });
    expect(await kvGet<{ papers: unknown[] }>('sf-library')).toEqual({
      papers: [{ id: 'p1' }],
      seeded: true,
    });
    expect(await kvGet('sf-missing')).toBeUndefined();
  });

  it('kvSet 同 key 整值覆盖', async () => {
    await kvSet('k', { v: 1 });
    await kvSet('k', { v: 2 });
    expect(await kvGet<{ v: number }>('k')).toEqual({ v: 2 });
  });

  it('attachmentPut / attachmentGet 往返（Blob 字节一致）', async () => {
    const rec = makeAttachment('p1', [1, 2, 3, 4]);
    await attachmentPut(rec);
    const got = await attachmentGet('p1');
    expect(got?.name).toBe('p1.pdf');
    expect(new Uint8Array(await got!.data.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(await attachmentGet('nope')).toBeUndefined();
  });

  it('attachmentPut 同 paperId 覆盖', async () => {
    await attachmentPut(makeAttachment('p1', [1]));
    await attachmentPut(makeAttachment('p1', [9, 9]));
    const all = await attachmentGetAll();
    expect(all).toHaveLength(1);
    expect(new Uint8Array(await all[0]!.data.arrayBuffer())).toEqual(new Uint8Array([9, 9]));
  });

  it('attachmentDelete / attachmentBulkDelete 删除；不存在的 id 为 no-op', async () => {
    await attachmentPut(makeAttachment('p1', [1]));
    await attachmentPut(makeAttachment('p2', [2]));
    await attachmentPut(makeAttachment('p3', [3]));
    await attachmentDelete('p1');
    await attachmentBulkDelete(['p2', 'ghost']);
    expect((await attachmentGetAll()).map((r) => r.paperId)).toEqual(['p3']);
  });

  it('getAppDb 在无 indexedDB 环境抛出明确错误', () => {
    expect(() => getAppDb()).toThrow(/IndexedDB/);
  });
});

// ---------------------------------------------------------------------------
// Dexie 路径（stub 全局 indexedDB + mock dexie 模块）
// ---------------------------------------------------------------------------
describe('storage/db Dexie 路径（mock dexie + stub indexedDB）', () => {
  beforeEach(() => {
    vi.stubGlobal('indexedDB', {});
    __resetStorageForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetStorageForTests();
  });

  it('getAppDb 单例：库名 lemma、版本 schema kv[key] / attachments[paperId]', () => {
    const a = getAppDb();
    expect(getAppDb()).toBe(a); // 单例
    const db = fakeDb();
    expect(db.name).toBe('lemma');
    expect(db.schemaCalls).toEqual([
      { version: 1, stores: { kv: 'key', attachments: 'paperId' } },
    ]);
  });

  it('kvSet 走 kv 表 put（{key, value} 记录）；kvGet 走 get', async () => {
    await kvSet('sf-notes', [{ id: 'n1' }]);
    const db = fakeDb();
    expect(db.kv.calls).toContain('put');
    expect(db.kv.rows.get('sf-notes')).toEqual({ key: 'sf-notes', value: [{ id: 'n1' }] });
    expect(await kvGet('sf-notes')).toEqual([{ id: 'n1' }]);
    expect(db.kv.calls).toContain('get');
  });

  it('附件 CRUD 全部委托 attachments 表（put/get/delete/bulkDelete/toArray）', async () => {
    await attachmentPut(makeAttachment('p1', [1, 2]));
    await attachmentPut(makeAttachment('p2', [3]));
    expect(fakeDb().attachments.rows.size).toBe(2);
    expect((await attachmentGet('p1'))?.name).toBe('p1.pdf');

    await attachmentDelete('p1');
    expect(fakeDb().attachments.rows.has('p1')).toBe(false);

    await attachmentBulkDelete(['p2', 'ghost']);
    expect(fakeDb().attachments.rows.size).toBe(0);

    await attachmentPut(makeAttachment('p3', [4]));
    const all = await attachmentGetAll();
    expect(all.map((r) => r.paperId)).toEqual(['p3']);
    expect(fakeDb().attachments.calls).toContain('toArray');
  });
});
