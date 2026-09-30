/**
 * Tauri 形态平台实现：经 __TAURI__.core.invoke 调用 src-tauri/src/lib.rs 的桥命令。
 *
 * 桥接约定（命令名固定、参数/返回值为 JSON 可序列化值）：
 * - fs_read   { path: string }                     -> string（UTF-8 文本）
 * - fs_read_base64 { path: string }                -> string（二进制产物的 base64 编码，如编译 PDF）
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
  if (!hasTauriBridge()) throw new Error('待 Tauri 桥接');
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

// ---------------------------------------------------------------------------
// base64 → 字节（手写实现，避免新增 npm 依赖；仅服务 PDF 产物读回）
// ---------------------------------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64_ALPHABET.length; i++) table[B64_ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** 标准 base64 解码为字节；容忍空白字符，缺省 padding 可省略，非法字符抛错 */
export function base64ToBytes(encoded: string): Uint8Array {
  const clean = encoded.replace(/[\s\r\n]/g, '');
  let len = clean.length;
  while (len > 0 && clean.charAt(len - 1) === '=') len--;
  const out = new Uint8Array(Math.floor((len * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let p = 0;
  for (let i = 0; i < len; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? B64_LOOKUP[code]! : -1;
    if (v < 0) throw new Error('base64 解码失败：非法字符');
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (buffer >> bits) & 0xff;
    }
  }
  return out;
}

/** 读取数据目录下的二进制产物（如编译得到的 main.pdf）并解码为字节；非 Tauri 环境不可用 */
export async function tauriReadBase64(path: string): Promise<Uint8Array> {
  const encoded = await invoke<string>('fs_read_base64', { path });
  return base64ToBytes(encoded);
}

/** 检测 __TAURI__：存在则用约定桥，否则回落 BrowserPlatform。 */
export function createTauriPlatform(): Platform {
  if (!hasTauriBridge()) return browserPlatform;
  return { fs: tauriFs, secrets: tauriSecrets, kind: 'tauri' };
}
