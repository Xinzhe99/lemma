/**
 * 拼写与学术用词检查：内置词表 + 纯函数检查 + CodeMirror 6 扩展。
 *
 * 三部分：
 *  1. 词表（手写内置，零外部依赖）：MISSPELLINGS（常见学术拼写错误 → 正确形）
 *     与 CONFUSABLES（易混词对：wrong=常见误用形，right=建议，hint=中文一句说明；
 *     高频歧义词（their/its/then/less…）带上下文守卫 guard——suffix/prefix/always，
 *     只有邻接词满足守卫才标注，抑制正当用法的一片黄线噪音；
 *     无语境即可判错的条目（discuss about / researches 等）保持全标）；
 *  2. checkText 纯函数：整词匹配（词边界）、大小写不敏感（保留原文 span、建议随原文大小写），
 *     跳过行内注释（% 之后，复用 outline.ts 的 stripLineComment）与 \命令
 *     （反斜杠后连续字母整体跳过，\cite/\ref 参数键名本身不会命中词表）；
 *  3. spellcheckExtension：StateField 全量扫描装饰（sf-spell / sf-spell-conf 波浪线，
 *     颜色走 var(--err)/var(--warn) 亮暗双主题变量带 fallback）+ hoverTooltip 悬浮建议。
 */

import { EditorView, hoverTooltip, Decoration, type DecorationSet } from '@codemirror/view';
import { StateField, type Extension } from '@codemirror/state';
import { stripLineComment } from './latex/outline';

// ---------------------------------------------------------------------------
// 词表
// ---------------------------------------------------------------------------

/** 常见学术拼写错误 → 正确形（键为小写错误形，整词匹配） */
export const MISSPELLINGS: Record<string, string> = {
  // —— 需求指定的核心集 ——
  recieve: 'receive',
  seperate: 'separate',
  occured: 'occurred',
  wich: 'which',
  teh: 'the',
  adress: 'address',
  enviroment: 'environment',
  independant: 'independent',
  arguement: 'argument',
  beleive: 'believe',
  calender: 'calendar',
  comittee: 'committee',
  consistant: 'consistent',
  definately: 'definitely',
  dissapoint: 'disappoint',
  embarass: 'embarrass',
  existance: 'existence',
  occurence: 'occurrence',
  personnal: 'personal',
  posession: 'possession',
  prefered: 'preferred',
  priviledge: 'privilege',
  publically: 'publicly',
  recomend: 'recommend',
  refered: 'referred',
  reponse: 'response',
  resistent: 'resistant',
  succesful: 'successful',
  supress: 'suppress',
  targer: 'target',
  threshhold: 'threshold',
  untill: 'until',
  wether: 'whether',
  // —— 学术写作补充集 ——
  accomodate: 'accommodate',
  acheive: 'achieve',
  acknowlege: 'acknowledge',
  agressive: 'aggressive',
  apparant: 'apparent',
  basicly: 'basically',
  begining: 'beginning',
  benifit: 'benefit',
  collegue: 'colleague',
  commited: 'committed',
  concious: 'conscious',
  curiousity: 'curiosity',
  descision: 'decision',
  dependant: 'dependent',
  diffrent: 'different',
  dilemna: 'dilemma',
  disapear: 'disappear',
  efficent: 'efficient',
  equiptment: 'equipment',
  exagerate: 'exaggerate',
  excercise: 'exercise',
  familar: 'familiar',
  finaly: 'finally',
  flourescent: 'fluorescent',
  foriegn: 'foreign',
  fourty: 'forty',
  freind: 'friend',
  grammer: 'grammar',
  harrassment: 'harassment',
  hierachy: 'hierarchy',
  ideosyncratic: 'idiosyncratic',
  immediatly: 'immediately',
  incidently: 'incidentally',
  intergrated: 'integrated',
  intergration: 'integration',
  irrelevent: 'irrelevant',
  knowlege: 'knowledge',
  labratory: 'laboratory',
  maintainance: 'maintenance',
  managment: 'management',
  millenium: 'millennium',
  neccessary: 'necessary',
  negociate: 'negotiate',
  noticable: 'noticeable',
  ommission: 'omission',
  persistant: 'persistent',
  phenomenom: 'phenomenon',
  possibilites: 'possibilities',
  questionaire: 'questionnaire',
  reasearch: 'research',
  relevent: 'relevant',
  repitition: 'repetition',
  similiar: 'similar',
  statment: 'statement',
  supercede: 'supersede',
  suprise: 'surprise',
  tendancy: 'tendency',
  thruout: 'throughout',
  transfered: 'transferred',
  uncertainity: 'uncertainty',
  useage: 'usage',
  varient: 'variant',
  yeild: 'yield',
};

/**
 * 易混词对：wrong=整词命中的常见误用形，right=建议替换，hint=中文提示（语境相关，需人工判断）。
 *
 * 上下文守卫（D8 修复：无语境全标会让每个正当 their/its/then/less 都画黄线，噪音淹没真信号）：
 *  - guard 缺省或 'always'：无语境条件，命中即标（短语自带语境、或无语境即可判错的条目）；
 *  - guard='suffix'：仅当命中后紧跟 follow 中任一词才标。follow 支持多词条（如 'of people'），
 *    实现为「其后至多 3 个字母词、空白归一」的前缀匹配；followNum=true 时后接数字亦算满足；
 *  - guard='prefix'：仅当命中前紧邻 precede 中任一词才标；
 *  - suffix 模式下若另给 precede，则前后条件须同时满足（affect：the affect of）。
 * 守卫不满足 → 跳过该命中（不产生 issue，hover/装饰自然不出现）。
 * follow/precede 缺失或为空表时守卫一律不通过（fail-closed：宁可漏报，不再误报）。
 */
export interface Confusable {
  wrong: string;
  right: string;
  hint: string;
  /** 上下文守卫模式：'always'（缺省）=无条件标注；'suffix'=后接 follow 词才标；'prefix'=前接 precede 词才标 */
  guard?: 'suffix' | 'prefix' | 'always';
  /** guard='suffix' 的后接词表（小写；词条可含空格表示多词邻接，如 'of people'） */
  follow?: string[];
  /** guard='prefix' 的前接词表（小写）；suffix 模式下给出时须前后同时满足 */
  precede?: string[];
  /** guard='suffix' 时：命中后（跳过空白）紧跟数字也算满足守卫（between 3 → 应用 among/改写） */
  followNum?: boolean;
}

export const CONFUSABLES: Confusable[] = [
  {
    wrong: 'their',
    right: 'there',
    hint: 'their 是物主代词「他们的」；指地点或存在句「那里」应为 there。需结合语境人工判断',
    // D8：仅 their is/are/was/were/been/being（→ there be 存在句误写）才标；
    // their results 等正当物主用法不标；「theirs is」场景明确不做
    guard: 'suffix',
    follow: ['is', 'are', 'was', 'were', 'been', 'being'],
  },
  {
    wrong: 'affect',
    right: 'effect',
    hint: '作名词「效果/影响」多用 effect；affect 多作动词「影响」。需按词性人工判断',
    // D8：仅 the/this/an + affect + of（名词短语误写 the affect of → the effect of）才标；
    // 动词用法（may affect）与 The affect is large 不标
    guard: 'suffix',
    follow: ['of'],
    precede: ['the', 'this', 'an'],
  },
  {
    wrong: 'then',
    right: 'than',
    hint: '比较搭配用 than（more ... than）；then 是「然后/那时」',
    // D8：仅前接比较级标记（more then → more than）才标；and then 等时序用法不标
    guard: 'prefix',
    precede: [
      'more', 'less', 'better', 'worse', 'faster', 'slower', 'higher', 'lower',
      'bigger', 'smaller', 'larger', 'older', 'newer',
    ],
  },
  {
    wrong: 'its',
    right: "it's",
    hint: "its 是物主代词；it's = it is / it has。若意为「它是」应为 it's。需人工判断",
    // D8：仅 its a/an/the/being（its a → it's a）才标；its result 等正当物主用法不标
    guard: 'suffix',
    follow: ['a', 'an', 'the', 'being'],
  },
  {
    wrong: 'principle',
    right: 'principal',
    hint: 'principle 是「原理/原则」；principal 是「主要的/校长」。若表「主要的」应为 principal',
    // D8：仅 principal 惯用搭配（principle investigator/component …）才标；
    // the principle of relativity 等「原理」本义不标——本义用法在该词中占多数
    guard: 'suffix',
    follow: [
      'investigator', 'component', 'components', 'reason', 'concern',
      'driver', 'cause', 'axis', 'axes', 'direction',
    ],
  },
  // compliment 保持 always：学术语料中「称赞」义极罕见，命中即为高置信误写信号，低频无噪音
  { wrong: 'compliment', right: 'complement', hint: 'complement 是「补充/互补」；compliment 是「称赞」。学术语境多为 complement' },
  {
    wrong: 'less',
    right: 'fewer',
    hint: '可数复数名词用 fewer（fewer samples）；不可数用 less（less data）。需人工判断',
    // D8：仅后接复数可数提示词（less items → fewer items，通用 12 词清单）才标；
    // less water / less data 等不可数用法不标
    guard: 'suffix',
    follow: [
      'items', 'users', 'files', 'papers', 'people', 'days',
      'samples', 'cases', 'records', 'variables', 'parameters', 'words',
    ],
  },
  {
    wrong: 'between',
    right: 'among',
    hint: '两者之间用 between；三者及以上用 among。需按对象数量人工判断',
    // D8：仅后接数字（between 3 groups）或 each（between each pair）才标轻提示；
    // between the two methods 等正当用法不标
    guard: 'suffix',
    follow: ['each'],
    followNum: true,
  },
  // eg/ie 保持 always：缩写本身就是非规范写法，命中即错，无语境歧义
  { wrong: 'eg', right: 'e.g.', hint: '「例如」的拉丁缩写规范写法为 e.g.（exempli gratia），不宜写作 eg' },
  { wrong: 'ie', right: 'i.e.', hint: '「即/也就是说」的拉丁缩写规范写法为 i.e.（id est），不宜写作 ie' },
  // 以下短语条目自带语境（整短语即误用模式），保持 always，无需守卫
  { wrong: 'based in', right: 'based on', hint: '「基于……」应为 based on；based in 表示「位于（某地）」' },
  { wrong: 'consist in', right: 'consist of', hint: '「由……组成/构成」用 consist of；consist in 表「在于」' },
  // continual 保持 always：正确义「反复发生」（continual interruptions）与误用「连续不断」
  // （continual monitoring）在词级邻接上无可靠区分信号，强行守卫会大量漏报；词条本身低频，全标噪音可控
  { wrong: 'continual', right: 'continuous', hint: 'continuous 指连续不间断；continual 指反复发生。描述连续量/过程多用 continuous' },
  {
    wrong: 'amount',
    right: 'number',
    hint: '可数复数用 the number of；不可数用 the amount of。需人工判断',
    // D8：仅 amount of 可数复数（the amount of people → the number of）才标；
    // amount of memory/data 等不可数用法不标
    guard: 'suffix',
    follow: ['of people', 'of persons', 'of items', 'of users'],
  },
  // compared to / data is 保持 always：短语即完整误用模式（学术惯用 compared with；data 复数）
  { wrong: 'compared to', right: 'compared with', hint: '学术上对比两者差异惯用 compared with；compared to 多表比喻。需人工判断' },
  { wrong: 'data is', right: 'data are', hint: 'data 是复数（单数 datum），正式学术写作多用 data are。需人工判断' },
  {
    wrong: 'loose',
    right: 'lose',
    hint: '动词「丢失/失去」是 lose；loose 是形容词「松的」',
    // D8：仅后接 to（loose to → lose to）才标；loose weight（应为 lose weight，
    // 但 loose 后无 to）与 a loose fit 等形容词用法不标
    guard: 'suffix',
    follow: ['to'],
  },
  {
    wrong: 'farther',
    right: 'further',
    hint: '表抽象程度「进一步」用 further；farther 限于物理距离。学术写作多用 further',
    // D8：仅后接抽象名词搭配（farther analysis → further analysis）才标；
    // 物理距离义（the farther sample / looked farther）不标
    guard: 'suffix',
    follow: [
      'analysis', 'investigation', 'experiments', 'research', 'work',
      'study', 'studies', 'discussion', 'details', 'training', 'improvement',
    ],
  },
  // assure 保持 always：学术文中「向某人保证」义极少出现，命中多为 ensure 误写，低频无噪音
  { wrong: 'assure', right: 'ensure', hint: 'ensure 是「确保（某事发生）」；assure 是「向某人保证」。学术语境多为 ensure' },
  // 以下固定搭配错误无语境歧义，保持 always
  { wrong: 'in the other hand', right: 'on the other hand', hint: '固定搭配是 on the other hand（另一方面）' },
  { wrong: 'discuss about', right: 'discuss', hint: 'discuss 是及物动词，直接接宾语，不加 about' },
  { wrong: 'researches', right: 'studies', hint: 'research 不可数、无复数；表多项研究惯用 studies' },
  { wrong: 'informations', right: 'information', hint: 'information 不可数，无复数形式' },
  { wrong: 'according with', right: 'according to', hint: '固定搭配是 according to（根据……）' },
  { wrong: 'comprise of', right: 'comprise', hint: 'comprise 本身已含「由……组成」之意，不再加 of（或改用 be composed of）' },
  { wrong: 'different than', right: 'different from', hint: '「与……不同」的规范搭配是 different from' },
];

// ---------------------------------------------------------------------------
// 纯函数检查
// ---------------------------------------------------------------------------

/** 一处检查发现（from/to 为全文偏移，word 保留原文大小写） */
export interface SpellIssue {
  from: number;
  to: number;
  word: string;
  suggestion: string;
  hint?: string;
  kind: 'misspelling' | 'confusable';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiLetter(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** 把词表编译成单个整词匹配正则（长词在前，规避前缀短路；空格容忍多空白） */
function buildMatcher(words: string[]): RegExp {
  const alt = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => escapeRe(w).replace(/\\?\s+/g, '\\s+'))
    .join('|');
  return new RegExp(`\\b(?:${alt})\\b`, 'gi');
}

/**
 * 掩蔽反斜杠命令：`\` 后连续字母（\textbf、\cite 等）整体替换为空格；
 * `\` 后非字母（\% \\ \$ 等转义）连反斜杠掩蔽两字符。长度不变，偏移保持有效。
 */
function maskCommands(code: string): string {
  if (!code.includes('\\')) return code;
  const chars = code.split('');
  let i = 0;
  while (i < chars.length) {
    if (chars[i] !== '\\') {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < chars.length && isAsciiLetter(chars[j])) j++;
    const end = j > i + 1 ? j : Math.min(i + 2, chars.length);
    for (let k = i; k < end; k++) chars[k] = ' ';
    i = end;
  }
  return chars.join('');
}

/** 建议词随原文大小写：全大写（多字符）→ 全大写；首字母大写 → 首字母大写；否则原样 */
function matchCase(source: string, replacement: string): string {
  if (source.length > 1 && source === source.toUpperCase()) return replacement.toUpperCase();
  const first = source.charAt(0);
  if (first !== first.toLowerCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

// ---------------------------------------------------------------------------
// 上下文守卫（D8：易混词无语境全标 → 仅高置信语境才标）
// ---------------------------------------------------------------------------

/** 命中前紧邻的字母词（跨多空白回溯；紧邻标点/行首则无前邻词），小写 */
function wordBefore(s: string, from: number): string {
  let i = from;
  while (i > 0 && /\s/.test(s.charAt(i - 1))) i--;
  const end = i;
  while (i > 0 && isAsciiLetter(s.charAt(i - 1))) i--;
  return i < end ? s.slice(i, end).toLowerCase() : '';
}

/**
 * 命中后紧随的字母词组：跳过多空白后取至多 3 个连续字母词（空白归一为单空格），
 * 遇标点/数字/行尾即止。小写返回。如 '  a   mistake, and' → 'a mistake'。
 * 支持多词守卫词条（amount 的 'of people'）与标点截断（'their, for' 取不到前邻/后邻）。
 */
function wordsAfter(s: string, to: number): string {
  let i = to;
  const out: string[] = [];
  while (out.length < 3) {
    while (i < s.length && /\s/.test(s.charAt(i))) i++;
    const start = i;
    while (i < s.length && isAsciiLetter(s.charAt(i))) i++;
    if (i === start) break;
    out.push(s.slice(start, i));
  }
  return out.join(' ').toLowerCase();
}

/** 命中后（跳过多空白）是否紧跟数字（between 3） */
function digitAfter(s: string, to: number): boolean {
  let i = to;
  while (i < s.length && /\s/.test(s.charAt(i))) i++;
  const ch = s.charAt(i);
  return ch >= '0' && ch <= '9';
}

/**
 * 易混词守卫判定（在掩蔽后的行文本上做行内邻接检查，跨行语境不检查）：
 *  - always/缺省：直接通过（无语境条件）；
 *  - prefix：前邻词 ∈ precede；
 *  - suffix：后随词组与 follow 任一词相等或以其为前缀（整词级，'application' 不会误配 'a'），
 *    followNum=true 时后接数字也算；若另给 precede（affect）则前后须同时满足。
 * 守卫词表缺失或为空 → 不通过（fail-closed：宁可漏报，不再误报）。
 */
function passesGuard(s: string, from: number, to: number, e: Confusable): boolean {
  const mode = e.guard ?? 'always';
  if (mode === 'always') return true;
  const precedeOk = (): boolean => (e.precede ?? []).length > 0 && (e.precede ?? []).includes(wordBefore(s, from));
  if (mode === 'prefix') return precedeOk();
  const next = wordsAfter(s, to);
  const suffixHit =
    (e.follow ?? []).some((f) => next === f || next.startsWith(`${f} `)) ||
    (e.followNum === true && digitAfter(s, to));
  return suffixHit && (e.precede === undefined || (e.precede ?? []).length === 0 || precedeOk());
}

function collect(
  masked: string,
  base: number,
  re: RegExp,
  kind: 'misspelling' | 'confusable',
  issues: SpellIssue[],
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(masked)) !== null) {
    const raw = m[0];
    const from = base + m.index;
    const to = from + raw.length;
    if (kind === 'misspelling') {
      const suggestion = MISSPELLINGS[raw.toLowerCase()];
      if (suggestion) issues.push({ from, to, word: raw, suggestion: matchCase(raw, suggestion), kind });
    } else {
      // 短语命中时 raw 内空白可能是多个（\s+ 容忍），按单空格规范化后再查表
      const key = raw.toLowerCase().replace(/\s+/g, ' ');
      const entry = CONFUSABLES.find((c) => c.wrong.toLowerCase() === key);
      // D8：带守卫的条目须邻接语境满足才产生 issue（守卫用行内相对偏移查上下文）
      if (entry && passesGuard(masked, m.index, m.index + raw.length, entry)) {
        issues.push({ from, to, word: raw, suggestion: matchCase(raw, entry.right), hint: entry.hint, kind });
      }
    }
    if (re.lastIndex === m.index) re.lastIndex++; // 防御零宽匹配死循环
  }
}

/**
 * 检查整段文本：逐行剥离注释、掩蔽命令后整词匹配两张词表。
 * 易混词命中后按词条 guard 检查行内邻接上下文（小写、容忍多空白），守卫不满足则跳过（D8）。
 * 输出按 from 升序；交叠命中（词表冲突的防御路径）只保留先出现者。
 */
export function checkText(text: string): SpellIssue[] {
  const issues: SpellIssue[] = [];
  // 正则按调用重建（g 标志 lastIndex 与重入无关，纯函数更安全，与 lint.ts 同约定）
  const missRe = buildMatcher(Object.keys(MISSPELLINGS));
  const confRe = buildMatcher(CONFUSABLES.map((c) => c.wrong));

  const lines = text.split('\n');
  let offset = 0;
  for (const line of lines) {
    const code = stripLineComment(line);
    if (/[A-Za-z]/.test(code)) {
      const masked = maskCommands(code);
      collect(masked, offset, missRe, 'misspelling', issues);
      collect(masked, offset, confRe, 'confusable', issues);
    }
    offset += line.length + 1;
  }

  issues.sort((a, b) => a.from - b.from || a.to - b.to);
  const out: SpellIssue[] = [];
  let lastTo = -1;
  for (const iss of issues) {
    if (iss.from < lastTo) continue; // 交叠防御：跳过与已保留项交叠的命中
    out.push(iss);
    lastTo = iss.to;
  }
  return out;
}

// ---------------------------------------------------------------------------
// CodeMirror 扩展
// ---------------------------------------------------------------------------

const MISS_CLASS = 'sf-spell';
const CONF_CLASS = 'sf-spell-conf';

function marksFor(text: string): DecorationSet {
  return Decoration.set(
    checkText(text).map((iss) =>
      Decoration.mark({ class: iss.kind === 'confusable' ? CONF_CLASS : MISS_CLASS }).range(iss.from, iss.to),
    ),
  );
}

/** 全文扫描的标注集合：文档变化时重算，其余事务仅随变更映射位置 */
const spellField = StateField.define<DecorationSet>({
  create: (state) => marksFor(state.doc.toString()),
  update: (marks, tr) => (tr.docChanged ? marksFor(tr.state.doc.toString()) : marks.map(tr.changes)),
  provide: (f) => EditorView.decorations.from(f),
});

/** 波浪线样式：拼写=err 红、用词=warn 黄；颜色走主题 CSS 变量，fallback 兼容亮暗 */
const spellTheme = EditorView.baseTheme({
  [`.${MISS_CLASS}`]: {
    textDecoration: 'underline wavy var(--err, #d9534f)',
    textUnderlineOffset: '2px',
    cursor: 'help',
  },
  [`.${CONF_CLASS}`]: {
    textDecoration: 'underline wavy var(--warn, #b8860b)',
    textUnderlineOffset: '2px',
    cursor: 'help',
  },
});

/** 悬停标注词：浮层显示「原词 → 建议（拼写/用词）」+ 中文提示 */
function spellHover(): Extension {
  return hoverTooltip((view, pos) => {
    const hit = checkText(view.state.doc.toString()).find((i) => pos >= i.from && pos <= i.to);
    if (!hit) return null;
    return {
      pos: hit.from,
      end: hit.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'sf-spell-hover';
        // 内联样式承载浮层外观（复用 mathHoverTooltip 模式，不新增 CSS 文件）
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
        const arrow = document.createElement('span');
        arrow.textContent = ' → ';
        const right = document.createElement('strong');
        right.textContent = hit.suggestion;
        const tag = document.createElement('span');
        tag.textContent = hit.kind === 'misspelling' ? '（拼写）' : '（用词）';
        tag.style.opacity = '0.85';
        head.append(wrong, arrow, right, tag);
        dom.append(head);

        if (hit.hint) {
          const hint = document.createElement('div');
          hint.textContent = hit.hint;
          hint.style.opacity = '0.85';
          dom.append(hint);
        }
        return { dom };
      },
    };
  });
}

/**
 * 拼写与用词检查扩展：enabled=false 时返回空扩展（由宿主经 Compartment/重建切换）。
 * 附 StateField 标注 + baseTheme 波浪线 + hoverTooltip 悬浮建议。
 */
export function spellcheckExtension(enabled: boolean): Extension {
  return enabled ? [spellField, spellTheme, spellHover()] : [];
}
