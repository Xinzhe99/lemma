/**
 * 编译动作（浏览器形态）：MockEngine 多趟编排，日志与状态写入 workspaceStore。
 * 命令面板与 agent 工具 tex.compile 共用。
 */

import { MockEngine, diagnosticHint, runFullCompile } from '@scholarforge/compile';
import { useWorkspaceStore } from './state/workspaceStore';

const idleRunner = {
  async run(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: '', stderr: '' };
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
  s.appendCompileLog(`▶ 开始编译 ${entry}（浏览器形态：MockEngine 模拟；本地 Tectonic 待 Tauri 桥接）`);
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
