/**
 * 稿件健康度聚合（首页指挥台「健康度卡」数据源，纯函数）：
 * 对整个项目文件集做四类检查并折算为 0–100 的健康分——
 *  - lint：逐 .tex 文件 lintLatex，仅 error 级计入（环境不配对/未闭合）；
 *    注入全项目 labels + bib citekeys 做跨文件校验，避免 \ref/\cite 误报（它们本身是 warning 级）；
 *  - spell：checkText 跑全项目 combined 文本（\input 递归展开）；misspelling 计分，
 *    confusable 只进 issue 计数不扣分（语境相关，人工判断，权重低）；
 *  - glossary：extractGlossary + checkConsistency（error 级才计）；
 *  - citation：combined 文本 collectCitekeys 中不在 bibCitekeys 的悬空键数。
 *
 * 评分公式：score = 100 - min(40, lint×4) - min(25, misspell×2) - min(15, glossary×3)
 *                - min(20, dangling×5)，下限 0。
 *
 * 性能：复用 perf 基线已覆盖的函数（combinedDoc / lintLatex / collectCitekeys），
 * combinedDoc 只跑一次供 spell/glossary/citation 三方共用；无额外重复扫描。
 */

import { checkText, collectCitekeys, collectLabels, lintLatex } from '@scholarforge/editor';
import { checkConsistency, extractGlossary } from '@scholarforge/knowledge';
import { bibCitekeys, combinedDoc } from './projectDoc';
import { computeProjectWords } from './state/writingStats';

/** issue 类别（固定顺序输出：lint → spell → glossary → citation） */
export type HealthIssueKind = 'lint' | 'spell' | 'glossary' | 'citation';

export interface HealthIssue {
  kind: HealthIssueKind;
  /** 该类问题总数（spell 为 misspelling + confusable 之和） */
  count: number;
  /** 首个问题的摘要（无问题为空串）：lint 含「文件:行 消息」，spell 为词形，citation 为悬空键 */
  sample: string;
}

export interface HealthReport {
  /** 0–100，越高越健康 */
  score: number;
  /** 四类 issue 计数（count 可为 0，恒为四项、顺序固定） */
  issues: HealthIssue[];
  /** 项目总字数（全部 .tex 文件 countWords 之和，与写作统计同口径） */
  words: number;
}

/** 各类扣分上限（与公式 min(上限, 单价×数量) 一一对应） */
export const HEALTH_PENALTY_CAPS = {
  /** lint 错误 ×4，最多扣 40 */
  lint: 40,
  /** misspelling ×2，最多扣 25 */
  spell: 25,
  /** glossary error ×3，最多扣 15 */
  glossary: 15,
  /** 悬空 citation ×5，最多扣 20 */
  citation: 20,
} as const;

/** 健康分 → 展示色调（≥85 绿 / 60–85 黄 / <60 红），Dashboard 分数着色用 */
export type HealthTone = 'good' | 'warn' | 'bad';

export function healthTone(score: number): HealthTone {
  if (score >= 85) return 'good';
  if (score >= 60) return 'warn';
  return 'bad';
}

/**
 * 聚合项目健康度。纯函数：只读 files，不触碰任何 store / 持久化。
 * 空项目（无 .tex）返回满分 100、words 0、四类计数 0。
 */
export function computeHealth(files: Record<string, string>): HealthReport {
  // —— 文件分类：.tex 参与 lint 与字数统计；combined 文本供 spell/glossary/citation ——
  const texFiles: Array<[string, string]> = [];
  for (const [path, content] of Object.entries(files)) {
    if (path.toLowerCase().endsWith('.tex')) texFiles.push([path, content]);
  }
  const doc = combinedDoc(files);

  // —— ① lint：error 级才算（跨文件 labels / bib citekeys 注入，避免悬空 \ref 误报） ——
  const labels = new Set<string>();
  for (const [, content] of texFiles) {
    for (const label of collectLabels(content)) labels.add(label.name);
  }
  const knownCitekeys = bibCitekeys(files);
  let lintCount = 0;
  let lintSample = '';
  for (const [path, content] of texFiles) {
    for (const issue of lintLatex(content, { labels, citekeys: knownCitekeys })) {
      if (issue.severity !== 'error') continue;
      lintCount += 1;
      if (!lintSample) lintSample = `${path}:${issue.line} ${issue.message}`;
    }
  }

  // —— ② spell：misspelling 计分；confusable 计入计数但不扣分 ——
  const spellIssues = checkText(doc);
  let misspellCount = 0;
  let confusableCount = 0;
  let spellSample = '';
  for (const issue of spellIssues) {
    if (issue.kind === 'misspelling') misspellCount += 1;
    else confusableCount += 1;
    if (!spellSample) spellSample = issue.word;
  }

  // —— ③ glossary：术语一致性 error 数（hint 级的全称冗余提示不算） ——
  let glossaryCount = 0;
  let glossarySample = '';
  for (const issue of checkConsistency(doc, extractGlossary(doc))) {
    if (issue.severity !== 'error') continue;
    glossaryCount += 1;
    if (!glossarySample) glossarySample = issue.message;
  }

  // —— ④ citation：正文引用键不在任何 .bib 中的悬空数 ——
  let danglingCount = 0;
  let danglingSample = '';
  for (const key of collectCitekeys(doc)) {
    if (knownCitekeys.has(key)) continue;
    danglingCount += 1;
    if (!danglingSample) danglingSample = key;
  }

  // —— 折算（各类上限钳制 + 总分下限 0） ——
  const score = Math.max(
    0,
    100 -
      Math.min(HEALTH_PENALTY_CAPS.lint, lintCount * 4) -
      Math.min(HEALTH_PENALTY_CAPS.spell, misspellCount * 2) -
      Math.min(HEALTH_PENALTY_CAPS.glossary, glossaryCount * 3) -
      Math.min(HEALTH_PENALTY_CAPS.citation, danglingCount * 5),
  );

  return {
    score,
    issues: [
      { kind: 'lint', count: lintCount, sample: lintSample },
      { kind: 'spell', count: misspellCount + confusableCount, sample: spellSample },
      { kind: 'glossary', count: glossaryCount, sample: glossarySample },
      { kind: 'citation', count: danglingCount, sample: danglingSample },
    ],
    words: computeProjectWords(files),
  };
}
