/**
 * Tauri 形态平台实现：经 __TAURI__.core.invoke 调用 src-tauri/src/lib.rs 的桥命令。
 *
 * 桥接约定（命令名固定、参数/返回值为 JSON 可序列化值）：
 * - fs_read   { path: string }                     -> string（UTF-8 文本）
 * - fs_read_base64 { path: string }                -> string（二进制产物的 base64 编码，如编译 PDF）
 * - fs_write  { path: string, content: string }    -> null
 * - fs_write_base64 { path: string, data: string } -> null（二进制写入，base64 编码，如插图向导的图片）
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

/**
 * 写入二进制文件（base64 编码，如插图向导写入 figures/ 图片）。
 * 桥接约定：fs_write_base64 { path, data } -> null，Rust 侧 base64 解码后落盘。
 * 调用方应先确认 getPlatform().kind === 'tauri'，浏览器形态直接跳过。
 */
export async function tauriWriteFileBase64(path: string, data: string): Promise<void> {
  await invoke<void>('fs_write_base64', { path, data });
}

// ---------------------------------------------------------------------------
// 用户选择的本地项目文件夹（绝对路径）桥：新建项目选择本地路径后，
// 项目文件物化到该目录 / 打开项目时扫描合并。相对路径命令族（fs_*）的
// safe_rel 一律拒绝绝对路径，故绝对路径操作必须走下面这组显式命令。
// ---------------------------------------------------------------------------

/** 原生文件夹选择器（tauri-plugin-dialog，注册于 lib.rs；权限 dialog:default）。取消/失败 → null */
export async function tauriPickDirectory(title: string): Promise<string | null> {
  try {
    const picked = await invoke<string | string[] | null>('plugin:dialog|open', {
      options: { directory: true, multiple: false, title },
    });
    if (typeof picked === 'string' && picked.trim()) return picked;
    if (Array.isArray(picked) && typeof picked[0] === 'string' && picked[0]!.trim()) return picked[0]!;
    return null;
  } catch {
    // 插件缺失/权限拒绝（如旧安装包）：回落 null，调用方保留手输路径输入框
    return null;
  }
}

/** 把项目文本文件写入用户选择的本地目录（dir 绝对路径 + rel 项目内相对路径） */
export async function tauriWriteProjectFile(dir: string, rel: string, content: string): Promise<void> {
  await invoke<void>('fs_write_absolute', { dir, rel, content });
}

/** 读取用户本地项目目录下的文本文件（打开项目时磁盘 → 记录合并用） */
export async function tauriReadProjectFile(dir: string, rel: string): Promise<string> {
  return invoke<string>('fs_read_absolute', { dir, rel });
}

/** 删除用户本地项目目录下的文件（写探针清理；目标不存在不报错） */
export async function tauriDeleteProjectFile(dir: string, rel: string): Promise<void> {
  await invoke<void>('fs_delete_absolute', { dir, rel });
}

/** 目录扫描条目：相对路径 + 修改时间（Unix 毫秒） */
export interface DirEntryInfo {
  path: string;
  mtimeMs: number;
}

/** 扫描用户本地项目目录（跳过隐藏条目；目录不存在抛错） */
export async function tauriScanProjectDir(dir: string): Promise<DirEntryInfo[]> {
  return invoke<DirEntryInfo[]>('fs_scan_absolute', { dir });
}

/** 检测 __TAURI__：存在则用约定桥，否则回落 BrowserPlatform。 */
export function createTauriPlatform(): Platform {
  if (!hasTauriBridge()) return browserPlatform;
  return { fs: tauriFs, secrets: tauriSecrets, kind: 'tauri' };
}
