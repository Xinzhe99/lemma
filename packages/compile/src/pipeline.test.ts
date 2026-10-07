import { describe, expect, it } from 'vitest';
import type { CommandRunner, CompileInput } from './engine';
import { LatexmkEngine, MockEngine } from './engine';
import { runFullCompile } from './pipeline';

const RERUN_LOG = 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.';
const CITATION_LOG = "LaTeX Warning: Citation `knuth84' on page 1 undefined on input line 12.";

function makeRunner(result = { code: 0, stdout: '', stderr: '' }) {
  const calls: { cmd: string; args: string[] }[] = [];
  const runner: CommandRunner = {
    run: async (cmd, args) => {
      calls.push({ cmd, args });
      return { ...result };
    },
  };
  return { calls, runner };
}

const noBibInput: CompileInput = { files: { 'main.tex': '\\documentclass{article}' }, entry: 'main.tex' };
const bibInput: CompileInput = {
  files: { 'main.tex': '\\documentclass{article}', 'refs.bib': '@article{a, title={A}, year={2024}}' },
  entry: 'main.tex',
};

describe('runFullCompile', () => {
  it('无 .bib 且日志干净：单趟即收敛，成功并带合成 PDF', async () => {
    const engine = new MockEngine();
    const { calls, runner } = makeRunner();
    const res = await runFullCompile(noBibInput, engine, runner);
    expect(res.success).toBe(true);
    expect(res.passes).toBe(1);
    expect(res.engine).toBe('mock');
    expect(res.pdf).toBeDefined();
    expect(res.diagnostics).toEqual([]);
    expect(engine.compileCalls).toBe(1);
    expect(calls).toEqual([]);
  });

  it('"Rerun to get" 提示触发第二趟后收敛', async () => {
    const engine = new MockEngine({ logs: [RERUN_LOG, ''] });
    const res = await runFullCompile(noBibInput, engine, makeRunner().runner);
    expect(engine.compileCalls).toBe(2);
    expect(res.passes).toBe(2);
    expect(res.success).toBe(true);
  });

  it('undefined citation 同样触发重跑', async () => {
    const engine = new MockEngine({ logs: [CITATION_LOG, ''] });
    const res = await runFullCompile(noBibInput, engine, makeRunner().runner);
    expect(res.passes).toBe(2);
  });

  it('存在 .bib 时触发 bibtex，且至少两趟 latex', async () => {
    const engine = new MockEngine();
    const { calls, runner } = makeRunner();
    const res = await runFullCompile(bibInput, engine, runner);
    const bibtex = calls.find((c) => c.cmd === 'bibtex');
    expect(bibtex).toBeDefined();
    expect(bibtex?.args).toEqual(['main.aux']);
    expect(engine.compileCalls).toBe(2);
    expect(res.passes).toBe(2);
  });

  it('outDir 会反映到 bibtex 的 aux 路径', async () => {
    const engine = new MockEngine();
    const { calls, runner } = makeRunner();
    await runFullCompile({ ...bibInput, outDir: 'build' }, engine, runner);
    const bibtex = calls.find((c) => c.cmd === 'bibtex');
    expect(bibtex?.args).toEqual(['build/main.aux']);
  });

  it('无 .bib 时不运行 bibtex', async () => {
    const engine = new MockEngine();
    const { calls, runner } = makeRunner();
    await runFullCompile(noBibInput, engine, runner);
    expect(calls.filter((c) => c.cmd === 'bibtex')).toHaveLength(0);
  });

  it('日志始终提示重跑时最多 4 趟', async () => {
    const engine = new MockEngine({ logs: [RERUN_LOG] });
    const res = await runFullCompile(noBibInput, engine, makeRunner().runner);
    expect(res.passes).toBe(4);
  });

  it('失败时立即返回并透传诊断', async () => {
    const diagnostics = [{ severity: 'error' as const, message: 'Undefined control sequence.', line: 3 }];
    const engine = new MockEngine({ fail: true, diagnostics });
    const res = await runFullCompile(noBibInput, engine, makeRunner().runner);
    expect(res.success).toBe(false);
    expect(res.passes).toBe(1);
    expect(res.diagnostics).toEqual(diagnostics);
  });

  it('多趟诊断按内容去重合并', async () => {
    const diagnostics = [{ severity: 'warning' as const, message: 'Overfull \\hbox (5.0pt too wide) in paragraph at lines 8--9', line: 8 }];
    const engine = new MockEngine({ diagnostics, logs: [RERUN_LOG, ''] });
    const res = await runFullCompile(noBibInput, engine, makeRunner().runner);
    expect(res.passes).toBe(2);
    expect(res.diagnostics).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 真实日志驱动（诊断来自 log 解析而非引擎注入）：验证收敛后的陈旧警告清理
// ---------------------------------------------------------------------------

/** 依次返回给定日志的 runner（超出后重复最后一项） */
function logRunner(logs: string[]) {
  let i = 0;
  const runner: CommandRunner = {
    async run() {
      return { code: 0, stdout: logs[Math.min(i++, logs.length - 1)] ?? '', stderr: '' };
    },
  };
  return runner;
}

describe('runFullCompile：收敛后的陈旧重跑提示（v7.8.0）', () => {
  it('bibtex 前那趟的 Citation undefined 不再残留（最终日志已收敛）', async () => {
    const engine = new LatexmkEngine();
    const res = await runFullCompile(noBibInput, engine, logRunner([CITATION_LOG, '']));
    expect(res.passes).toBe(2);
    expect(res.success).toBe(true);
    expect(res.diagnostics).toEqual([]);
  });

  it('最终日志仍提示重跑时保留这些警告（不误删）', async () => {
    const engine = new LatexmkEngine();
    const res = await runFullCompile(noBibInput, engine, logRunner([CITATION_LOG]));
    expect(res.passes).toBe(4);
    expect(res.diagnostics).toHaveLength(1); // 去重后仅一条
    expect(res.diagnostics[0]!.message).toContain('knuth84');
  });

  it('非重跑类诊断（Overfull）不受过滤影响', async () => {
    const overfull = 'Overfull \\hbox (28.45pt too wide) in paragraph at lines 34--40';
    const engine = new LatexmkEngine();
    const res = await runFullCompile(noBibInput, engine, logRunner([`${overfull}\n${CITATION_LOG}`, overfull]));
    expect(res.passes).toBe(2);
    expect(res.diagnostics.map((d) => d.message)).toEqual([overfull]);
  });
});
