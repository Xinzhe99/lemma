import { describe, expect, it } from 'vitest';
import type { CommandRunner, CompileInput } from './engine';
import { MockEngine } from './engine';
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
