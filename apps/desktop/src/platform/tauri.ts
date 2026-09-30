/**
 * Tauri 形态平台实现：经 __TAURI__.core.invoke 调用 src-tauri/src/lib.rs 的桥命令。
 *
 * 桥接约定（命令名固定、参数/返回值为 JSON 可序列化值）：
 * - fs_read   { path: string }                     -> string（UTF-8 文本）
 * - fs_write  { path: string, content: string }    -> null
 * - fs_delete { path: string }                     -> null
 * - fs_list   {}                                   -> string[]（扁平虚拟路径）
 * - secret_get { key: string }                     -> string | null
 * - secret_set { key: string, value: string }      -> null
 * - proc_run  { cmd, args, cwd? }                  -> { code, stdout, stderr }（编译/CLI agent 用）
 */

import { browserPlatform } from './browser';
import type { Platform, ProjectFs, Secrets } from './types';

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
}

function hasTauriBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const t = (window as unknown as TauriGlobal).__TAURI__;
  return Boolean(t?.core?.invoke);
}

async function invoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const t = (window as unknown as TauriGlobal).__TAURI__;
  const fn = t?.core?.invoke;
  if (!fn) throw new Error('待 Tauri 桥接');
  return fn<T>(cmd, args);
}

const tauriFs: ProjectFs = {
  readFile: (path) => invoke<string>('fs_read', { path }),
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

/** 桥命令的同步便捷入口（proc_run：Tectonic/latexmk/CLI agent 一次性调用） */
export async function tauriProcRun(
  cmd: string,
  args: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return invoke('proc_run', { cmd, args, cwd: cwd ?? null });
}

/** 检测 __TAURI__：存在则用约定桥，否则回落 BrowserPlatform。 */
export function createTauriPlatform(): Platform {
  if (!hasTauriBridge()) return browserPlatform;
  return { fs: tauriFs, secrets: tauriSecrets, kind: 'tauri' };
}
