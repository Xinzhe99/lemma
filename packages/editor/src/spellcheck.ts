/**
 * 拼写与学术用词检查：内置词表 + 纯函数检查 + CodeMirror 6 扩展。
 *
 * 三部分：
 *  1. 词表（手写内置，零外部依赖）：MISSPELLINGS（常见学术拼写错误 → 正确形）
 *     与 CONFUSABLES（易混词对：wrong=常见误用形，right=建议，hint=中文一句说明，
 *     语境相关、不做语法分析，需作者人工判断）；
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

/** 易混词对：wrong=整词命中的常见误用形，right=建议替换，hint=中文提示（语境相关，需人工判断） */
export interface Confusable {
  wrong: string;
  right: string;
  hint: string;
}

export const CONFUSABLES: Confusable[] = [
  { wrong: 'their', right: 'there', hint: 'their 是物主代词「他们的」；指地点或存在句「那里」应为 there。需结合语境人工判断' },
  { wrong: 'affect', right: 'effect', hint: '作名词「效果/影响」多用 effect；affect 多作动词「影响」。需按词性人工判断' },
  { wrong: 'then', right: 'than', hint: '比较搭配用 than（more ... than）；then 是「然后/那时」' },
  { wrong: 'its', right: "it's", hint: "its 是物主代词；it's = it is / it has。若意为「它是」应为 it's。需人工判断" },
  { wrong: 'principle', right: 'principal', hint: 'principle 是「原理/原则」；principal 是「主要的/校长」。若表「主要的」应为 principal' },
  { wrong: 'compliment', right: 'complement', hint: 'complement 是「补充/互补」；compliment 是「称赞」。学术语境多为 complement' },
  { wrong: 'less', right: 'fewer', hint: '可数复数名词用 fewer（fewer samples）；不可数用 less（less data）。需人工判断' },
  { wrong: 'between', right: 'among', hint: '两者之间用 between；三者及以上用 among。需按对象数量人工判断' },
  { wrong: 'eg', right: 'e.g.', hint: '「例如」的拉丁缩写规范写法为 e.g.（exempli gratia），不宜写作 eg' },
  { wrong: 'ie', right: 'i.e.', hint: '「即/也就是说」的拉丁缩写规范写法为 i.e.（id est），不宜写作 ie' },
  { wrong: 'based in', right: 'based on', hint: '「基于……」应为 based on；based in 表示「位于（某地）」' },
  { wrong: 'consist in', right: 'consist of', hint: '「由……组成/构成」用 consist of；consist in 表「在于」' },
  { wrong: 'continual', right: 'continuous', hint: 'continuous 指连续不间断；continual 指反复发生。描述连续量/过程多用 continuous' },
  { wrong: 'amount', right: 'number', hint: '可数复数用 the number of；不可数用 the amount of。需人工判断' },
  { wrong: 'compared to', right: 'compared with', hint: '学术上对比两者差异惯用 compared with；compared to 多表比喻。需人工判断' },
  { wrong: 'data is', right: 'data are', hint: 'data 是复数（单数 datum），正式学术写作多用 data are。需人工判断' },
  { wrong: 'loose', right: 'lose', hint: '动词「丢失/失去」是 lose；loose 是形容词「松的」' },
  { wrong: 'farther', right: 'further', hint: '表抽象程度「进一步」用 further；farther 限于物理距离。学术写作多用 further' },
  { wrong: 'assure', right: 'ensure', hint: 'ensure 是「确保（某事发生）」；assure 是「向某人保证」。学术语境多为 ensure' },
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
      if (entry) {
        issues.push({ from, to, word: raw, suggestion: matchCase(raw, entry.right), hint: entry.hint, kind });
      }
    }
    if (re.lastIndex === m.index) re.lastIndex++; // 防御零宽匹配死循环
  }
}

/**
 * 检查整段文本：逐行剥离注释、掩蔽命令后整词匹配两张词表。
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
