/**
 * 快速修复（quick fix）：把 spellcheck 的波浪线从「看得见」变成「一键修」。
 *
 * 三个部分：
 *  1. buildFixOptions 纯函数：从 SpellIssue.suggestion 解析候选替换列表——
 *     逗号（半角/全角/顿号）与斜杠分隔（"critical / essential" → 两项）；
 *     含说明性文字的 suggestion（中文 hint 混杂、括号注记）只提取拉丁词序列候选；
 *     模板占位（"as … advances" 的 …）非具体候选，跳过；与原词相同/重复的候选排除；
 *  2. quickFixExtension：hoverTooltip（复用 spellHover 的定位思路——光标落在
 *     checkText 命中 span 内即弹）浮层显示原词 + 候选按钮 +【忽略此词】。
 *     点击候选 = dispatch 单个替换 Transaction（from/to 用命中 span 定位，
 *     与装饰 range 同源），替换后 spellcheck 的 StateField 随 docChanged 重算，
 *     波浪线自动消失。hideOnChange=true：替换事务落地后浮层即收起。
 *     与 thesaurus / spellcheck hover 的共存：CodeMirror 把多个 hover 源合并进
 *     同一宿主容器（cm-tooltip-section，按扩展注册序排列），互不抢占；本扩展
 *     在宿主 extraExtensions 中最后追加 → 位于堆叠最内层（最贴近文本，更具体）；
 *  3. 忽略集合：模块级 Set（会话级，诚实标注——重启/重载即重置，不持久化）。
 *     忽略只作用于本浮层：spellcheck 的波浪线归 spellcheckExtension 持有，
 *     按分工约定不改动其行为（忽略后下划线仍在，但 quick-fix 浮层不再弹出）。
 */

import { EditorView, hoverTooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { checkText, type SpellIssue } from './spellcheck';

// ---------------------------------------------------------------------------
// 忽略集合（会话级）
// ---------------------------------------------------------------------------

/** 会话级忽略词集合（模块级单例；应用重启 / 页面重载即重置，不持久化到磁盘） */
const ignoredWords = new Set<string>();

/** 归一化：小写 + 折叠连续空白（短语多空格命中与单空格视为同一词） */
function normalizeWord(word: string): string {
  return word.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** 把词加入会话级忽略集合（忽略后 quick-fix 浮层不再为该词弹出） */
export function ignoreWord(word: string): void {
  const key = normalizeWord(word);
  if (key) ignoredWords.add(key);
}

/** 已忽略词列表（宿主可展示「已忽略」清单；归一化形态） */
export function getIgnoredWords(): string[] {
  return [...ignoredWords];
}

/** 清空忽略集合（宿主「重置忽略」入口 / 测试隔离用） */
export function clearIgnoredWords(): void {
  ignoredWords.clear();
}

/** 词是否已在本会话被忽略（大小写/多空白归一后判断） */
export function isWordIgnored(word: string): boolean {
  return ignoredWords.has(normalizeWord(word));
}

// ---------------------------------------------------------------------------
// 候选解析（纯函数）
// ---------------------------------------------------------------------------

/** quick-fix 输入：SpellIssue 的结构子集（宿主可直接传 checkText 的 SpellIssue） */
export interface QuickFixIssue {
  word: string;
  suggestion: string;
  kind: string;
}

/** 完整形态候选：字母开头，仅含字母 / 空格 / 句点（e.g.、etc.）/ 撇号（it's）/ 连字符（large-scale） */
const WELL_FORMED_RE = /^[A-Za-z][A-Za-z .'\-]*$/;
/** 拉丁词序列（词间可由空格/句点/撇号/连字符衔接）：从混合说明文字中提取候选 */
const LATIN_RUN_RE = /[A-Za-z]+(?:[ .'\-]+[A-Za-z]+)*/g;

/**
 * 从 suggestion 解析候选替换列表：
 *  - 按逗号（, ， 、）与斜杠（/）分隔："favorable/solid/satisfactory"、
 *    "critical / essential"、"can / be able to" → 多候选；
 *  - 完整形态候选（WELL_FORMED_RE）直接保留；
 *  - 混杂说明性文字的 token（中文 hint、括号注记）只提取其中的拉丁词序列
 *    （"改为 receive 更好" → "receive"）；模板占位（… / ...）所在 token 非具体
 *    候选，整体跳过（"as … advances" 不产出 "as advances" 这类错误候选）；
 *  - 与原词相同（忽略大小写/空白差异）或彼此重复的候选排除；
 *  - 无可用候选返回 []。
 */
export function buildFixOptions(issue: QuickFixIssue): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const selfKey = normalizeWord(issue.word);
  const push = (candidate: string): void => {
    const key = normalizeWord(candidate);
    if (!key || key === selfKey || seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  for (const token of issue.suggestion.split(/[,，、/]+/)) {
    const trimmed = token.trim();
    if (!trimmed) continue;
    if (trimmed.includes('…') || trimmed.includes('...')) continue;
    if (WELL_FORMED_RE.test(trimmed)) {
      push(trimmed);
      continue;
    }
    // 说明性文字混合：只提取拉丁词序列（每个序列一个候选）
    const runs = trimmed.match(LATIN_RUN_RE) ?? [];
    for (const run of runs) push(run.trim().replace(/[ .'\-]+$/, ''));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 替换应用
// ---------------------------------------------------------------------------

/** 替换目标定位：SpellIssue 的词形 + 位置（与装饰 range 同源） */
export interface QuickFixTarget {
  word: string;
  from: number;
  to: number;
}

/**
 * 应用替换：对当前文档重新扫描定位目标——首选原 span 精确匹配（hover 期间文档
 * 未变）；偏移漂移（hover 期间文档被改）时按词形回退到首处命中。目标词已不存在
 * （该错误已被修掉）返回 false 且不动文档；命中则 dispatch 单个替换事务并返回 true。
 */
export function applyQuickFix(view: EditorView, target: QuickFixTarget, replacement: string): boolean {
  const key = normalizeWord(target.word);
  if (!key) return false;
  const issues = checkText(view.state.doc.toString());
  let hit = issues.find(
    (i) => i.from === target.from && i.to === target.to && normalizeWord(i.word) === key,
  );
  if (!hit) hit = issues.find((i) => normalizeWord(i.word) === key);
  if (!hit) return false;
  view.dispatch({ changes: { from: hit.from, to: hit.to, insert: replacement } });
  return true;
}

// ---------------------------------------------------------------------------
// 浮层 DOM（内联样式，不改任何 .css）
// ---------------------------------------------------------------------------

/** issue 种类 → 浮层标签（与 spellcheck.ts 的 labelForIssue 同文案，未导出故本地复刻） */
function kindLabel(kind: string): string {
  if (kind === 'confusable') return '（用词）';
  if (kind === 'chinglish') return '（中式表达）';
  return '（拼写）';
}

/** 候选随原词大小写（与 spellcheck.matchCase 同规则：全大写→全大写；首字母大写→首字母大写） */
function matchCandidateCase(word: string, candidate: string): string {
  if (word.length > 1 && word === word.toUpperCase()) return candidate.toUpperCase();
  const first = word.charAt(0);
  if (first !== first.toLowerCase()) return candidate.charAt(0).toUpperCase() + candidate.slice(1);
  return candidate;
}

/** 浮层内容替换为一条结果提示（替换/忽略后原按钮组不再有意义） */
function setPanelMessage(dom: HTMLElement, message: string): void {
  dom.replaceChildren();
  const note = document.createElement('div');
  note.textContent = message;
  note.style.opacity = '0.85';
  dom.append(note);
}

/**
 * 构建快速修复浮层：原词 + 类别标签、候选按钮（每个候选一个，点击即替换）、
 * 【忽略此词】按钮（加入会话级忽略集合）。按钮文案与实际插入文本一致
 * （候选已随原词大小写）。
 */
function createQuickFixPanel(view: EditorView, hit: SpellIssue): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'sf-quickfix-hover';
  // 内联样式承载浮层外观（复用 spellHover 同一暗色系，不新增 CSS 文件）
  dom.style.maxWidth = '420px';
  dom.style.padding = '6px 10px';
  dom.style.fontSize = '12.5px';
  dom.style.lineHeight = '1.6';
  dom.style.background = '#1c2029';
  dom.style.border = '1px solid #343b4a';
  dom.style.borderRadius = '6px';
  dom.style.color = '#d7dce8';

  const head = document.createElement('div');
  const wrong = document.createElement('strong');
  wrong.textContent = hit.word;
  const tag = document.createElement('span');
  tag.textContent = ` ${kindLabel(hit.kind)} 快速修复`;
  tag.style.opacity = '0.85';
  head.append(wrong, tag);
  dom.append(head);

  const candidates = buildFixOptions(hit).map((c) => matchCandidateCase(hit.word, c));
  if (candidates.length === 0) {
    const none = document.createElement('div');
    none.textContent = '无自动候选，请参考悬浮说明手动修改';
    none.style.opacity = '0.75';
    dom.append(none);
  } else {
    const row = document.createElement('div');
    row.style.margin = '4px 0';
    for (const candidate of candidates) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = candidate;
      btn.title = `替换为 ${candidate}`;
      btn.style.display = 'inline-block';
      btn.style.margin = '2px 6px 2px 0';
      btn.style.padding = '2px 10px';
      btn.style.border = '1px solid #454f63';
      btn.style.borderRadius = '10px';
      btn.style.background = '#262c38';
      btn.style.color = '#d7dce8';
      btn.style.fontSize = '12.5px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', () => {
        // hideOnChange=true 使替换事务落地后浮层整体收起；提示文案兜底显示
        const applied = applyQuickFix(view, hit, candidate);
        setPanelMessage(
          dom,
          applied ? `已替换：${hit.word} → ${candidate}` : '位置已失效，请重新悬停',
        );
      });
      row.append(btn);
    }
    dom.append(row);
  }

  const ignore = document.createElement('button');
  ignore.type = 'button';
  ignore.textContent = '忽略此词';
  ignore.title = '本次会话内不再弹出快速修复（重启后重置）';
  ignore.style.marginTop = '2px';
  ignore.style.padding = '1px 8px';
  ignore.style.border = '1px dashed #5a6478';
  ignore.style.borderRadius = '10px';
  ignore.style.background = 'transparent';
  ignore.style.color = '#9aa4b8';
  ignore.style.fontSize = '12px';
  ignore.style.cursor = 'pointer';
  ignore.addEventListener('click', () => {
    ignoreWord(hit.word);
    setPanelMessage(dom, `已忽略：${hit.word}（本次会话内不再提示）`);
  });
  dom.append(ignore);
  return dom;
}

// ---------------------------------------------------------------------------
// 位置命中（hover 数据源与测试共用）
// ---------------------------------------------------------------------------

/** pos 处的检查命中（光标贴在 span 右边界时也算命中，与 spellHover 同判定）；忽略词跳过 */
function issueAt(text: string, pos: number): SpellIssue | null {
  return (
    checkText(text).find((i) => pos >= i.from && pos <= i.to && !isWordIgnored(i.word)) ?? null
  );
}

/**
 * 取 pos 处的快速修复浮层 DOM（hover 源与测试共用入口）：
 * 命中被忽略词或无命中返回 null。返回的浮层已挂好按钮事件，click 即可触发替换/忽略。
 */
export function quickFixPanelAt(view: EditorView, pos: number): HTMLElement | null {
  const hit = issueAt(view.state.doc.toString(), pos);
  return hit ? createQuickFixPanel(view, hit) : null;
}

// ---------------------------------------------------------------------------
// CodeMirror 扩展
// ---------------------------------------------------------------------------

/**
 * 快速修复 hover 扩展：光标在拼写/用词/中式表达命中 span 内 → 候选按钮浮层。
 * hideOnChange=true：文档变化（含点按钮产生的替换事务）即收起。
 * 在宿主扩展数组中最后注册 → 多 hover 同点堆叠时位于最内层（最贴近文本）。
 */
export function quickFixExtension(): Extension {
  return hoverTooltip(
    (view, pos) => {
      const hit = issueAt(view.state.doc.toString(), pos);
      if (!hit) return null;
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create: () => ({ dom: createQuickFixPanel(view, hit) }),
      };
    },
    { hideOnChange: true },
  );
}
