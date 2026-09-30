/**
 * 性能回归网——超时说明出现 O(n²) 回归。
 *
 * 对合成大项目（默认 120 个 .tex ≈ 两万余行 + 500 条 refs.bib）跑核心纯函数，
 * 用 performance.now 计时并断言宽松时限。时限 = 目标值的 5~10 倍（容忍 CI 机器
 * 波动）；若某项逼近或超出时限，通常意味着出现了 O(n²) 或逐行重复扫描回归，
 * 应先用 genProject 复现并修复实现（禁止用放宽时限代替修 bug）。
 *
 * 计时口径：每项跑 3 次取最小值（降低 JIT / GC 抖动），并打印各次耗时供人工核对。
 */
import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { generateBigProject, generateInputChain } from './genProject';
import { bibEntries, combinedDoc, outlineAcrossFiles } from '../projectDoc';
import { scanFloats } from '../floatsScan';
import { searchProject } from '../searchProject';
import { collectCitekeys, collectLabels, lintLatex, parseOutline } from '@scholarforge/editor';

/** 宽松时限表（ms）——目标值 5~10 倍余量；调整需在 PR 中说明理由 */
const TIME_BUDGET_MS = {
  combinedDoc: 1500, // 目标 ~300ms
  combinedDocDeepChain: 300, // 深嵌套 \input 链（O(深度²) 回归网），目标 ~20ms
  outlineAcrossFiles: 800, // 目标 ~160ms（120 文件）
  parseOutline: 150, // 单文件 1000 行
  collectCitekeys: 300, // combinedDoc 级全文
  lintLatex: 400, // 单文件 1000 行 + 全项目 labels/citekeys 注入
  searchProject: 600, // 120 文件找常见词
  scanFloats: 600, // 120 文件
  bibEntries: 300, // 500 条 bib
} as const;

const RUNS = 3;

/** 跑 RUNS 次取最小耗时；打印各次耗时 */
function bench<T>(name: string, fn: () => T): { result: T; bestMs: number } {
  const times: number[] = [];
  let result: T | undefined;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    result = fn();
    times.push(performance.now() - t0);
  }
  const bestMs = Math.min(...times);
  console.info(`[perf] ${name}: best ${bestMs.toFixed(1)}ms (runs: ${times.map((t) => t.toFixed(1)).join('/')}ms, limit ${TIME_BUDGET_MS[name as keyof typeof TIME_BUDGET_MS]}ms)`);
  return { result: result as T, bestMs };
}

describe('性能基线：合成大项目（120 文件 + 500 条 bib）', () => {
  const project = generateBigProject();
  const single = generateBigProject({ files: 1, linesPerFile: 1000 });
  const singleMain = single.files['main.tex']!;
  // 全项目 label / citekey 集合（模拟编辑器注入给 lintLatex 的项目级上下文）
  const labels = new Set(collectLabels(combinedDoc(project.files)).map((l) => l.name));
  const citekeys = new Set(project.citekeys);

  it(`combinedDoc < ${TIME_BUDGET_MS.combinedDoc}ms（\\input 递归展开 119 个 section）`, () => {
    const { result, bestMs } = bench('combinedDoc', () => combinedDoc(project.files));
    expect(result).not.toBe('');
    expect(result).toContain('\\label{sec:0119}'); // 最后一个 section 已展开
    expect(result).not.toContain('\\input{'); // 全部 input 均已替换
    expect(result.length).toBeGreaterThan(1_000_000); // 万行级全文
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.combinedDoc);
  });

  it(`combinedDoc 深嵌套 \\input 链 < ${TIME_BUDGET_MS.combinedDocDeepChain}ms（O(深度²) 回归网）`, () => {
    const chain = generateInputChain(2000); // 2001 个文件 ≈ 4MB，书稿式多级 include
    const { result, bestMs } = bench('combinedDocDeepChain', () => combinedDoc(chain));
    expect(result).toContain('leaf'); // 链尾已展开
    expect(result).not.toContain('\\input{');
    expect(result.length).toBeGreaterThan(4_000_000);
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.combinedDocDeepChain);
  });

  it(`outlineAcrossFiles < ${TIME_BUDGET_MS.outlineAcrossFiles}ms（120 文件跨文件大纲）`, () => {
    const { result, bestMs } = bench('outlineAcrossFiles', () => outlineAcrossFiles(project.files));
    expect(result.length).toBeGreaterThanOrEqual(119 * 5); // 每 section 至少 1 section + 4 subsection
    expect(result[0]!.file).toBe('sections/sec-0001.tex'); // main.tex 无分级命令，首项来自首个 section
    expect(result[0]!.node.command).toBe('section');
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.outlineAcrossFiles);
  });

  it(`parseOutline < ${TIME_BUDGET_MS.parseOutline}ms（单文件 1000 行）`, () => {
    expect(singleMain.split('\n').length).toBeGreaterThanOrEqual(1000);
    const { result, bestMs } = bench('parseOutline', () => parseOutline(singleMain));
    expect(result.length).toBeGreaterThanOrEqual(30); // ~每 25 行一个层级节点（块推进有少量过冲）
    expect(result[0]!.command).toBe('section');
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.parseOutline);
  });

  it(`collectCitekeys < ${TIME_BUDGET_MS.collectCitekeys}ms（combinedDoc 级全文）`, () => {
    const doc = combinedDoc(project.files);
    const { result, bestMs } = bench('collectCitekeys', () => collectCitekeys(doc));
    expect(result.length).toBeGreaterThan(100); // 大量去重后的引用键
    expect(result[0]).toBeTruthy();
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.collectCitekeys);
  });

  it(`lintLatex < ${TIME_BUDGET_MS.lintLatex}ms（1000 行 + 全项目 labels/citekeys 注入）`, () => {
    const { result, bestMs } = bench('lintLatex', () => lintLatex(singleMain, { labels, citekeys }));
    expect(result.length).toBeGreaterThan(0); // 合成语料含悬空 \ref（alg:/eq: 等）
    expect(result.every((i) => i.line >= 1 && i.line <= singleMain.split('\n').length)).toBe(true);
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.lintLatex);
  });

  it(`searchProject < ${TIME_BUDGET_MS.searchProject}ms（120 文件找常见词）`, () => {
    const { result, bestMs } = bench('searchProject', () =>
      searchProject(project.files, '模型', { limit: 5000 }),
    );
    expect(result.hits.length).toBeGreaterThan(100);
    expect(result.hits[0]!.text.slice(result.hits[0]!.matchStart, result.hits[0]!.matchEnd)).toBe('模型');
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.searchProject);
  });

  it(`scanFloats < ${TIME_BUDGET_MS.scanFloats}ms（120 文件浮动体扫描）`, () => {
    const { result, bestMs } = bench('scanFloats', () => scanFloats(project.files));
    expect(result.length).toBeGreaterThanOrEqual(119 * 2); // 每 section 至少 1 figure + 1 table
    expect(result.some((f) => f.caption && f.caption.length > 0)).toBe(true);
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.scanFloats);
  });

  it(`bibEntries < ${TIME_BUDGET_MS.bibEntries}ms（500 条 bib 冷解析）`, () => {
    // projectDoc 对 bib 全文做有界 memo 缓存（面板重渲染不再重复解析）。
    // 这里每轮追加一行不影响条目的注释使文本唯一，度量"冷解析"路径，
    // 防止缓存把解析器本身的回归掩盖掉。
    let cold = 0;
    const { result, bestMs } = bench('bibEntries', () =>
      bibEntries({ ...project.files, 'refs.bib': `${project.files['refs.bib']}\n% perf-cold-${cold++}` }),
    );
    expect(result.length).toBe(500);
    expect(result[0]!.citekey).toBeTruthy();
    expect(result[0]!.title).toBeTruthy();
    expect(bestMs).toBeLessThan(TIME_BUDGET_MS.bibEntries);
  });
});
