import type { CompileEngineKind, CompileResult, Diagnostic, ProjectFileMap } from '@lemma/shared';
import { parseLatexLog } from './logParser';

/** 宿主注入的命令执行器（Electron 主进程 / Node 侧实现；浏览器形态不存在） */
export interface CommandRunner {
  run(cmd: string, args: string[], opts: { cwd: string; stdin?: string }): Promise<{ code: number; stdout: string; stderr: string }>;
}

export interface CompileInput {
  files: ProjectFileMap;
  entry: string;
  outDir?: string;
  /** 真实引擎的工作目录；约定宿主已把 files 物化到该目录下，缺省 '.' */
  cwd?: string;
}

export interface LatexEngine {
  readonly kind: CompileEngineKind;
  compile(input: CompileInput, runner: CommandRunner): Promise<CompileResult>;
}

/**
 * Tectonic 引擎。两代 CLI 均可用：
 * - V2（当前）：`tectonic -X compile <entry>`，本实现采用；
 * - V1（旧版）：等价于 `tectonic <entry>`，去掉 `-X compile` 即可，
 *   两代均支持 --keep-logs / --print / --outdir。
 * `--synctex` 让引擎同时落盘 .synctex.gz（PDF ↔ 源码双向跳转索引，宿主负责回读注册）；
 * `--print` 会把完整编译日志打到 stdout，因此无需回读 .log 文件；
 * PDF 由 tectonic 落盘到 outDir（缺省 cwd），二进制回读由宿主负责（pdf 字段留空）。
 */
export class TectonicEngine implements LatexEngine {
  readonly kind = 'tectonic' as const;

  async compile(input: CompileInput, runner: CommandRunner): Promise<CompileResult> {
    const started = Date.now();
    const args = ['-X', 'compile', '--keep-logs', '--print', '--synctex'];
    if (input.outDir) args.push('--outdir', input.outDir);
    args.push(input.entry);
    const { code, stdout, stderr } = await runner.run('tectonic', args, { cwd: input.cwd ?? '.' });
    const log = `${stdout}\n${stderr}`;
    return {
      success: code === 0,
      engine: 'tectonic',
      durationMs: Date.now() - started,
      diagnostics: parseLatexLog(log),
      log,
    };
  }
}

/**
 * 系统 TeX Live / MiKTeX 的 latexmk 编排。诊断解析 stdout+stderr；
 * 完整 .log 的回读需宿主把内容合并进 stdout 或后续扩展 CommandRunner。
 * `-synctex=1` 让引擎同时产出 .synctex.gz（PDF ↔ 源码双向跳转索引）。
 */
export class LatexmkEngine implements LatexEngine {
  readonly kind = 'latexmk' as const;

  async compile(input: CompileInput, runner: CommandRunner): Promise<CompileResult> {
    const started = Date.now();
    const args = ['-pdf', '-interaction=nonstopmode', '-synctex=1', '-file-line-error'];
    if (input.outDir) args.push(`-outdir=${input.outDir}`);
    args.push(input.entry);
    const { code, stdout, stderr } = await runner.run('latexmk', args, { cwd: input.cwd ?? '.' });
    const log = `${stdout}\n${stderr}`;
    return {
      success: code === 0,
      engine: 'latexmk',
      durationMs: Date.now() - started,
      diagnostics: parseLatexLog(log),
      log,
    };
  }
}

export interface MockEngineOptions {
  latencyMs?: number;
  diagnostics?: Diagnostic[];
  /** 为 true 时 compile 返回失败 */
  fail?: boolean;
  /** 依次返回的日志文本（模拟"重跑后收敛"）；耗尽后重复最后一项，缺省为空（干净日志） */
  logs?: string[];
}

/** 浏览器形态与单元测试使用的假引擎：不执行任何命令、不触碰 runner */
export class MockEngine implements LatexEngine {
  readonly kind = 'mock' as const;
  /** compile 被调用次数（供测试断言趟数） */
  compileCalls = 0;
  private logIndex = 0;

  constructor(private readonly options: MockEngineOptions = {}) {}

  async compile(_input: CompileInput, _runner: CommandRunner): Promise<CompileResult> {
    this.compileCalls++;
    const started = Date.now();
    if (this.options.latencyMs && this.options.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
    const log = this.options.logs
      ? this.options.logs[Math.min(this.logIndex++, this.options.logs.length - 1)]
      : '';
    const success = !this.options.fail;
    return {
      success,
      engine: 'mock',
      durationMs: Date.now() - started,
      diagnostics: this.options.diagnostics ? [...this.options.diagnostics] : [],
      log,
      pdf: success ? MOCK_PDF : undefined,
    };
  }
}

const MOCK_PDF = new TextEncoder().encode('%PDF-1.4\n%Lemma MockEngine 合成输出（非真实文档）\n%%EOF\n');
