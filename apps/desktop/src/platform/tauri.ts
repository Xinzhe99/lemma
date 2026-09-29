/**
 * Tauri 形态平台实现（约定桥 stub）。
 *
 * 桥接约定（WS-E Tauri 壳落地后实现，命令名固定、参数/返回值为 JSON 可序列化值）：
 * - fs_read   { path: string }                     -> string（UTF-8 文本；二进制返回 base64）
 * - fs_write  { path: string, content: string }    -> null
 * - fs_delete { path: string }                     -> null
 * - fs_list   {}                                   -> string[]（扁平虚拟路径）
 * - secret_get { key: string }                     -> string | null
 * - secret_set { key: string, value: string }      -> null（后端应写入 OS keychain）
 *
 * 当前所有方法统一抛出「待 Tauri 桥接」，避免静默假成功。
 */

import { browserPlatform } from './browser';
import type { Platform, ProjectFs, Secrets } from './types';

function hasTauriBridge(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__);
}

async function invoke<T>(_cmd: string, _args: Record<string, unknown>): Promise<T> {
  throw new Error('待 Tauri 桥接');
}

const tauriFs: ProjectFs = {
  readFile: (path) => invoke<string | Uint8Array>('fs_read', { path }),
  writeFile: (path, content) =>
    invoke<void>('fs_write', {
      path,
      content: typeof content === 'string' ? content : new TextDecoder().decode(content),
    }),
  deleteFile: (path) => invoke<void>('fs_delete', { path }),
  list: () => invoke<string[]>('fs_list', {}),
};

const tauriSecrets: Secrets = {
  get: (key) => invoke<string | undefined>('secret_get', { key }),
  set: (key, value) => invoke<void>('secret_set', { key, value }),
};

/** 检测 __TAURI__：存在则用约定桥，否则回落 BrowserPlatform。 */
export function createTauriPlatform(): Platform {
  if (!hasTauriBridge()) return browserPlatform;
  return { fs: tauriFs, secrets: tauriSecrets, kind: 'tauri' };
}
