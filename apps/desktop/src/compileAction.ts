/**
 * 编译动作：Tauri 形态按探测链使用真实引擎——系统 tectonic → 系统 latexmk →
 * 内置 tectonic（数据目录；不存在则经 texSetup 自动下载，用户只需点一次编译）——
 * 全链不可用或流程任一步失败时自动回退 MockEngine；浏览器形态直接 MockEngine。
 * 真实编译前先把项目文本文件物化到数据目录（引擎 cwd），成功后经 fs_read_base64 读回
 * PDF 产物并自动打开应用内预览（同时缓存为 lastPdf，预览关闭后可经 reopenLastPdf 重看，D14），
 * 随后回读 .synctex.gz 注册 SyncTeX 索引
 * （PDF ↔ 源码双向跳转，synctexBridge 消费；模拟/浏览器路径一律置 null 停用同步）；
 * 存在 error 级诊断时自动跳转到首个出错行。
 * 命令面板与 agent 工具 tex.compile 共用。
 */

import { LatexmkEngine, MockEngine, TectonicEngine, diagnosticHint, parseSynctex, runFullCompile } from '@lemma/compile';
import type { Diagnostic, ProjectFileMap } from '@lemma/shared';
import { useWorkspaceStore } from './state/workspaceStore';
import { useUiStore } from './state/uiStore';
import { useSettingsStore, type Language } from './state/settingsStore';
import { getPlatform } from './platform/types';
import { tauriProcRun, tauriReadBase64 } from './platform/tauri';
import { ensureBuiltinTectonic, getReadyBuiltinTectonicPath, isBuiltinTectonicInfo } from './texSetup';
import { jumpTo, lastCursor } from './editorJump';
import { setSynctexIndex, jumpSourceToPdf } from './synctexBridge';
import { setCompileDiagnosticsList, lintLatex } from '@lemma/editor';
import { ENGINE_PROBE_COMMANDS, selectEngine, engineArgs, ENGINE_INFO, type EngineKind } from './engineMatrix';
import { formatErrorHint } from '@lemma/compile';

const idleRunner = {
  async run(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: '', stderr: '' };
  },
};

const tauriRunner = {
  async run(
    cmd: string,
    args: string[],
    opts: { cwd: string; stdin?: string },
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return tauriProcRun(cmd, args, opts.cwd);
  },
};

/** proc_run 便捷 runner 的结构类型（与 compile 包的 CommandRunner 兼容） */
export interface ProcRunner {
  run(
    cmd: string,
    args: string[],
    opts: { cwd: string; stdin?: string },
  ): Promise<{ code: number; stdout: string; stderr: string }>;
}

/**
 * 把 runner 的 'tectonic' 命令重映射到内置引擎的绝对路径（proc_run 支持任意 cmd 字符串，
 * 直接传完整路径即可）；其余命令（latexmk/bibtex）原样。tectonicPath 为空时返回原 runner。
 * TectonicEngine 内部写死 runner.run('tectonic', …)，故在 runner 层做替换，不改 compile 包。
 */
export function withBuiltinTectonic(base: ProcRunner, tectonicPath: string | null): ProcRunner {
  if (!tectonicPath) return base;
  return {
    run: (cmd: string, args: string[], opts: { cwd: string; stdin?: string }) =>
      base.run(cmd === 'tectonic' ? tectonicPath : cmd, args, opts),
  };
}

export interface CompileActionResult {
  ok: boolean;
  entry: string;
  passes: number;
  diagnostics: number;
}

// ---------------------------------------------------------------------------
// 双语文案（D15）：zh 保持原文，en 为准确翻译。
// 调用处经 pick(useSettingsStore.getState().language) 在「发日志那一刻」动态读取语言，
// 避免模块加载或长生命周期闭包造成的语言过期。
// ---------------------------------------------------------------------------

interface CompileDict {
  noEntry: string;
  builtinDownloading: string;
  builtinReady: (cached: boolean) => string;
  builtinFirstRun: string;
  builtinFail: (err: string) => string;
  mockStart: (entry: string) => string;
  realStart: (engine: string, entry: string, count: number) => string;
  summary: (engine: string, passes: number, durationMs: number, ok: boolean) => string;
  fixHint: (hint: string) => string;
  materializeFail: (err: string) => string;
  engineFail: (engine: string, err: string) => string;
  pdfOpened: (pdfPath: string, bytes: number) => string;
  pdfMissing: (pdfPath: string, err: string) => string;
  synctexOk: (synctexPath: string, bytes: number) => string;
  synctexFail: (synctexPath: string, err: string) => string;
  autoCompileStart(): string;
  autoCompileStart(): string;
}

export const L: Record<Language, CompileDict> = {
  zh: {
    noEntry: '✗ 未找到可编译的 .tex 入口文件',
    builtinDownloading: '⟳ 未检测到 TeX 引擎，正在自动下载内置 Tectonic…',
    builtinReady: (cached) =>
      cached
        ? '✓ 内置 Tectonic 已就绪（缓存于应用数据目录）'
        : '✓ 内置 Tectonic 下载完成，已就绪（缓存于应用数据目录）',
    builtinFirstRun: 'ℹ 首次编译将联网获取宏包，稍慢属正常',
    builtinFail: (err) =>
      `⚠ 内置 Tectonic 自动下载失败（${err}），回退模拟引擎。可检查网络/代理，或手动安装 Tectonic / TeX Live。`,
    mockStart: (entry) => `▶ 开始编译 ${entry}（模拟引擎）`,
    realStart: (engine, entry, count) => `▶ ${engine} 真实编译 ${entry}（已物化 ${count} 个项目文件到本地工作目录）`,
    summary: (engine, passes, durationMs, ok) => `▣ ${engine} · ${passes} 趟 · ${durationMs}ms · ${ok ? '成功' : '失败'}`,
    fixHint: (hint) => `    ↳ 修复提示：${hint}`,
    materializeFail: (err) => `⚠ 项目文件物化失败（${err}），回退模拟引擎。`,
    engineFail: (engine, err) => `⚠ ${engine} 执行失败（${err}），回退模拟引擎。`,
    pdfOpened: (pdfPath, bytes) => `🖨 产物 ${pdfPath} 已读回（${bytes} 字节），PDF 预览已打开`,
    pdfMissing: (pdfPath, err) => `⚠ 编译成功但未找到产物 PDF：${pdfPath} 读取失败（${err}）。请检查引擎输出目录设置。`,
    synctexOk: (synctexPath, bytes) => `🔗 SyncTeX 索引已注册（${synctexPath}，${bytes} 字节），PDF ↔ 源码同步可用`,
    synctexFail: (synctexPath, err) => `⚠ SyncTeX 索引不可用（${synctexPath} 读取失败：${err}），PDF ↔ 源码同步已停用。`,
    autoCompileStart: () => '⟳ 自动编译（保存后触发，可在状态栏关闭）…',
  },
  en: {
    noEntry: '✗ No compilable .tex entry file found',
    builtinDownloading: '⟳ No TeX engine detected; automatically downloading the bundled Tectonic…',
    builtinReady: (cached) =>
      cached
        ? '✓ Bundled Tectonic is ready (cached in the app data directory)'
        : '✓ Bundled Tectonic downloaded and ready (cached in the app data directory)',
    builtinFirstRun: 'ℹ The first compile fetches TeX packages online and may be slower',
    builtinFail: (err) =>
      `⚠ Failed to download the bundled Tectonic (${err}); falling back to the mock engine. Check your network/proxy, or install Tectonic / TeX Live manually.`,
    mockStart: (entry) => `▶ Compiling ${entry} (mock engine)`,
    realStart: (engine, entry, count) => `▶ ${engine} real compile of ${entry} (${count} project files materialized into the local working directory)`,
    summary: (engine, passes, durationMs, ok) => `▣ ${engine} · ${passes} pass(es) · ${durationMs}ms · ${ok ? 'succeeded' : 'failed'}`,
    fixHint: (hint) => `    ↳ Fix hint: ${hint}`,
    materializeFail: (err) => `⚠ Failed to materialize project files (${err}); falling back to the mock engine.`,
    engineFail: (engine, err) => `⚠ ${engine} failed (${err}); falling back to the mock engine.`,
    pdfOpened: (pdfPath, bytes) => `🖨 Artifact ${pdfPath} read back (${bytes} bytes); PDF preview opened`,
    pdfMissing: (pdfPath, err) => `⚠ Compiled successfully but the PDF artifact was not found: reading ${pdfPath} failed (${err}). Check the engine output directory settings.`,
    synctexOk: (synctexPath, bytes) => `🔗 SyncTeX index registered (${synctexPath}, ${bytes} bytes); PDF ↔ source sync enabled`,
    synctexFail: (synctexPath, err) => `⚠ SyncTeX index unavailable (failed to read ${synctexPath}: ${err}); PDF ↔ source sync disabled.`,
    autoCompileStart: () => '⟳ Auto compile (after save; toggle in status bar)…',
  },
};

/** 按语言取文案（语言由调用处在发日志时动态读取） */
export function pick(lang: Language): CompileDict {
  return L[lang];
}

// ---------------------------------------------------------------------------
// 最近编译产物缓存（D14）：真实编译读回的 PDF 在预览关闭后可重看
// ---------------------------------------------------------------------------

let lastPdf: { name: string; data: ArrayBuffer } | null = null;

/**
 * 重看最近一次真实编译的 PDF 产物：有缓存则重开应用内 PDF 预览
 * （setPdfView 会同时把中央视图切回 pdf）并返回 true；从未读回过产物返回 false。
 * 导出签名（供集成者在 commands.ts 注册命令）：reopenLastPdf(): boolean
 */
export function reopenLastPdf(): boolean {
  if (!lastPdf) return false;
  useUiStore.getState().setPdfView(lastPdf);
  return true;
}

// ---------------------------------------------------------------------------
// 引擎探测与选择（纯函数，探测结果注入，不依赖真实进程）
// ---------------------------------------------------------------------------

/** 一次 --version 探测的结果：ok = 退出码为 0；text = stdout+stderr（或启动失败的报错） */
export interface ExecOutcome {
  ok: boolean;
  text: string;
}

/**
 * 依据探测结果选择真实引擎：系统 tectonic 可用优先（自包含、无外部 TeX 依赖），
 * 其次系统 latexmk；两者 --version 均非 0 退出（或命令不存在）时，
 * 若注入了内置 tectonic 路径（数据目录已就绪/自动下载成功）则选内置，否则返回 null（回退模拟引擎）。
 * builtinTectonicPath 为新增探测注入点：非空字符串即视为可用（Rust 侧落盘前已校验过）。
 */
export type RealEngineKind = EngineKind;

export function detectEngine(probes: {
  tectonic: ExecOutcome;
  latexmk: ExecOutcome;
  builtinTectonicPath?: string | null;
}): RealEngineKind | null {
  if (probes.tectonic.ok) return 'tectonic';
  if (probes.latexmk.ok) return 'latexmk';
  if (probes.builtinTectonicPath) return 'builtin-tectonic';
  return null;
}

/** 日志里展示的引擎名：内置引擎标注（内置）以便与系统安装区分 */
export function engineLabel(kind: RealEngineKind): string {
  if (kind === 'builtin-tectonic') return 'tectonic（内置）';
  return kind;
}

/** proc_run 成功返回 → 探测结果（退出码 0 即可用） */
export function probeFromRun(r: { code: number; stdout: string; stderr: string }): ExecOutcome {
  return { ok: r.code === 0, text: `${r.stdout}\n${r.stderr}`.trim() };
}

/** proc_run 抛错（命令不存在/无法启动）→ 不可用的探测结果 */
export function probeFromError(e: unknown): ExecOutcome {
  return { ok: false, text: e instanceof Error ? e.message : String(e) };
}

/** 对某命令做 --version 探测（cwd 用数据目录根） */
async function probeEngine(cmd: string): Promise<ExecOutcome> {
  try {
    return probeFromRun(await tauriProcRun(cmd, ['--version'], ''));
  } catch (e) {
    return probeFromError(e);
  }
}

// ---------------------------------------------------------------------------
// 编译流程编排的纯逻辑部件（可单测）
// ---------------------------------------------------------------------------

/** 由入口推算产物 PDF 相对路径：main.tex -> main.pdf（与 tectonic/latexmk 落盘约定一致） */
export function pdfTargetFor(entry: string): string {
  return `${entry.replace(/\.tex$/i, '')}.pdf`;
}

/** 由入口推算 SyncTeX 索引相对路径：main.tex -> main.synctex.gz（与 pdfTargetFor 同一约定） */
export function synctexTargetFor(entry: string): string {
  return `${entry.replace(/\.tex$/i, '')}.synctex.gz`;
}

/** 把项目文本文件物化到真实引擎的工作目录（Tauri 数据目录）；返回写入的文件数 */
export async function materializeProjectFiles(
  files: ProjectFileMap,
  writeFile: (path: string, content: string) => Promise<void>,
): Promise<number> {
  let count = 0;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue; // 二进制文件不参与文本物化
    await writeFile(path, content);
    count++;
  }
  return count;
}

/** 第一条 error 级且带 file+line 的诊断 → 编辑器跳转目标；没有则返回 null（不打扰） */
export function firstErrorJump(diagnostics: Diagnostic[]): { file: string; line: number } | null {
  const d = diagnostics.find(
    (x) => x.severity === 'error' && typeof x.file === 'string' && x.file !== '' && typeof x.line === 'number',
  );
  return d ? { file: d.file as string, line: d.line as number } : null;
}

/** 全项目 lint → 编译诊断形态（warning 级；模拟引擎的诚实替身） */
function lintProjectDiagnostics(files: Record<string, string>, entry: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.toLowerCase().endsWith('.tex')) continue;
    for (const issue of lintLatex(content)) {
      out.push({
        severity: issue.severity === 'error' ? 'error' : 'warning',
        message: issue.message,
        file: path === entry ? path : path,
        line: issue.line,
      });
    }
    if (out.length >= 50) break; // 上限防巨型工程刷屏
  }
  return out;
}

/** 编译诊断三路分发：日志（既有）+ workspaceStore（状态）+ 编辑器注册表（gutter/行高亮） */
function publishDiagnostics(diags: Diagnostic[]): void {
  useWorkspaceStore.getState().setCompileDiagnostics(diags);
  setCompileDiagnosticsList(diags);
}

/** 编译成功后的 PDF 跟随（D3）：预览开着且 SyncTeX 可用时，跳到光标所在页 */
function followCursorInPdf(): void {
  try {
    const ui = useUiStore.getState();
    if (!ui.pdfView) return;
    const cur = lastCursor();
    const file = cur.file || useWorkspaceStore.getState().activeTab || '';
    if (!file) return;
    jumpSourceToPdf(file, cur.line);
  } catch {
    /* 跟随失败不打扰编译结果 */
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

/** 解析当前项目的编译入口（main.tex 优先，其次 store 记录的 entry） */
export function resolveCompileEntry(): string | null {
  const s = useWorkspaceStore.getState();
  if (s.files['main.tex'] !== undefined) return 'main.tex';
  return s.entry in s.files ? s.entry : null;
}

function logDiagnostics(entry: string, diagnostics: Diagnostic[]): void {
  const s = useWorkspaceStore.getState();
  const t = pick(useSettingsStore.getState().language);
  for (const d of diagnostics) {
    const loc = `${d.file ?? entry}${d.line ? `:${d.line}` : ''}`;
    s.appendCompileLog(`  [${d.severity}] ${loc} ${d.message}`);
    const hint = diagnosticHint(d);
    if (hint) s.appendCompileLog(t.fixHint(hint));
    // v2.7.0：错误级诊断追加中文友好提示
    if (d.severity === 'error') {
      const friendly = formatErrorHint(d.message);
      if (friendly) s.appendCompileLog(`    ${friendly}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 模拟引擎（浏览器形态与回退路径）
// ---------------------------------------------------------------------------

export async function runMockCompile(): Promise<CompileActionResult> {
  const s = useWorkspaceStore.getState();
  const t = pick(useSettingsStore.getState().language);
  const entry = resolveCompileEntry();
  if (!entry) {
    s.appendCompileLog(t.noEntry);
    s.setCompileStatus('fail');
    setSynctexIndex(null); // 模拟路径统一停用 PDF ↔ 源码同步
    return { ok: false, entry: '', passes: 0, diagnostics: 0 };
  }
  s.setCompileStatus('running');
  s.appendCompileLog(t.mockStart(entry));
  const result = await runFullCompile(
    { files: s.files, entry },
    new MockEngine({ latencyMs: 400 }),
    idleRunner,
  );
  s.appendCompileLog(t.summary(result.engine, result.passes, result.durationMs, result.success));
  // 模拟引擎不产出真实诊断：以 lint 结果充当（warning 级，诚实反映源码静态问题），
  // 编辑器标注闭环在浏览器形态同样可演示
  const diags: Diagnostic[] =
    result.diagnostics.length > 0
      ? result.diagnostics
      : lintProjectDiagnostics(s.files, entry);
  logDiagnostics(entry, diags);
  publishDiagnostics(diags);
  setSynctexIndex(null); // 模拟引擎无真实产物：清除旧索引，停用 PDF ↔ 源码同步
  s.setCompileStatus(result.success ? 'ok' : 'fail');
  const jump = firstErrorJump(result.diagnostics);
  if (jump) jumpTo(jump);
  return {
    ok: result.success,
    entry,
    passes: result.passes,
    diagnostics: result.diagnostics.length,
  };
}

// ---------------------------------------------------------------------------
// Tauri 真实编译全流程
// ---------------------------------------------------------------------------

/**
 * Tauri 真实编译：探测链（系统 tectonic → 系统 latexmk → 内置 tectonic，必要时自动下载）
 * → 物化项目文件到数据目录 → 编译 → 读回 PDF 打开预览。
 * 返回 null 表示应回退模拟引擎（全链不可用（含下载失败）/ 物化或编译执行失败）；
 * 编译本身的失败（有诊断）是真实结果，不回退。
 */
async function runRealCompile(entry: string, opts?: { auto?: boolean }): Promise<CompileActionResult | null> {
  const s = useWorkspaceStore.getState();
  const t = pick(useSettingsStore.getState().language);
  s.setCompileStatus('running');

  // 前两级系统探测；内置引擎已就绪（本会话早前下载过）时作为第三级注入
  // 全矩阵探测（v2.0.0）：tectonic/lualatex/xelatex/pdflatex/latexmk + 内置
  const probes: Partial<Record<EngineKind, { ok: boolean }>> = {};
  for (const { kind, cmd } of ENGINE_PROBE_COMMANDS) {
    const r = await probeEngine(cmd);
    probes[kind] = { ok: r.ok };
  }
  const pref = useSettingsStore.getState().enginePreference ?? 'auto';
  let sel = selectEngine(probes, pref, !!getReadyBuiltinTectonicPath());
  let engineKind: EngineKind | null = sel?.kind ?? null;
  if (sel?.fellBack) {
    s.appendCompileLog(`⚠ 偏好引擎 ${pref} 不可用，回落 ${ENGINE_INFO[sel.kind].label}`);
  }
  let builtinPath = engineKind === 'builtin-tectonic' ? getReadyBuiltinTectonicPath() : null;
  if (!engineKind) {
    // 全链兜底：触发内置 Tectonic 自动下载（数据目录已有则 Rust 侧直接返回 cached）。
    // 用户只需点一次编译，全自动；下载失败日志中文说明后回退模拟引擎。
    s.appendCompileLog(t.builtinDownloading);
    const info = await ensureBuiltinTectonic();
    if (!isBuiltinTectonicInfo(info)) {
      s.appendCompileLog(t.builtinFail(info.error));
      return null;
    }
    builtinPath = info.path;
    engineKind = 'builtin-tectonic';
    s.appendCompileLog(t.builtinReady(info.cached));
    if (info.firstRunNote) s.appendCompileLog(t.builtinFirstRun);
  }
  const label = engineLabel(engineKind);

  // 物化项目文本文件到引擎工作目录（proc_run 的 cwd='' 即数据目录根）
  try {
    const fs = getPlatform().fs;
    const count = await materializeProjectFiles(s.files, (p, c) => fs.writeFile(p, c));
    s.appendCompileLog(t.realStart(label, entry, count));
  } catch (e) {
    s.appendCompileLog(t.materializeFail(errText(e)));
    return null;
  }

  let result;
  try {
    result = await runFullCompile(
      { files: s.files, entry, cwd: '' },
      engineKind === 'latexmk' ? new LatexmkEngine() : new TectonicEngine(),
      withBuiltinTectonic(tauriRunner, builtinPath),
    );
  } catch (e) {
    s.appendCompileLog(t.engineFail(label, errText(e)));
    return null;
  }

  s.appendCompileLog(t.summary(label, result.passes, result.durationMs, result.success));
  logDiagnostics(entry, result.diagnostics);
  publishDiagnostics(result.diagnostics);

  // 读回 PDF 产物并打开应用内预览（产物缺失只记录日志，不影响编译结果）；
  // 读回成功即存入 lastPdf 缓存（D14：预览关闭后 reopenLastPdf 可重看）
  if (result.success) {
    const pdfPath = pdfTargetFor(entry);
    try {
      const bytes = await tauriReadBase64(pdfPath);
      lastPdf = { name: pdfPath, data: toArrayBuffer(bytes) };
      const ui = useUiStore.getState();
      if (!ui.pdfView) {
        ui.setPdfView(lastPdf);
      } else {
        // 已开预览：仅更新数据（不切视图，不闪屏）
        useUiStore.setState({ pdfView: lastPdf });
      }
      s.appendCompileLog(t.pdfOpened(pdfPath, bytes.length));
    } catch (e) {
      s.appendCompileLog(t.pdfMissing(pdfPath, errText(e)));
    }

    // 回读 SyncTeX 索引并注册（PDF ↔ 源码双向跳转）；失败只记日志并停用同步，不影响编译结果
    const synctexPath = synctexTargetFor(entry);
    try {
      const bytes = await tauriReadBase64(synctexPath);
      setSynctexIndex(parseSynctex(bytes));
      s.appendCompileLog(t.synctexOk(synctexPath, bytes.length));
      followCursorInPdf();
    } catch (e) {
      setSynctexIndex(null);
      s.appendCompileLog(t.synctexFail(synctexPath, errText(e)));
    }
  } else {
    setSynctexIndex(null); // 编译失败：旧索引与最新源码不再一致，停用同步
  }

  // 存在 error 级诊断时跳转到首个出错行（无 error 不打扰）；
  // 自动编译不跳（打断输入位置），靠沟槽标注与日志引导
  if (!opts?.auto) {
    const jump = firstErrorJump(result.diagnostics);
    if (jump) jumpTo(jump);
  }

  s.setCompileStatus(result.success ? 'ok' : 'fail');
  return { ok: result.success, entry, passes: result.passes, diagnostics: result.diagnostics.length };
}

/** 统一入口：Tauri 环境按探测链使用真实引擎（系统 tectonic → 系统 latexmk → 内置 tectonic，
 *  内置不存在时自动下载，下载失败回退模拟引擎）；浏览器直接模拟。 */
/**
 * 统一编译入口。opts.auto = 自动编译（保存触发）：抑制「跳到首个错误行」
 * （自动跳转会打断正在输入的光标位置），诊断仍照常进编辑器标注。
 */
export async function runCompile(opts?: { auto?: boolean }): Promise<CompileActionResult> {
  if (getPlatform().kind === 'tauri') {
    const entry = resolveCompileEntry();
    if (entry) {
      const real = await runRealCompile(entry, opts);
      if (real) return real;
    }
  }
  return runMockCompile();
}

// ---------------------------------------------------------------------------
// 保存后自动编译（v1.5.1 D2）：files 变化（真实编辑置 dirty）→ 防抖触发
// ---------------------------------------------------------------------------

/** 编辑静默期：停笔 1.5s 后编译一次（合并连续击键） */
const AUTOCOMPILE_DEBOUNCE_MS = 1500;
/** 实时预览防抖 */
const LIVE_PREVIEW_DEBOUNCE_MS = 500;

let autoCompileTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 挂接自动编译（App 挂载时调用一次，返回卸载函数）。
 * 触发条件（全部满足）：
 *  - 设置 autoCompile 开启；
 *  - 桌面形态（真实引擎；浏览器模拟编译无意义，不触发）；
 *  - files 内容真实变化（dirty 由 updateFile 置位；加载项目/恢复不置位）；
 *  - 当前无编译进行中（idle）且存在可解析入口；
 * 自动编译为「静默」变体：不出错跳转（不打断输入位置），诊断照常进编辑器标注。
 */
export function attachAutoCompile(
  compile: (opts?: { auto?: boolean }) => Promise<unknown> = runCompile,
): () => void {
  // 挂接即快照基线：之后任何 files 变化都视为编辑增量（加载项目不置 dirty，双保险）
  // 优化：引用比较替代 JSON.stringify——每次击键 stringify 全部文件是大项目的性能瓶颈
  // （zustand set 创建新 files 对象 → 引用变化即可检测；值相同的不同引用只在极少场景
  //  出现且最多多触发一次防抖编译，无正确性影响）
  let lastFilesRef: unknown = useWorkspaceStore.getState().files;
  let lastFilesLen = Object.keys(lastFilesRef as Record<string, string>).length;
  const unsub = useWorkspaceStore.subscribe((s) => {
    const filesChanged = s.files !== lastFilesRef || Object.keys(s.files).length !== lastFilesLen;
    if (!filesChanged) return; // 与文件无关的状态变更（dirty/日志等）
    lastFilesRef = s.files;
    lastFilesLen = Object.keys(s.files).length;
    if (!s.dirty) return; // 非编辑产生的文件替换（加载项目不置 dirty）

    if (autoCompileTimer) clearTimeout(autoCompileTimer);
    autoCompileTimer = setTimeout(() => {
      autoCompileTimer = null;
      const st = useWorkspaceStore.getState();
      const cfg = useSettingsStore.getState();
      if (!cfg.autoCompile) return;
      if (st.compileStatus === 'running') return; // 下次编辑会再触发
      if (getPlatform().kind !== 'tauri') return;
      if (!resolveCompileEntry()) return;
      st.appendCompileLog(pick(cfg.language).autoCompileStart());
      void compile({ auto: true });
    }, useSettingsStore.getState().livePreview ? LIVE_PREVIEW_DEBOUNCE_MS : AUTOCOMPILE_DEBOUNCE_MS);
  });
  return () => {
    unsub();
    if (autoCompileTimer) clearTimeout(autoCompileTimer);
    autoCompileTimer = null;
  };
}
