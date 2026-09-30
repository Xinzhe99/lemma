/**
 * 编译动作：Tauri 形态优先探测并使用真实引擎（tectonic → latexmk，经 proc_run 桥），
 * 都不可用或流程任一步失败时自动回退 MockEngine；浏览器形态直接 MockEngine。
 * 真实编译前先把项目文本文件物化到数据目录（引擎 cwd），成功后经 fs_read_base64 读回
 * PDF 产物并自动打开应用内预览；存在 error 级诊断时自动跳转到首个出错行。
 * 命令面板与 agent 工具 tex.compile 共用。
 */

import { LatexmkEngine, MockEngine, TectonicEngine, diagnosticHint, runFullCompile } from '@scholarforge/compile';
import type { Diagnostic, ProjectFileMap } from '@scholarforge/shared';
import { useWorkspaceStore } from './state/workspaceStore';
import { useUiStore } from './state/uiStore';
import { getPlatform } from './platform/types';
import { tauriProcRun, tauriReadBase64 } from './platform/tauri';
import { jumpTo } from './editorJump';

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

export interface CompileActionResult {
  ok: boolean;
  entry: string;
  passes: number;
  diagnostics: number;
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
 * 依据探测结果选择真实引擎：tectonic 可用优先（自包含、无外部 TeX 依赖），
 * 其次 latexmk；两者 --version 均非 0 退出（或命令不存在）返回 null（回退模拟引擎）。
 */
export function detectEngine(probes: { tectonic: ExecOutcome; latexmk: ExecOutcome }): 'tectonic' | 'latexmk' | null {
  if (probes.tectonic.ok) return 'tectonic';
  if (probes.latexmk.ok) return 'latexmk';
  return null;
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
  for (const d of diagnostics) {
    const loc = `${d.file ?? entry}${d.line ? `:${d.line}` : ''}`;
    s.appendCompileLog(`  [${d.severity}] ${loc} ${d.message}`);
    const hint = diagnosticHint(d);
    if (hint) s.appendCompileLog(`    ↳ 修复提示：${hint}`);
  }
}

// ---------------------------------------------------------------------------
// 模拟引擎（浏览器形态与回退路径）
// ---------------------------------------------------------------------------

export async function runMockCompile(): Promise<CompileActionResult> {
  const s = useWorkspaceStore.getState();
  const entry = resolveCompileEntry();
  if (!entry) {
    s.appendCompileLog('✗ 未找到可编译的 .tex 入口文件');
    s.setCompileStatus('fail');
    return { ok: false, entry: '', passes: 0, diagnostics: 0 };
  }
  s.setCompileStatus('running');
  s.appendCompileLog(`▶ 开始编译 ${entry}（模拟引擎）`);
  const result = await runFullCompile(
    { files: s.files, entry },
    new MockEngine({ latencyMs: 400 }),
    idleRunner,
  );
  s.appendCompileLog(
    `▣ ${result.engine} · ${result.passes} 趟 · ${result.durationMs}ms · ${result.success ? '成功' : '失败'}`,
  );
  logDiagnostics(entry, result.diagnostics);
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
 * Tauri 真实编译：探测 tectonic/latexmk → 物化项目文件到数据目录 → 编译 → 读回 PDF 打开预览。
 * 返回 null 表示应回退模拟引擎（引擎未检测到 / 物化或编译执行失败）；
 * 编译本身的失败（有诊断）是真实结果，不回退。
 */
async function runRealCompile(entry: string): Promise<CompileActionResult | null> {
  const s = useWorkspaceStore.getState();
  s.setCompileStatus('running');

  const engineKind = detectEngine({
    tectonic: await probeEngine('tectonic'),
    latexmk: await probeEngine('latexmk'),
  });
  if (!engineKind) {
    s.appendCompileLog('⚠ 未检测到 Tectonic/latexmk，回退模拟引擎。安装 TeX Live（含 latexmk）或 Tectonic 后可获得真实编译。');
    return null;
  }

  // 物化项目文本文件到引擎工作目录（proc_run 的 cwd='' 即数据目录根）
  try {
    const fs = getPlatform().fs;
    const count = await materializeProjectFiles(s.files, (p, c) => fs.writeFile(p, c));
    s.appendCompileLog(`▶ ${engineKind} 真实编译 ${entry}（已物化 ${count} 个项目文件到本地工作目录）`);
  } catch (e) {
    s.appendCompileLog(`⚠ 项目文件物化失败（${errText(e)}），回退模拟引擎。`);
    return null;
  }

  let result;
  try {
    result = await runFullCompile(
      { files: s.files, entry, cwd: '' },
      engineKind === 'tectonic' ? new TectonicEngine() : new LatexmkEngine(),
      tauriRunner,
    );
  } catch (e) {
    s.appendCompileLog(`⚠ ${engineKind} 执行失败（${errText(e)}），回退模拟引擎。`);
    return null;
  }

  s.appendCompileLog(
    `▣ ${engineKind} · ${result.passes} 趟 · ${result.durationMs}ms · ${result.success ? '成功' : '失败'}`,
  );
  logDiagnostics(entry, result.diagnostics);

  // 读回 PDF 产物并打开应用内预览（产物缺失只记录日志，不影响编译结果）
  if (result.success) {
    const pdfPath = pdfTargetFor(entry);
    try {
      const bytes = await tauriReadBase64(pdfPath);
      useUiStore.getState().setPdfView({ name: pdfPath, data: toArrayBuffer(bytes) });
      s.appendCompileLog(`🖨 产物 ${pdfPath} 已读回（${bytes.length} 字节），PDF 预览已打开`);
    } catch (e) {
      s.appendCompileLog(`⚠ 编译成功但未找到产物 PDF：${pdfPath} 读取失败（${errText(e)}）。请检查引擎输出目录设置。`);
    }
  }

  // 存在 error 级诊断时跳转到首个出错行（无 error 不打扰）
  const jump = firstErrorJump(result.diagnostics);
  if (jump) jumpTo(jump);

  s.setCompileStatus(result.success ? 'ok' : 'fail');
  return { ok: result.success, entry, passes: result.passes, diagnostics: result.diagnostics.length };
}

/** 统一入口：Tauri 环境先探测真实引擎（tectonic → latexmk），不可用回退模拟引擎；浏览器直接模拟。 */
export async function runCompile(): Promise<CompileActionResult> {
  if (getPlatform().kind === 'tauri') {
    const entry = resolveCompileEntry();
    if (entry) {
      const real = await runRealCompile(entry);
      if (real) return real;
    }
  }
  return runMockCompile();
}
