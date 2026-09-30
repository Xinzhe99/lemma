/**
 * IndexedDB 持久层（Dexie 封装）：
 *  - kv 表：通用键值存储（key 主键，value 为任意可结构化克隆的 JSON 值）；
 *  - attachments 表：文献 PDF 附件（paperId 主键，字节以 Blob 落盘）。
 *
 * 环境降级：jsdom 等无 indexedDB 的环境自动切换到进程内存实现（Map），保持同一
 * 异步接口契约；Dexie 仅在真实环境（indexedDB 存在）初始化。
 * Dexie 为既有依赖（packages/library → 根 node_modules 提升），本模块不引入新包。
 */

import Dexie, { type Table } from 'dexie';

/** kv 表记录：value 为任意 JSON 值。 */
export interface KvRecord {
  key: string;
  value: unknown;
}

/** attachments 表记录：PDF 附件字节以 Blob 持久化。 */
export interface AttachmentRecord {
  paperId: string;
  data: Blob;
  name: string;
  savedAt: number;
}

export const DB_NAME = 'scholarforge';

/** 应用数据库 schema（版本 1）。 */
class ScholarForgeDb extends Dexie {
  kv!: Table<KvRecord, string>;
  attachments!: Table<AttachmentRecord, string>;

  constructor() {
    super(DB_NAME);
    this.version(1).stores({ kv: 'key', attachments: 'paperId' });
  }
}

let dbInstance: ScholarForgeDb | null = null;

/**
 * Dexie 单例（懒初始化）。仅在 indexedDB 可用的真实环境可获取；无 indexedDB 时抛出
 * 明确错误——降级环境请使用下方 kv 与 attachment 系列接口（自动落到内存实现）。
 */
export function getAppDb(): ScholarForgeDb {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB 不可用：getAppDb 仅在真实浏览器/桌面环境可用');
  }
  if (!dbInstance) dbInstance = new ScholarForgeDb();
  return dbInstance;
}

// ---------------------------------------------------------------------------
// 后端契约：Dexie（真实环境）与内存 Map（降级）共享同一异步接口
// ---------------------------------------------------------------------------

interface StorageBackend {
  kvGet(key: string): Promise<unknown>;
  kvSet(key: string, value: unknown): Promise<void>;
  attachmentPut(record: AttachmentRecord): Promise<void>;
  attachmentGet(paperId: string): Promise<AttachmentRecord | undefined>;
  attachmentDelete(paperId: string): Promise<void>;
  attachmentBulkDelete(paperIds: string[]): Promise<void>;
  attachmentGetAll(): Promise<AttachmentRecord[]>;
}

/** 内存降级后端：进程内 Map，接口契约与 Dexie 后端一致（不真正持久化）。 */
class MemoryBackend implements StorageBackend {
  private readonly kv = new Map<string, unknown>();
  private readonly attachments = new Map<string, AttachmentRecord>();

  async kvGet(key: string): Promise<unknown> {
    return this.kv.get(key);
  }

  async kvSet(key: string, value: unknown): Promise<void> {
    this.kv.set(key, value);
  }

  async attachmentPut(record: AttachmentRecord): Promise<void> {
    this.attachments.set(record.paperId, record);
  }

  async attachmentGet(paperId: string): Promise<AttachmentRecord | undefined> {
    return this.attachments.get(paperId);
  }

  async attachmentDelete(paperId: string): Promise<void> {
    this.attachments.delete(paperId);
  }

  async attachmentBulkDelete(paperIds: string[]): Promise<void> {
    for (const id of paperIds) this.attachments.delete(id);
  }

  async attachmentGetAll(): Promise<AttachmentRecord[]> {
    return [...this.attachments.values()];
  }
}

/** Dexie 后端：真实环境（indexedDB 存在）使用。 */
class DexieBackend implements StorageBackend {
  async kvGet(key: string): Promise<unknown> {
    const rec = await getAppDb().kv.get(key);
    return rec?.value;
  }

  async kvSet(key: string, value: unknown): Promise<void> {
    await getAppDb().kv.put({ key, value });
  }

  async attachmentPut(record: AttachmentRecord): Promise<void> {
    await getAppDb().attachments.put(record);
  }

  async attachmentGet(paperId: string): Promise<AttachmentRecord | undefined> {
    return getAppDb().attachments.get(paperId);
  }

  async attachmentDelete(paperId: string): Promise<void> {
    await getAppDb().attachments.delete(paperId);
  }

  async attachmentBulkDelete(paperIds: string[]): Promise<void> {
    await getAppDb().attachments.bulkDelete(paperIds);
  }

  async attachmentGetAll(): Promise<AttachmentRecord[]> {
    return getAppDb().attachments.toArray();
  }
}

let backend: StorageBackend | null = null;

function getBackend(): StorageBackend {
  if (!backend) {
    backend = typeof indexedDB === 'undefined' ? new MemoryBackend() : new DexieBackend();
  }
  return backend;
}

// ---------------------------------------------------------------------------
// 对外接口（操作失败会 reject——由调用方决定降级策略；内存后端不会失败）
// ---------------------------------------------------------------------------

/** 读 kv 表；无此键返回 undefined。 */
export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await getBackend().kvGet(key)) as T | undefined;
}

/** 写 kv 表（同 key 整值覆盖）。 */
export async function kvSet(key: string, value: unknown): Promise<void> {
  await getBackend().kvSet(key, value);
}

/** 写入/覆盖一条附件记录。 */
export async function attachmentPut(record: AttachmentRecord): Promise<void> {
  await getBackend().attachmentPut(record);
}

/** 读附件记录；无返回 undefined。 */
export async function attachmentGet(paperId: string): Promise<AttachmentRecord | undefined> {
  return getBackend().attachmentGet(paperId);
}

/** 删除单条附件。 */
export async function attachmentDelete(paperId: string): Promise<void> {
  await getBackend().attachmentDelete(paperId);
}

/** 批量删除附件（不存在的 id 为 no-op）。 */
export async function attachmentBulkDelete(paperIds: string[]): Promise<void> {
  await getBackend().attachmentBulkDelete(paperIds);
}

/** 读取全部附件（启动 hydrate 预载用）。 */
export async function attachmentGetAll(): Promise<AttachmentRecord[]> {
  return getBackend().attachmentGetAll();
}

/**
 * Blob → ArrayBuffer 的环境兼容封装：真实环境/Node 走 Blob.arrayBuffer()；
 * jsdom 等未实现该方法的 Blob 走 FileReader 兜底（测试环境用）。
 */
export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Blob 读取失败'));
    reader.readAsArrayBuffer(blob);
  });
}

/** 仅测试用：重置后端选择与 Dexie 单例（切换 indexedDB 可用性后需调用以重新选择）。 */
export function __resetStorageForTests(): void {
  backend = null;
  dbInstance = null;
}
