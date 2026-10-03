/**
 * Tauri 更新插件的最小防御性封装（薄封装，无业务状态）。
 *
 * 非 Tauri 环境（浏览器 / 测试）下这些 npm 包的调用会抛错，统一在此收口：
 * - relaunchApp：plugin-process 的 relaunch（安装新版本后重启）
 * - getAppVersion：@tauri-apps/api/app 的 getVersion（动态 import 防浏览器）
 * - fetchUpdaterStatus：lib.rs 的 updater_status 诊断桥（签名公钥是否已配置），
 *   经 __TAURI__.core.invoke 调用（与 platform/tauri.ts 同一约定）；桥不可用时
 *   返回 null，由调用方继续走 check() 让真实错误浮出。
 *
 * check/download/install 不在此封装：updateStore 直接动态 import
 * '@tauri-apps/plugin-updater'，以便测试 mock 整个 plugin 模块。
 */

/** updater_status 命令的返回结构（Rust 侧 UpdaterStatus）。 */
export interface UpdaterStatus {
  configured: boolean;
}

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
}

/**
 * 平台检测（v2.2.0）：macOS 上 install() 只替换 app bundle 不杀进程，
 * 可以下载完立即调用（用户下次正常重启即生效——Codex 体验）；
 * Windows NSIS 的 install() 会启动安装器并退出进程，须用户确认后才调。
 */
export function isMacOSPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
}

function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> | null {
  if (typeof window === 'undefined') return null;
  const fn = (window as unknown as TauriGlobal).__TAURI__?.core?.invoke;
  if (!fn) return null;
  return fn<T>(cmd, args);
}

/** 重启应用（plugin-process relaunch）。非 Tauri 环境抛中文错误。 */
export async function relaunchApp(): Promise<void> {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

/** 当前应用版本号（@tauri-apps/api/app）。非 Tauri 环境抛中文错误。 */
export async function getAppVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

/**
 * 查询 updater 签名公钥配置状态。桥不可用（非 Tauri 环境 / 命令缺失）时返回
 * null——调用方不应据此判死，而是继续 check()，由插件错误兜底。
 */
export async function fetchUpdaterStatus(): Promise<UpdaterStatus | null> {
  try {
    return await tauriInvoke<UpdaterStatus>('updater_status');
  } catch {
    return null;
  }
}
