/**
 * 内置 pandoc（docx 导出）管理器 + 导出动作。
 *
 * 桥接约定（src-tauri/src/lib.rs 的 download_and_install_pandoc，参数 {}）：
 *   成功 -> { path: string, cached: boolean }（path 为内置绝对路径或命令名 "pandoc"）
 *   失败 -> 中文 Error 字符串（含「brew install pandoc / 手动安装」指引）
 * Rust 侧探测链：数据目录 bin/pandoc[.exe]（幂等缓存）→ 系统 pandoc
 * （--version 探测）→ Windows x64 从 GitHub Releases 下载官方 zip
 * （pandoc-3.12-windows-x86_64.zip，内含子目录 pandoc-3.12/pandoc.exe）；
 * macOS/Linux 不做内置下载（新版官方资产为 .pkg 安装器），返回中文指引。
 *
 * 前端探测链同编译引擎（texSetup/compileAction 模式）：系统 pandoc --version
 * 通过即直接使用（不触发 40MB 下载）→ 否则调桥内置下载 → 失败中文错误；
 * 浏览器形态无桥可调，返回固定中文提示「导出 docx 需桌面版」。
 *
 * 导出流程（exportDocx，仅 Tauri 形态）：把 workspace 文本文件物化到数据目录
 * （与真实编译同一工作目录，复用 compileAction.materializeProjectFiles）→
 * tauriProcRun(pandoc, [entry, -o, out.docx, --from=latex, --to=docx]) →
 * fs_read_base64 读回 docx → Blob 触发浏览器下载。
 * UI 入口：SubmitPanel「导出 Word (.docx)」按钮 + 命令 export.docx
 * （commands.ts，集成者注册，本模块导出动作即可）。
 */

import { getPlatform } from './platform/types';
import { tauriProcRun, tauriReadBase64 } from './platform/tauri';
import {
  materializeProjectFiles,
  probeFromRun,
  resolveCompileEntry,
} from './compileAction';
import { useSettingsStore, type Language } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';

/** Rust 命令成功返回体（camelCase 经 serde rename） */
export interface BuiltinPandocInfo {
  /** 可用的 pandoc 可执行路径（内置为数据目录绝对路径；系统 pandoc 为命令名 "pandoc"） */
  path: string;
  /** true = 未发生下载（数据目录已有 / 使用系统 pandoc） */
  cached: boolean;
}

export type EnsureBuiltinPandocResult = BuiltinPandocInfo | { error: string };

/** 结果判别：成功形态带 path（失败形态只带 error） */
export function isBuiltinPandocInfo(r: EnsureBuiltinPandocResult): r is BuiltinPandocInfo {
  return typeof (r as BuiltinPandocInfo).path === 'string';
}

// ---------------------------------------------------------------------------
// 双语文案（D15 同款约定：模块级 L 字典，调用处在发消息那一刻动态读取语言）
// ---------------------------------------------------------------------------

interface PandocDict {
  browserUnsupported: string;
  noEntry: string;
  ensureFailed: (reason: string) => string;
  materializeFailed: (reason: string) => string;
  pandocFailed: (code: number, detail: string) => string;
  readBackFailed: (reason: string) => string;
}

export const L: Record<Language, PandocDict> = {
  zh: {
    browserUnsupported: '导出 docx 需桌面版（浏览器形态无法内置 pandoc）',
    noEntry: '未找到可导出的 .tex 入口文件',
    ensureFailed: (reason) => `pandoc 不可用：${reason}`,
    materializeFailed: (reason) => `项目文件物化失败：${reason}`,
    pandocFailed: (code, detail) => `pandoc 转换失败（退出码 ${code}）：${detail}`,
    readBackFailed: (reason) => `docx 产物读回失败：${reason}`,
  },
  en: {
    browserUnsupported: 'Exporting docx requires the desktop app (the browser build cannot bundle pandoc)',
    noEntry: 'No .tex entry file found to export',
    ensureFailed: (reason) => `pandoc is unavailable: ${reason}`,
    materializeFailed: (reason) => `Failed to materialize project files: ${reason}`,
    pandocFailed: (code, detail) => `pandoc conversion failed (exit code ${code}): ${detail}`,
    readBackFailed: (reason) => `Failed to read back the docx artifact: ${reason}`,
  },
};

/** 按语言取文案 */
export function pick(lang: Language): PandocDict {
  return L[lang];
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// 纯函数部件（可单测）
// ---------------------------------------------------------------------------

/** 由入口推算产物 docx 相对路径：main.tex -> main.docx（pandoc -o 约定） */
export function docxTargetFor(entry: string): string {
  return `${entry.replace(/\.tex$/i, '')}.docx`;
}

/** pandoc 命令参数：入口 → docx，LaTeX 源、docx 目标（cwd 为数据目录根） */
export function buildPandocArgs(entry: string, outPath: string): string[] {
  return [entry, '-o', outPath, '--from=latex', '--to=docx'];
}

/** 浏览器下载文件名：项目名可用时用项目名，否则入口文件名去扩展名；清理路径非法字符 */
export function docxDownloadName(projectName: string, entry: string): string {
  const entryBase = entry.replace(/\.tex$/i, '').split(/[\\/]/).pop() ?? '';
  const base = (projectName.trim() || entryBase || 'manuscript')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return `${base}.docx`;
}

// ---------------------------------------------------------------------------
// ensureBuiltinPandoc：探测链 + 会话内缓存（并发共享同一次在途请求）
// ---------------------------------------------------------------------------

interface TauriGlobal {
  __TAURI__?: { core?: { invoke?: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T> } };
}

async function invokeInstallPandoc(): Promise<BuiltinPandocInfo> {
  const bridge =
    typeof window !== 'undefined' ? (window as unknown as TauriGlobal).__TAURI__ : undefined;
  const fn = bridge?.core?.invoke;
  if (!fn) throw new Error('待 Tauri 桥接');
  return fn<BuiltinPandocInfo>('download_and_install_pandoc', {});
}

/** 系统 pandoc --version 探测（退出码 0 即可用；命令不存在/无法启动按不可用处理） */
async function probeSystemPandoc(): Promise<boolean> {
  try {
    return probeFromRun(await tauriProcRun('pandoc', ['--version'], '')).ok;
  } catch {
    return false;
  }
}

let resolved: BuiltinPandocInfo | null = null;
let inflight: Promise<EnsureBuiltinPandocResult> | null = null;

async function doEnsure(): Promise<EnsureBuiltinPandocResult> {
  // 会话内幂等：已解析过（系统 pandoc 或内置下载完成）直接复用
  if (resolved) return resolved;
  if (getPlatform().kind !== 'tauri') {
    return { error: pick(useSettingsStore.getState().language).browserUnsupported };
  }
  // 1) 系统 pandoc：直接使用，免 40MB 下载（Rust 侧也会再探一次，双保险）
  if (await probeSystemPandoc()) {
    resolved = { path: 'pandoc', cached: true };
    return resolved;
  }
  // 2) 内置下载（Windows x64 落盘；macOS/Linux Rust 侧返回中文指引错误）
  try {
    const info = await invokeInstallPandoc();
    resolved = info;
    return info;
  } catch (e) {
    return { error: errText(e) };
  }
}

/**
 * 确保可用 pandoc（系统探测 → 内置下载）。并发调用共享同一次在途请求；
 * 结果二选一：{path, cached} 或 {error}。
 */
export function ensureBuiltinPandoc(): Promise<EnsureBuiltinPandocResult> {
  if (!inflight) {
    inflight = doEnsure().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** 测试复位（清除会话内缓存） */
export function resetPandocForTests(): void {
  resolved = null;
}

// ---------------------------------------------------------------------------
// exportDocx：物化 → pandoc 转换 → 读回 → Blob 下载
// ---------------------------------------------------------------------------

export type ExportDocxResult =
  | { ok: true; entry: string; docxPath: string; bytes: number }
  | { ok: false; error: string };

/** 触发浏览器下载（Blob + 隐藏 <a>，与 SubmitPanel 导出 zip 同一手法） */
export function triggerDocxDownload(name: string, bytes: Uint8Array): void {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 导出当前项目为 Word（.docx）：仅桌面形态；浏览器形态返回中文提示。
 * 物化项目文本文件到数据目录（pandoc cwd），转换产物经 fs_read_base64 读回后
 * 以 Blob 触发下载。任何一步失败返回 { ok: false, error }（中文）。
 */
export async function exportDocx(): Promise<ExportDocxResult> {
  const t = pick(useSettingsStore.getState().language);
  if (getPlatform().kind !== 'tauri') {
    return { ok: false, error: t.browserUnsupported };
  }
  const ws = useWorkspaceStore.getState();
  const entry = resolveCompileEntry();
  if (!entry) {
    return { ok: false, error: t.noEntry };
  }

  const ensure = await ensureBuiltinPandoc();
  if (!isBuiltinPandocInfo(ensure)) {
    return { ok: false, error: t.ensureFailed(ensure.error) };
  }

  // 物化项目文本文件（与真实编译同一工作目录：数据目录根；二进制条目自动跳过）
  try {
    await materializeProjectFiles(ws.files, (p, c) => getPlatform().fs.writeFile(p, c));
  } catch (e) {
    return { ok: false, error: t.materializeFailed(errText(e)) };
  }

  const out = docxTargetFor(entry);
  let run: { code: number; stdout: string; stderr: string };
  try {
    run = await tauriProcRun(ensure.path, buildPandocArgs(entry, out), '');
  } catch (e) {
    return { ok: false, error: t.pandocFailed(-1, errText(e)) };
  }
  if (run.code !== 0) {
    const detail = `${run.stderr || run.stdout}`.trim().slice(0, 400);
    return { ok: false, error: t.pandocFailed(run.code, detail) };
  }

  let bytes: Uint8Array;
  try {
    bytes = await tauriReadBase64(out);
  } catch (e) {
    return { ok: false, error: t.readBackFailed(errText(e)) };
  }
  triggerDocxDownload(docxDownloadName(ws.projectName, entry), bytes);
  return { ok: true, entry, docxPath: out, bytes: bytes.length };
}
