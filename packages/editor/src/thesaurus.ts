/**
 * 学术同义词悬停建议：内置学术替换词典（≥80 个高频口语词 → 2–4 个更学术的替换，
 * 按语境给）+ 光标词查询（词形归一）+ CodeMirror hover 扩展。
 *
 * 三个部分：
 *  1. THESAURUS 词典（手写内置，零外部依赖）：键为小写词/短语（如 good、look at、
 *     a lot of），值为按语境排序的学术替换建议；
 *  2. lookupThesaurus 纯函数：小写查、大小写不敏感、简单词形归一（-s/-es/-ed/-d/-ing
 *     还原，含 -ing 去 e 型还原 using→use）；命中归一形时以 form 字段标注原词形；
 *  3. thesaurusExtension：hoverTooltip——光标所在词（含从该词起头的最长词典短语）
 *     命中词典时弹「学术替换建议」浮层。纯展示、不做点击替换：浮层不注册任何指针
 *     事件，与既有数学预览 / 拼写检查 hover 共存时冲突最小（多个 tooltip 源同点触发
 *     时 CodeMirror 逐个堆叠，只读建议不抢占交互、也不会误改文档）。
 *     跳过：非空选区（只查光标词）、\命令名、% 注释区。.bib 文件在扩展层无法感知
 *     filePath（语言侧切换在 LatexEditor 内部 Compartment，本模块拿不到 prop），
 *     接受：bib 里 hover 也只是只读建议，无害。
 */

import { hoverTooltip } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import { stripLineComment } from './latex/outline';

// ---------------------------------------------------------------------------
// 词典（≥80 词条；键为小写，值为 2–4 个按语境排序的学术替换）
// ---------------------------------------------------------------------------

export const THESAURUS: Record<string, string[]> = {
  // —— 形容词 / 程度 ——
  good: ['favorable', 'solid', 'satisfactory'],
  bad: ['adverse', 'poor', 'unfavorable'],
  big: ['substantial', 'considerable', 'large-scale'],
  small: ['modest', 'marginal', 'limited'],
  large: ['substantial', 'considerable', 'extensive'],
  huge: ['substantial', 'immense', 'considerable'],
  tiny: ['minimal', 'negligible', 'minute'],
  important: ['critical', 'essential', 'pivotal'],
  interesting: ['noteworthy', 'compelling', 'intriguing'],
  amazing: ['remarkable', 'striking', 'notable'],
  nice: ['favorable', 'compelling', 'refined'],
  great: ['substantial', 'remarkable', 'considerable'],
  obvious: ['evident', 'apparent', 'self-evident'],
  clear: ['evident', 'unambiguous', 'apparent'],
  common: ['prevalent', 'widespread', 'frequent'],
  different: ['distinct', 'disparate', 'heterogeneous'],
  same: ['identical', 'analogous', 'comparable'],
  whole: ['entire', 'complete', 'overall'],
  new: ['novel', 'recent', 'emerging'],
  old: ['earlier', 'prior', 'long-standing'],
  hard: ['challenging', 'demanding', 'nontrivial'],
  easy: ['straightforward', 'trivial', 'readily achievable'],
  simple: ['straightforward', 'uncomplicated', 'elementary'],
  complex: ['intricate', 'sophisticated', 'multifaceted'],
  fast: ['rapid', 'accelerated', 'high-speed'],
  slow: ['gradual', 'sluggish', 'time-consuming'],
  quick: ['rapid', 'prompt', 'expedited'],
  cheap: ['inexpensive', 'low-cost', 'cost-effective'],
  expensive: ['costly', 'resource-intensive', 'high-cost'],
  enough: ['sufficient', 'adequate', 'ample'],
  many: ['numerous', 'multiple', 'a wide range of'],
  much: ['considerable', 'substantial', 'extensive'],
  few: ['a limited number of', 'a handful of', 'sparse'],
  some: ['certain', 'several', 'a subset of'],
  // —— 动词 ——
  show: ['demonstrate', 'reveal', 'indicate'],
  find: ['identify', 'determine', 'observe'],
  use: ['employ', 'utilize', 'adopt'],
  make: ['construct', 'generate', 'produce'],
  get: ['obtain', 'acquire', 'retrieve'],
  help: ['facilitate', 'assist', 'support'],
  look: ['examine', 'consider', 'investigate'],
  see: ['observe', 'note', 'discern'],
  think: ['argue', 'contend', 'maintain'],
  believe: ['contend', 'posit', 'maintain'],
  guess: ['estimate', 'hypothesize', 'conjecture'],
  know: ['recognize', 'ascertain', 'establish'],
  learn: ['ascertain', 'determine'],
  mean: ['denote', 'signify', 'indicate'],
  tell: ['indicate', 'reveal', 'convey'],
  give: ['provide', 'present', 'yield'],
  take: ['adopt', 'employ', 'require'],
  keep: ['maintain', 'preserve', 'retain'],
  let: ['enable', 'allow', 'permit'],
  put: ['place', 'insert', 'position'],
  change: ['modify', 'alter', 'adjust'],
  start: ['initiate', 'commence', 'introduce'],
  end: ['conclude', 'terminate', 'culminate in'],
  ask: ['inquire', 'request', 'consult'],
  answer: ['address', 'respond to', 'resolve'],
  check: ['verify', 'validate', 'examine'],
  prove: ['establish', 'demonstrate', 'substantiate'],
  improve: ['enhance', 'refine', 'strengthen'],
  explain: ['account for', 'elucidate', 'clarify'],
  choose: ['select', 'adopt', 'opt for'],
  decide: ['determine', 'resolve', 'conclude'],
  happen: ['occur', 'arise', 'take place'],
  stop: ['cease', 'discontinue', 'halt'],
  grow: ['increase', 'expand', 'develop'],
  build: ['construct', 'develop', 'assemble'],
  cut: ['reduce', 'curtail', 'diminish'],
  drop: ['decline', 'decrease', 'diminish'],
  seem: ['appear', 'suggest', 'tend to'],
  want: ['seek', 'aim to', 'intend to'],
  need: ['require', 'necessitate', 'call for'],
  // —— 名词 ——
  problem: ['challenge', 'issue', 'limitation'],
  way: ['approach', 'method', 'strategy'],
  thing: ['element', 'aspect', 'component'],
  stuff: ['material', 'content', 'substance'],
  part: ['component', 'portion', 'segment'],
  kind: ['type', 'category', 'variant'],
  type: ['category', 'class', 'variant'],
  future: ['forthcoming', 'anticipated', 'prospective'],
  // —— 副词 / 连接词 ——
  really: ['notably', 'particularly', 'markedly'],
  very: ['highly', 'considerably', 'substantially'],
  quite: ['rather', 'moderately', 'markedly'],
  maybe: ['possibly', 'potentially', 'perhaps'],
  also: ['additionally', 'furthermore', 'moreover'],
  but: ['however', 'nevertheless', 'whereas'],
  so: ['therefore', 'consequently', 'thus'],
  now: ['currently', 'at present', 'presently'],
  today: ['currently', 'in recent years', 'at present'],
  // —— 短语（hover 从光标词起头做最长匹配）——
  'look at': ['examine', 'investigate', 'inspect'],
  'look into': ['investigate', 'examine', 'explore'],
  'think about': ['consider', 'contemplate', 'evaluate'],
  'talk about': ['discuss', 'address', 'describe'],
  'deal with': ['address', 'handle', 'tackle'],
  'figure out': ['determine', 'ascertain', 'resolve'],
  'find out': ['determine', 'discover', 'establish'],
  'come up with': ['devise', 'propose', 'formulate'],
  'carry out': ['conduct', 'perform', 'execute'],
  'set up': ['establish', 'configure', 'construct'],
  'point out': ['note', 'highlight', 'emphasize'],
  'a lot of': ['numerous', 'extensive', 'a substantial amount of'],
  'lots of': ['numerous', 'abundant', 'extensive'],
  'because of': ['owing to', 'due to', 'as a result of'],
  'a bit': ['slightly', 'marginally', 'to a limited extent'],
};

// ---------------------------------------------------------------------------
// 查询（纯函数）
// ---------------------------------------------------------------------------

/** 查询结果：word = 命中的词典基形；form = 原词形（小写归一后的输入，与基形相同时省略） */
export interface ThesaurusLookup {
  word: string;
  suggestions: string[];
  form?: string;
}

/** 词形归一候选（顺序尝试，词典命中即返回）：原形 → 去 es → 去 s → 去 ed → 去 d
 *  → 去 ing → 去 ing 补 e（using→use）。候选最短 3 字符（防 'us' 类两字母截断），
 *  词典命中兜底。简单后缀规则，不规则变化（went→go）不支持。 */
function baseCandidates(lower: string): string[] {
  const out = [lower];
  const push = (candidate: string): void => {
    if (candidate.length >= 3) out.push(candidate);
  };
  if (lower.endsWith('es')) push(lower.slice(0, -2));
  if (lower.endsWith('s')) push(lower.slice(0, -1));
  if (lower.endsWith('ed')) push(lower.slice(0, -2));
  if (lower.endsWith('d')) push(lower.slice(0, -1));
  if (lower.endsWith('ing')) {
    push(lower.slice(0, -3));
    push(`${lower.slice(0, -3)}e`);
  }
  return out;
}

/**
 * 查询学术替换：小写化后先查原形，再按 -s/-es/-ed/-d/-ing 归一尝试。
 * 命中归一形时 form 记录原词形（如 lookupThesaurus('shows') → { word: 'show',
 * suggestions: [...], form: 'shows' }）；未命中返回 null。
 */
export function lookupThesaurus(word: string): ThesaurusLookup | null {
  const lower = word.trim().toLowerCase();
  if (!lower) return null;
  for (const base of baseCandidates(lower)) {
    const suggestions = THESAURUS[base];
    if (suggestions) {
      return base === lower
        ? { word: base, suggestions }
        : { word: base, suggestions, form: lower };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 位置命中（hover 数据源与测试共用）
// ---------------------------------------------------------------------------

/** 光标位置命中：from/to 覆盖命中的词/短语，word/form/suggestions 为替换建议 */
export interface ThesaurusHit extends ThesaurusLookup {
  from: number;
  to: number;
}

function isAsciiLetter(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/**
 * 在 text 的 pos 处查词典：
 *  - 取光标所在字母词（pos 贴在词右边界时取其左侧词）；
 *  - 跳过 \命令名（词首前紧邻反斜杠）与 % 注释区（复用 outline.ts 的行注释语义）；
 *  - 短语匹配：从光标词起头向后取至多 2 个后继词（单空格衔接），最长优先
 *    （deal with 优先于 deal；多空格 / 换行 / 标点即断，短语不跨行）。
 */
export function thesaurusAtPosition(text: string, pos: number): ThesaurusHit | null {
  if (pos < 0 || pos > text.length) return null;
  const at = pos < text.length && isAsciiLetter(text[pos]) ? pos : pos - 1;
  if (!isAsciiLetter(text[at])) return null;
  let from = at;
  let to = at;
  while (from > 0 && isAsciiLetter(text[from - 1])) from--;
  while (to < text.length && isAsciiLetter(text[to])) to++;

  // \command 词名跳过（\use、\show 等控制序列本体不是行文用词）
  if (from > 0 && text[from - 1] === '\\') return null;

  // 行注释区跳过：% 之后（未被 \ 转义）的词不构成行文
  const lineStart = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
  const code = stripLineComment(text.slice(lineStart, to));
  if (from - lineStart >= code.length) return null;

  const word = text.slice(from, to).toLowerCase();

  // 短语（最长优先）：word + 至多 2 个后继词（词典最长短语为 3 词）
  let cursor = to;
  const tailWords: string[] = [];
  const tailEnds: number[] = [];
  for (let extra = 0; extra < 2; extra++) {
    const spaceStart = cursor;
    while (text[cursor] === ' ') cursor++;
    if (cursor - spaceStart !== 1) break; // 仅容忍单个空格衔接
    let wordEnd = cursor;
    while (wordEnd < text.length && isAsciiLetter(text[wordEnd])) wordEnd++;
    if (wordEnd === cursor) break;
    tailWords.push(text.slice(cursor, wordEnd));
    tailEnds.push(wordEnd);
    cursor = wordEnd;
  }
  if (tailWords.length === 2) {
    const phrase3 = `${word} ${tailWords.join(' ')}`;
    const suggestions3 = THESAURUS[phrase3];
    if (suggestions3) return { word: phrase3, suggestions: suggestions3, from, to: tailEnds[1]! };
  }
  if (tailWords.length >= 1) {
    const phrase2 = `${word} ${tailWords[0]}`;
    const suggestions2 = THESAURUS[phrase2];
    if (suggestions2) return { word: phrase2, suggestions: suggestions2, from, to: tailEnds[0]! };
  }

  const hit = lookupThesaurus(word);
  return hit ? { ...hit, from, to } : null;
}

// ---------------------------------------------------------------------------
// CodeMirror hover 扩展
// ---------------------------------------------------------------------------

/** 构建浮层 DOM（内联样式，不新增 CSS 文件；chips 纯展示，不挂点击处理） */
function createThesaurusElement(hit: ThesaurusHit): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'sf-thes-hover';
  dom.style.maxWidth = '380px';
  dom.style.padding = '6px 10px';
  dom.style.fontSize = '12.5px';
  dom.style.lineHeight = '1.7';
  dom.style.background = '#1c2029';
  dom.style.border = '1px solid #343b4a';
  dom.style.borderRadius = '6px';
  dom.style.color = '#d7dce8';

  const head = document.createElement('div');
  const word = document.createElement('strong');
  word.textContent = hit.word;
  head.append(word);
  if (hit.form !== undefined) {
    const form = document.createElement('span');
    form.textContent = `（原词形：${hit.form}）`;
    form.style.opacity = '0.75';
    head.append(form);
  }
  const tag = document.createElement('span');
  tag.textContent = ' 学术替换建议';
  tag.style.opacity = '0.85';
  head.append(tag);
  dom.append(head);

  const chips = document.createElement('div');
  for (const suggestion of hit.suggestions) {
    const chip = document.createElement('span');
    chip.className = 'sf-thes-chip';
    chip.textContent = suggestion;
    chip.style.display = 'inline-block';
    chip.style.margin = '2px 6px 2px 0';
    chip.style.padding = '1px 8px';
    chip.style.border = '1px solid #454f63';
    chip.style.borderRadius = '10px';
    chip.style.background = '#262c38';
    chips.append(chip);
  }
  dom.append(chips);

  const note = document.createElement('div');
  note.textContent = '仅作建议展示，请手动替换';
  note.style.opacity = '0.65';
  dom.append(note);
  return dom;
}

/**
 * 学术替换 hover 扩展：光标词命中词典 → 「学术替换建议」浮层（只读建议）。
 * 非空选区时静默（只查光标词）；与数学预览 / 拼写检查的 hover 共存
 * （CodeMirror 逐源堆叠 tooltip，互不抢占）。
 */
export function thesaurusExtension(): Extension {
  return hoverTooltip((view, pos) => {
    if (!view.state.selection.main.empty) return null;
    const hit = thesaurusAtPosition(view.state.doc.toString(), pos);
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create: () => ({ dom: createThesaurusElement(hit) }),
    };
  });
}
