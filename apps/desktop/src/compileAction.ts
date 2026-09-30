/**
 * 编译动作：Tauri 形态优先走真实 Tectonic（经 proc_run 桥），失败自动回退 MockEngine；
 * 浏览器形态直接 MockEngine。日志与状态写入 workspaceStore。
 * 命令面板与 agent 工具 tex.compile 共用。
 */

import { MockEngine, TectonicEngine, diagnosticHint, runFullCompile } from '@scholarforge/compile';
import { useWorkspaceStore } from './state/workspaceStore';
import { getPlatform } from './platform/types';
import { tauriProcRun } from './platform/tauri';

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

/** 解析当前项目的编译入口（main.tex 优先，其次 store 记录的 entry） */
export function resolveCompileEntry(): string | null {
  const s = useWorkspaceStore.getState();
  if (s.files['main.tex'] !== undefined) return 'main.tex';
  return s.entry in s.files ? s.entry : null;
}

export async function runMockCompile(): Promise<CompileActionResult> {
  const s = useWorkspaceStore.getState();
  const entry = resolveCompileEntry();
  if (!entry) {
    s.appendCompileLog('✗ 未找到可编译的 .tex 入口文件');
    s.setCompileStatus('fail');
    return { ok: false, entry: '', passes: 0, diagnostics: 0 };
  }
  s.setCompileStatus('running');
  s.appendCompileLog(`▶ 开始编译 ${entry}（模拟引擎；桌面 Tauri 形态自动使用本地 Tectonic）`);
  const result = await runFullCompile(
    { files: s.files, entry },
    new MockEngine({ latencyMs: 400 }),
    idleRunner,
  );
  s.appendCompileLog(
    `▣ ${result.engine} · ${result.passes} 趟 · ${result.durationMs}ms · ${result.success ? '成功' : '失败'}`,
  );
  for (const d of result.diagnostics) {
    const loc = `${d.file ?? entry}${d.line ? `:${d.line}` : ''}`;
    s.appendCompileLog(`  [${d.severity}] ${loc} ${d.message}`);
    const hint = diagnosticHint(d);
    if (hint) s.appendCompileLog(`    ↳ 修复提示：${hint}`);
  }
  s.setCompileStatus(result.success ? 'ok' : 'fail');
  return {
    ok: result.success,
    entry,
    passes: result.passes,
    diagnostics: result.diagnostics.length,
  };
}

/** 统一入口：Tauri 环境先尝试真实 Tectonic，失败回退模拟引擎。 */
export async function runCompile(): Promise<CompileActionResult> {
  if (getPlatform().kind === 'tauri') {
    const s = useWorkspaceStore.getState();
    const entry = resolveCompileEntry();
    if (entry) {
      try {
        s.setCompileStatus('running');
        s.appendCompileLog(`▶ Tectonic 真实编译 ${entry}（本地 TeX 环境）`);
        const result = await runFullCompile(
          { files: s.files, entry, cwd: '' },
          new TectonicEngine(),
          tauriRunner,
        );
        s.appendCompileLog(
          `▣ tectonic · ${result.passes} 趟 · ${result.durationMs}ms · ${result.success ? '成功' : '失败'}`,
        );
        for (const d of result.diagnostics) {
          const loc = `${d.file ?? entry}${d.line ? `:${d.line}` : ''}`;
          s.appendCompileLog(`  [${d.severity}] ${loc} ${d.message}`);
          const hint = diagnosticHint(d);
          if (hint) s.appendCompileLog(`    ↳ 修复提示：${hint}`);
        }
        s.setCompileStatus(result.success ? 'ok' : 'fail');
        return { ok: result.success, entry, passes: result.passes, diagnostics: result.diagnostics.length };
      } catch (e) {
        s.appendCompileLog(
          `⚠ 真实引擎不可用（${e instanceof Error ? e.message : String(e)}），回退模拟引擎。安装 Tectonic 后可获得真实编译。`,
        );
      }
    }
  }
  return runMockCompile();
}
