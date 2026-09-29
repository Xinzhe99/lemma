import { describe, expect, it } from 'vitest';
import type { CommandRunner, CompileInput } from './engine';
import { LatexmkEngine, MockEngine, TectonicEngine } from './engine';

function recordingRunner(result: { code: number; stdout: string; stderr: string }) {
  const calls: { cmd: string; args: string[]; cwd: string }[] = [];
  const runner: CommandRunner = {
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return { ...result };
    },
  };
  return { calls, runner };
}

const input: CompileInput = {
  files: { 'main.tex': '\\documentclass{article}' },
  entry: 'main.tex',
  outDir: 'build',
  cwd: '/tmp/proj',
};

describe('TectonicEngine', () => {
  it('按 V2 CLI 组装命令并透传 cwd / outDir，退出码映射 success', async () => {
    const { calls, runner } = recordingRunner({
      code: 1,
      stdout: '',
      stderr: '! Undefined control sequence.\nl.9 \\badcmd\n',
    });
    const res = await new TectonicEngine().compile(input, runner);
    expect(calls[0].cmd).toBe('tectonic');
    expect(calls[0].cwd).toBe('/tmp/proj');
    expect(calls[0].args).toEqual(['-X', 'compile', '--keep-logs', '--print', '--outdir', 'build', 'main.tex']);
    expect(res.success).toBe(false);
    expect(res.engine).toBe('tectonic');
    expect(res.diagnostics).toHaveLength(1);
    expect(res.diagnostics[0].line).toBe(9);
    expect(res.log).toContain('Undefined control sequence');
  });
});

describe('LatexmkEngine', () => {
  it('组装 latexmk 参数，退出码 0 视为成功', async () => {
    const { calls, runner } = recordingRunner({ code: 0, stdout: '', stderr: '' });
    const res = await new LatexmkEngine().compile(input, runner);
    expect(calls[0].cmd).toBe('latexmk');
    expect(calls[0].args).toEqual(['-pdf', '-interaction=nonstopmode', '-file-line-error', '-outdir=build', 'main.tex']);
    expect(res.success).toBe(true);
    expect(res.engine).toBe('latexmk');
  });
});

describe('MockEngine', () => {
  it('默认成功、带合成 PDF、干净日志', async () => {
    const engine = new MockEngine({ latencyMs: 5 });
    const res = await engine.compile(input, recordingRunner({ code: 0, stdout: '', stderr: '' }).runner);
    expect(res.success).toBe(true);
    expect(res.pdf).toBeDefined();
    expect(res.log).toBe('');
    expect(engine.compileCalls).toBe(1);
  });

  it('fail 参数返回失败并透传诊断；logs 序列依次消耗', async () => {
    const engine = new MockEngine({
      fail: true,
      diagnostics: [{ severity: 'error', message: 'boom', line: 1 }],
      logs: ['first', 'second'],
    });
    const runner = recordingRunner({ code: 0, stdout: '', stderr: '' }).runner;
    const r1 = await engine.compile(input, runner);
    const r2 = await engine.compile(input, runner);
    expect(r1.success).toBe(false);
    expect(r1.diagnostics[0].message).toBe('boom');
    expect(r1.log).toBe('first');
    expect(r2.log).toBe('second');
    expect(engine.compileCalls).toBe(2);
  });
});
