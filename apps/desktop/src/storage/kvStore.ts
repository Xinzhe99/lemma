/**
 * localStorage → IndexedDB 大数据迁移层（务实方案）：
 *  - localStorage 共享 5MB 配额，真实文献库（papers JSON）会逼近/超限且写入失败无人处理；
 *  - IndexedDB 无此量级限制。本模块把「大数据」显式引入 IndexedDB：
 *      migrateLocalStorageToIdb()：启动搬运——体积 ≥ 32KB 的 sf-* 键搬入 Dexie kv 表
 *                                   并删除 localStorage 原键，释放配额；
 *      setBigData / getBigData   ：大数据写入方的显式读写入口（libraryStore 已接线）。
 *
 * 数据安全（搬运绝不丢数据的保障）：
 *  - 惰性读取方属主的键一律跳过（见 LAZY_READER_*）：它们的属主在任意时刻异步读
 *    localStorage，搬走即读丢；
 *  - 搬运顺序为先写入 IndexedDB、成功后才删 localStorage 原键；
 *  - 键已被 setBigData 接管（有在途/缓存写入）时跳过搬运，交由写方持久化最新值；
 *  - IndexedDB 已有该键（早前迁移过）时仅清 localStorage 旧副本，不用旧值覆盖新值。
 */

import { kvGet, kvSet } from './db';

export interface MigrationResult {
  /** 成功搬入 IndexedDB 并已从 localStorage 删除的键。 */
  migrated: string[];
  /** 未搬运的键（体积过小 / 惰性读取方属主 / 坏 JSON / 已被写方接管 / 搬运失败）。 */
  skipped: string[];
}

/** 大数据分界：≥ 32KB 的 sf-* 键搬运，更小的留在 localStorage（小数据无谓迁移）。 */
export const BIG_DATA_THRESHOLD_BYTES = 32 * 1024;

const SF_KEY_PREFIX = 'sf-';

/**
 * 惰性读取方属主（前缀/精确匹配）——迁移不可搬：
 *  - sf-file. / sf-secret.：platform/browser.ts 的文件与密钥存取，任意时刻异步读；
 *  - sf-settings / sf-submit / sf-writing-stats：store 暴露"测试与调试用"的再读 helper
 *    （readPersistedSettings 等），搬运会使其读到空。
 */
const LAZY_READER_PREFIXES = ['sf-file.', 'sf-secret.'];
/**
 * v7.0.0 修复（数据丢失）：全部「模块加载时同步读 localStorage」的 store 键都不可搬——
 * 此前名单只有 3 个，sf-projects（最多 20 个项目完整快照，轻易超 32KB）等被搬入
 * IndexedDB 后属主仍读 localStorage → 下次启动项目列表全空。现按实际 grep 的全量键保护。
 * v7.8.0 修复（数据丢失）：补齐非 state/ 目录的同类属主——workflowOverrides
 * （sf-workflow-overrides，单步 prompt 上限 20k 字符，多步轻易超 32KB）、agent-hub
 * （sf-agent-runs，10 条工作流产物文本）、editor 自定义词典（sf-custom-dict），
 * 三者的读侧都在模块加载时同步读 localStorage，搬走即读空、且下次写盘会把迁移后的
 * IndexedDB 旧值留在原地形成「旧值复活」。
 */
const LAZY_READER_KEYS = [
  'sf-settings',
  'sf-submit',
  'sf-writing-stats',
  'sf-projects',
  'sf-pdf-annotations',
  'sf-comments',
  'sf-notes',
  'sf-agent-memory',
  'sf-agent-usage',
  'sf-agent-plans',
  'sf-agent-runs',
  'sf-user-prompts',
  'sf-user-templates',
  'sf-workflow-overrides',
  'sf-custom-dict',
  'sf-digest-cache',
  'sf-digest-subs',
  'sf-onboarding',
  'sf-onboarding-dismissed',
];

function isLazyReaderKey(key: string): boolean {
  return LAZY_READER_PREFIXES.some((p) => key.startsWith(p)) || LAZY_READER_KEYS.includes(key);
}

/** 字节体积（Blob 计 UTF-8 字节数；构造 Blob 失败的极端环境退化为字符数）。 */
function byteSize(value: string): number {
  try {
    return new Blob([value]).size;
  } catch {
    return value.length;
  }
}

// ---------------------------------------------------------------------------
// 写入队列：同键串行落盘（保证写入顺序）+ 读己之写缓存
// ---------------------------------------------------------------------------

const writeQueues = new Map<string, Promise<unknown>>();
/** 在途写入值（键 → 最近一次 setBigData 尚未落盘的值）——迁移据此避让写方。 */
const pendingWrites = new Map<string, unknown>();
/** 读己之写缓存（键 → 最近一次写入值；getBigData 优先命中，避免读到旧持久层值）。 */
const readCache = new Map<string, unknown>();

/** 把一次异步写挂到键的串行队列尾；返回反映本次写真实结果的 Promise。 */
function enqueueWrite(key: string, write: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(key) ?? Promise.resolve();
  const next = prev.then(write, write);
  writeQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  return next;
}

/** 写方是否已接管该键（有在途写入或已缓存写入）。 */
function ownedByWriter(key: string): boolean {
  return pendingWrites.has(key) || readCache.has(key);
}

// ---------------------------------------------------------------------------
// v7.8.0 降级副本的权威标记（修复「写入但永不读回」）：
// IndexedDB 写失败时降级写入 localStorage 的副本，此前只在「IndexedDB 无该键 / 读失败」
// 时才被读到——IndexedDB 里留着更旧的值时，降级副本会被 getBigData 忽略、并随后被
// 启动迁移当作「旧副本」直接删除，新数据静默消失。现降级写入同时打标（idbfb:<key>，
// 非 sf- 前缀故不参与迁移扫描），标记存在期间 localStorage 副本即权威值：
//  - getBigData：IndexedDB 命中但有标记 → 返回 localStorage 副本（新值）；
//  - setBigData：IndexedDB 写成功 → 清标记（此时 localStorage 副本已成旧副本）；
//  - migrateLocalStorageToIdb：有标记的键跳过（不搬、更不删）；标记清除后按普通遗留副本处理。
// ---------------------------------------------------------------------------

const FALLBACK_MARK_PREFIX = 'idbfb:';

function fallbackMarkKey(key: string): string {
  return `${FALLBACK_MARK_PREFIX}${key}`;
}

/** 该键的 localStorage 副本是否为「比 IndexedDB 新」的降级副本。 */
function fallbackAuthoritative(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(fallbackMarkKey(key)) !== null;
  } catch {
    return false;
  }
}

function markFallbackAuthoritative(key: string): void {
  try {
    localStorage.setItem(fallbackMarkKey(key), String(Date.now()));
  } catch {
    /* 标记写失败：退化为旧行为（不更糟） */
  }
}

function clearFallbackMark(key: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(fallbackMarkKey(key));
  } catch {
    /* 忽略 */
  }
}

/** 读 localStorage 里该键的 JSON 值（缺失 / 坏 JSON → undefined）。 */
function readLocalJson<T>(key: string): T | undefined {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    raw = null;
  }
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 对外接口
// ---------------------------------------------------------------------------

/**
 * 大数据写入：后台按键串行写 IndexedDB。与旧 localStorage 写路径同语义——
 * 永不因配额/持久化失败抛错（IndexedDB 无 5MB 限制；失败仅告警），不打断 UI。
 */
export function setBigData(key: string, value: unknown): Promise<void> {
  readCache.set(key, value);
  pendingWrites.set(key, value);
  return enqueueWrite(key, async () => {
    try {
      await kvSet(key, value);
      clearFallbackMark(key); // IndexedDB 已是最新 → 旧降级副本（若有）作废
    } catch (e) {
      // v7.6.0：IndexedDB 写失败（打包环境存储异常等）→ 降级写 localStorage，
      // 宁可冒配额风险也不静默丢数据；getBigData 读路径本就兜底 localStorage
      console.warn(`[storage] IndexedDB 写入失败（key=${key}），降级 localStorage：`, e);
      try {
        const serialized = JSON.stringify(value);
        try {
          localStorage.removeItem(`idb:${key}`); // 迁移层留下的旧占位，先清出配额
        } catch {
          /* 忽略 */
        }
        localStorage.setItem(key, serialized);
        markFallbackAuthoritative(key); // v7.8.0：此后该副本比 IndexedDB 里的值新
      } catch (e2) {
        console.warn(`[storage] localStorage 降级写入也失败（key=${key}）：`, e2);
      }
    } finally {
      // 仅当没有更新值在途时清除标记（同值重复写为无害边界）
      if (pendingWrites.get(key) === value) pendingWrites.delete(key);
    }
  });
}

/**
 * 大数据读取：读己之写缓存最优先，其次 IndexedDB（降级副本打标期间以 localStorage 为准），
 * 最后兜底读 localStorage 旧键（启动迁移前的首次运行 / 迁移被跳过的场景）。
 */
export async function getBigData<T>(key: string): Promise<T | undefined> {
  if (readCache.has(key)) return readCache.get(key) as T;
  let fromIdb: T | undefined;
  try {
    fromIdb = await kvGet<T>(key);
  } catch (e) {
    console.warn(`[storage] IndexedDB 读取失败（key=${key}），回退 localStorage：`, e);
  }
  if (fromIdb !== undefined) {
    if (fallbackAuthoritative(key)) {
      // v7.8.0：IndexedDB 里是旧值（最近一次写失败已把新值降级到 localStorage）→ 以副本为准
      const recovered = readLocalJson<T>(key);
      if (recovered !== undefined) {
        readCache.set(key, recovered);
        return recovered;
      }
      clearFallbackMark(key); // 标记在但副本已不存在/坏 JSON：标记作废，回落 IndexedDB 值
    }
    readCache.set(key, fromIdb);
    return fromIdb;
  }
  return readLocalJson<T>(key);
}

/**
 * 启动迁移：扫描全部 sf-* 键——
 *  ≥ 32KB 且 JSON 合法且非惰性读取方属主 → 写入 Dexie kv 表、成功后删 localStorage 原键；
 *  其余（< 32KB / 坏 JSON / 惰性属主 / 已被写方接管 / 写入失败 / 降级副本已打标）→
 *  留在原地并计入 skipped。
 * 幂等：IndexedDB 已有的键视为已迁移，仅清 localStorage 旧副本（不以旧值覆盖新值）。
 */
export async function migrateLocalStorageToIdb(): Promise<MigrationResult> {
  const migrated: string[] = [];
  const skipped: string[] = [];
  if (typeof localStorage === 'undefined') return { migrated, skipped };

  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(SF_KEY_PREFIX)) keys.push(k);
  }

  for (const key of keys) {
    if (isLazyReaderKey(key)) {
      skipped.push(key);
      continue;
    }
    const raw = localStorage.getItem(key);
    if (raw == null) {
      skipped.push(key);
      continue;
    }
    if (byteSize(raw) < BIG_DATA_THRESHOLD_BYTES) {
      skipped.push(key);
      continue;
    }
    if (ownedByWriter(key)) {
      skipped.push(key); // 写方持有最新值主权，交给 setBigData 落盘
      continue;
    }
    let existing: unknown;
    try {
      existing = await kvGet(key);
    } catch {
      existing = undefined;
    }
    if (ownedByWriter(key)) {
      skipped.push(key); // await 期间被写方接管
      continue;
    }
    if (existing !== undefined) {
      if (fallbackAuthoritative(key)) {
        // v7.8.0：该副本是 IndexedDB 写失败时的降级副本（比库里的值新）——
        // 既不搬（避免用旧值覆盖）也不删（删了就是丢数据），留给 getBigData 读回；
        // 下次 IndexedDB 写成功后标记自动清除，此键再按普通遗留副本处理。
        skipped.push(key);
        continue;
      }
      // 早前已迁移/写方已持久化：仅清 localStorage 旧副本，不覆盖 IndexedDB 新值
      localStorage.removeItem(key);
      migrated.push(key);
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped.push(key); // 坏 JSON：不动原键
      continue;
    }
    try {
      await enqueueWrite(key, async () => {
        await kvSet(key, parsed);
      });
    } catch (e) {
      console.warn(`[storage] 迁移搬运失败，保留 localStorage 原键（key=${key}）：`, e);
      skipped.push(key);
      continue;
    }
    localStorage.removeItem(key); // 先落盘成功、再删原键
    migrated.push(key);
  }
  return { migrated, skipped };
}

/** 仅测试用：清空写入队列与缓存状态。 */
export function __resetKvStoreForTests(): void {
  writeQueues.clear();
  pendingWrites.clear();
  readCache.clear();
}
