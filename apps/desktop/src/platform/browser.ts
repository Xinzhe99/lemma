/**
 * 浏览器形态平台实现。
 * - ProjectFs：IndexedDB 单 objectStore（键 = 虚拟路径）；IndexedDB 不可用时降级 localStorage，
 *   再不可用（如无 DOM 的测试环境）降级内存 Map（仅保命，不持久）。
 * - Secrets：localStorage，key 前缀 sf-secret.。
 *   安全边界：浏览器 localStorage 明文本机可读，仅适用于单机演示形态；
 *   Tauri 形态下应换 OS keychain（见 tauri.ts 的 secret_* 约定桥）。
 */

import type { Platform, ProjectFs, Secrets } from './types';

const DB_NAME = 'scholarforge-fs';
const STORE = 'files';
const LS_FILE_PREFIX = 'sf-file.';
const SECRET_PREFIX = 'sf-secret.';

type Backend = 'idb' | 'local' | 'memory';

const memoryFiles = new Map<string, string>();
const memorySecrets = new Map<string, string>();

function ls(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

let idbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (!idbPromise) {
    idbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    });
  }
  return idbPromise;
}

async function backend(): Promise<Backend> {
  if (typeof indexedDB !== 'undefined') {
    try {
      await openIdb();
      return 'idb';
    } catch {
      /* 降级 */
    }
  }
  return ls() ? 'local' : 'memory';
}

function toText(content: string | Uint8Array): string {
  return typeof content === 'string' ? content : new TextDecoder().decode(content);
}

function idbTx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openIdb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 操作失败'));
      }),
  );
}

const fs: ProjectFs = {
  async readFile(path) {
    const be = await backend();
    if (be === 'idb') {
      const v = await idbTx<string>('readonly', (s) => s.get(path));
      if (v === undefined) throw new Error(`文件不存在: ${path}`);
      return v;
    }
    if (be === 'local') {
      const v = ls()!.getItem(LS_FILE_PREFIX + path);
      if (v === null) throw new Error(`文件不存在: ${path}`);
      return v;
    }
    if (!memoryFiles.has(path)) throw new Error(`文件不存在: ${path}`);
    return memoryFiles.get(path)!;
  },

  async writeFile(path, content) {
    const text = toText(content);
    const be = await backend();
    if (be === 'idb') await idbTx('readwrite', (s) => s.put(text, path));
    else if (be === 'local') ls()!.setItem(LS_FILE_PREFIX + path, text);
    else memoryFiles.set(path, text);
  },

  async deleteFile(path) {
    const be = await backend();
    if (be === 'idb') await idbTx('readwrite', (s) => s.delete(path));
    else if (be === 'local') ls()!.removeItem(LS_FILE_PREFIX + path);
    else memoryFiles.delete(path);
  },

  async list() {
    const be = await backend();
    if (be === 'idb') {
      const keys = await idbTx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
      return keys.map(String).sort();
    }
    if (be === 'local') {
      const out: string[] = [];
      for (let i = 0; i < ls()!.length; i++) {
        const k = ls()!.key(i);
        if (k && k.startsWith(LS_FILE_PREFIX)) out.push(k.slice(LS_FILE_PREFIX.length));
      }
      return out.sort();
    }
    return [...memoryFiles.keys()].sort();
  },
};

const secrets: Secrets = {
  async get(key) {
    const store = ls();
    if (!store) return memorySecrets.get(key);
    return store.getItem(SECRET_PREFIX + key) ?? undefined;
  },
  async set(key, value) {
    const store = ls();
    if (!store) memorySecrets.set(key, value);
    else store.setItem(SECRET_PREFIX + key, value);
  },
};

export const browserPlatform: Platform = { fs, secrets, kind: 'browser' };
