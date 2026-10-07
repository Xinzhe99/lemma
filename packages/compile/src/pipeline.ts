import type { CompileResult, Diagnostic } from '@lemma/shared';
import type { CommandRunner, CompileInput, LatexEngine } from './engine';
import { parseLatexLog } from './logParser';

/** runFullCompile 的返回：在 CompileResult 基础上附带 latex 编译趟数 */
export interface FullCompileResult extends CompileResult {
  passes: number;
}

/** 最多跑多少趟 latex（含首趟），与常见 latexmk 行为一致 */
const MAX_PASSES = 4;

const RERUN_HINTS: RegExp[] = [
  /Rerun to get/i,
  /Label\(s\) may have changed/i,
  /Citation `[^']*' on page \d+ undefined/i,
  /There were undefined references/i,
];

/** 日志是否提示需要再编译一趟（交叉引用/引文尚未收敛） */
export function needsRerun(log: string): boolean {
  return RERUN_HINTS.some((re) => re.test(log));
}

/**
 * 完整编译编排：latex →（存在 .bib 时 bibtex → latex）→ 依据 log 判断是否再跑，最多 MAX_PASSES 趟。
 * 纯编排逻辑：引擎与命令执行器均由外部注入；诊断按 severity|file|line|message 去重合并。
 *
 * 说明：tectonic 在单次调用内已自动处理 bibtex 与必要的重跑，
 * 因此显式 bibtex 编排只对 latexmk（及测试用 mock）生效。
 */
export async function runFullCompile(
  input: CompileInput,
  engine: LatexEngine,
  runner: CommandRunner,
): Promise<FullCompileResult> {
  const startedAt = Date.now();
  const merged: Diagnostic[] = [];
  const seen = new Set<string>();
  const merge = (ds: Diagnostic[]): void => {
    for (const d of ds) {
      const key = `${d.severity}|${d.file ?? ''}|${d.line ?? ''}|${d.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(d);
      }
    }
  };

  const hasBib = Object.keys(input.files).some((p) => /\.bib$/i.test(p));

  let last = await engine.compile(input, runner);
  merge(last.diagnostics);
  let passes = 1;

  if (last.success && hasBib && engine.kind !== 'tectonic') {
    const bib = await runner.run('bibtex', [auxPath(input)], { cwd: input.cwd ?? '.' });
    merge(parseLatexLog(`${bib.stdout}\n${bib.stderr}`));
    last = await engine.compile(input, runner);
    merge(last.diagnostics);
    passes++;
  }

  while (last.success && passes < MAX_PASSES && needsRerun(last.log ?? '')) {
    last = await engine.compile(input, runner);
    merge(last.diagnostics);
    passes++;
  }

  // 收敛（最后一趟日志不再提示重跑）后，丢弃中间趟遗留的「重跑提示类」警告：
  // 典型场景是 bibtex 之前那趟的 Citation/Reference undefined，解决后仍留在
  // merged 里，编辑器沟槽会一直显示早已不成立的告警。
  // 最终日志仍提示重跑时不过滤（此时这些警告确实存在）。
  const diagnostics = needsRerun(last.log ?? '')
    ? merged
    : merged.filter((d) => !RERUN_HINTS.some((re) => re.test(d.message)));

  return { ...last, durationMs: Date.now() - startedAt, diagnostics, passes };
}

/** 由入口推算 bibtex 要处理的 .aux 路径（简化：假定 entry 位于项目根，outDir 优先） */
function auxPath(input: CompileInput): string {
  const base = input.entry.replace(/\.tex$/i, '');
  return input.outDir ? `${input.outDir}/${base}.aux` : `${base}.aux`;
}
