/**
 * 内置 TeX 引擎（Tectonic）自动下载管理器。
 *
 * 桥接约定（src-tauri/src/lib.rs 的 download_and_install_tectonic，参数 {}）：
 *   成功 -> { path: string, cached: boolean, firstRunNote: boolean }
 *   失败 -> 中文 Error 字符串（含"检查网络/代理；也可手动安装 Tectonic 或 TeX Live"指引）
 * Rust 侧：数据目录 bin/tectonic[.exe] 已存在直接返回 cached:true（幂等）；
 * 否则从 GitHub Releases 下载平台发行包（约 30MB）解包出单二进制并返回绝对路径。
 *
 * 浏览器形态无桥可调，返回固定中文错误"浏览器形态无法内置编译器，请使用桌面版"。
 * 命令内部只有 stdout 进度打印（拿不到细粒度百分比），UI 侧用不确定进度文案
 * （i18n 键 texsetup.*）；下载为 async 命令，期间 UI 不卡。
 */

import { getPlatform } from './platform/types';
import { tauriProcRun } from './platform/tauri';
import { t } from './i18n';
import { useSettingsStore, type Language } from './state/settingsStore';

/** Rust 命令成功返回体（camelCase 经 serde rename） */
export interface BuiltinTectonicInfo {
  /** 内置 tectonic 可执行文件的绝对路径 */
  path: string;
  /** true = 数据目录已存在，本次未下载 */
  cached: boolean;
  /** 首次编译需联网拉宏包（Tectonic 按需下载宏包缓存，首编译慢属正常） */
  firstRunNote?: boolean;
}

export type EnsureBuiltinTectonicResult = BuiltinTectonicInfo | { error: string };

/** 结果判别：成功形态带 path（失败形态只带 error） */
export function isBuiltinTectonicInfo(r: EnsureBuiltinTectonicResult): r is BuiltinTectonicInfo {
  return typeof (r as BuiltinTectonicInfo).path === 'string';
}

// ---------------------------------------------------------------------------
// 状态机：供潜在 UI（与测试）观察下载阶段；命令本身不可取消、只跑一次
// ---------------------------------------------------------------------------

export type TexSetupPhase = 'idle' | 'downloading' | 'ready' | 'error';

export interface TexSetupState {
  phase: TexSetupPhase;
  /** 当前阶段的用户可读文案（不确定进度：无百分比） */
  message: string;
  /** phase === 'error' 时的中文错误 */
  error: string | null;
  /** phase === 'ready' 时的内置引擎绝对路径 */
  path: string | null;
}

let state: TexSetupState = { phase: 'idle', message: '', error: null, path: null };
const listeners = new Set<() => void>();

function setState(patch: Partial<TexSetupState>): void {
  state = { ...state, ...patch };
  for (const fn of listeners) fn();
}

/** 只读快照（UI 订阅后读取渲染） */
export function getTexSetupState(): Readonly<TexSetupState> {
  return state;
}

/** 订阅状态变化；返回取消订阅函数 */
export function subscribeTexSetup(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** phase -> 进度文案（i18n；reason 仅 error 阶段使用） */
export function texSetupPhaseText(phase: TexSetupPhase, lang: Language, reason = ''): string {
  switch (phase) {
    case 'downloading':
      return t('texsetup.downloading', lang);
    case 'ready':
      return t('texsetup.ready', lang);
    case 'error':
      return t('texsetup.error', lang, { reason });
    default:
      return '';
  }
}

/** 已就绪的内置引擎绝对路径（未就绪返回 null；供 compileAction 探测链注入） */
export function getReadyBuiltinTectonicPath(): string | null {
  return state.phase === 'ready' ? state.path : null;
}

/** 测试复位（还原单例状态） */
export function resetTexSetupForTests(): void {
  state = { phase: 'idle', message: '', error: null, path: null };
}

// ---------------------------------------------------------------------------
// 桥调用（platform/tauri.ts 只读，此处按同一约定做最小 invoke）
// ---------------------------------------------------------------------------

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
}

async function invokeInstall(): Promise<BuiltinTectonicInfo> {
  const bridge =
    typeof window !== 'undefined' ? (window as unknown as TauriGlobal).__TAURI__ : undefined;
  const fn = bridge?.core?.invoke;
  if (!fn) throw new Error('待 Tauri 桥接');
  return fn<BuiltinTectonicInfo>('download_and_install_tectonic', {});
}

function currentLang(): Language {
  return useSettingsStore.getState().language;
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

let inflight: Promise<EnsureBuiltinTectonicResult> | null = null;

async function doEnsure(): Promise<EnsureBuiltinTectonicResult> {
  // 幂等（会话内已就绪）：直接返回，不再走桥
  if (state.phase === 'ready' && state.path) {
    return { path: state.path, cached: true, firstRunNote: true };
  }
  if (getPlatform().kind !== 'tauri') {
    const msg = t('texsetup.browserUnsupported', currentLang());
    setState({ phase: 'error', message: msg, error: msg });
    return { error: msg };
  }
  const lang = currentLang();
  setState({ phase: 'downloading', message: texSetupPhaseText('downloading', lang), error: null });
  try {
    const info = await invokeInstall();
    setState({
      phase: 'ready',
      message: texSetupPhaseText('ready', lang),
      path: info.path,
      error: null,
    });
    return info;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    setState({
      phase: 'error',
      message: texSetupPhaseText('error', lang, reason),
      error: reason,
    });
    return { error: reason };
  }
}

/**
 * 确保内置 Tectonic 可用（不存在则触发自动下载）。
 * 并发调用共享同一次在途请求；结果二选一：{path, cached, firstRunNote?} 或 {error}。
 */
export function ensureBuiltinTectonic(): Promise<EnsureBuiltinTectonicResult> {
  if (!inflight) {
    inflight = doEnsure().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

// ---------------------------------------------------------------------------
// v5.1.0 开箱即用闲时预热：
//   1) 引擎本体（不存在则后台下载 ~30MB，幂等，已装秒回）；
//   2) 宏包缓存（仅新装引擎时：编译一个最小文档，预热 Tectonic 按需拉取的
//      格式文件与基础宏包——用户首次真实编译不再等冷缓存）。
// 全程 fire-and-forget：失败静默（编译探测链仍会在真正编译时兜底重试）。
// 依赖注入形态便于单测（默认绑定真实桥）。
// ---------------------------------------------------------------------------

export interface WarmEngineDeps {
  ensure: () => Promise<EnsureBuiltinTectonicResult>;
  writeFile: (path: string, content: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  run: (cmd: string, args: string[], cwd?: string) => Promise<{ code: number; stdout: string; stderr: string }>;
  isDesktop: () => boolean;
}

export type WarmEngineResult = 'cached' | 'warmed' | 'skipped' | 'error';

const WARM_DOC = [
  '\\documentclass{article}',
  '\\usepackage{amsmath,graphicx,hyperref,booktabs}',
  '\\begin{document}',
  'Warm-up: $\\int_0^1 x^2\\,dx$.',
  '\\end{document}',
  '',
].join('\n');

export async function warmCompileEngine(deps: WarmEngineDeps): Promise<WarmEngineResult> {
  if (!deps.isDesktop()) return 'skipped';
  let info: EnsureBuiltinTectonicResult;
  try {
    info = await deps.ensure();
  } catch {
    return 'error';
  }
  if (!isBuiltinTectonicInfo(info)) return 'error';
  if (info.cached) return 'cached'; // 引擎已在位：无需预热宏包缓存
  try {
    await deps.writeFile('sf-engine-warm.tex', WARM_DOC);
    await deps.run(info.path, ['-X', 'compile', 'sf-engine-warm.tex'], '');
  } catch {
    return 'warmed'; // 预热失败不视为错误——真实编译时会再次按需拉取
  } finally {
    // 尽力清理预热产物（失败不致命；物化目录不留垃圾）
    for (const f of ['sf-engine-warm.tex', 'sf-engine-warm.pdf']) {
      deps.deleteFile(f).catch(() => undefined);
    }
  }
  return 'warmed';
}

/** 默认绑定：真实平台桥 + App 空闲时调用 */
export function warmCompileEngineDefault(): Promise<WarmEngineResult> {
  return warmCompileEngine({
    ensure: ensureBuiltinTectonic,
    writeFile: (p, c) => getPlatform().fs.writeFile(p, c),
    deleteFile: (p) => getPlatform().fs.deleteFile(p),
    run: (cmd, args, cwd) => tauriProcRun(cmd, args, cwd),
    isDesktop: () =>
      typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ != null,
  });
}
