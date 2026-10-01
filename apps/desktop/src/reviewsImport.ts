/**
 * 真实审稿意见导入（W7 Rebuttal 的输入侧）：
 * - parseReviewsText：把粘贴 / Word / PDF 提取出的"混乱真实世界"审稿文本宽容地
 *   拆为 按审稿人分组的结构化条目（分层降级：审稿人分隔 → 编号拆条 → 小节头
 *   type 映射 → 无编号段落降级），并剔除编辑信套话与页眉页脚重复行。
 * - reviewsToWorkflowInput：拼成 W7 约定的 reviews 变量文本（【Reviewer N】+ R{n}.{k}:）。
 * - parseReviewsFiles / renumberReviews：多文件（一人一文件）合并与编号重整。
 * - extractDocxText：最小 .docx 文本提取器（zip → word/document.xml → 剥标签）。
 *
 * 本模块保持纯函数（不依赖 React / store / pdfjs），便于 Node 端直测。
 */

import { unzipSync } from 'fflate';

export type ReviewItemType = 'weakness' | 'question' | 'comment' | 'minor';

export interface ReviewItem {
  /** 统一重整后的编号：R{审稿人号}.{序号} */
  id: string;
  text: string;
  type?: ReviewItemType;
}

export interface ParsedReview {
  reviewer: string;
  items: ReviewItem[];
  raw: string;
}

// ---------------------------------------------------------------------------
// 噪音过滤（编辑信套话 / 页眉页脚重复行）
// ---------------------------------------------------------------------------

/** 编辑信套话与礼节性行（整行剔除；不碰正文叙述句） */
const NOISE_LINE_RE = [
  /^(dear|to)\s+(the\s+)?(author|authors|reviewer|reviewers|dr\.?|professor|prof\.?|editor)/i,
  /^thanks?\b[^.\n]{0,60}(submitting|submission|your manuscript|opportunity|invitation)/i,
  /^thank you\b[^.\n]{0,60}(submitting|submission|your manuscript|opportunity|invitation)/i,
  /^(sincerely|best regards|kind regards|warm regards|yours sincerely|respectfully)[,!.。]?\s*$/i,
  /^(the\s+)?(editors?|editorial\s+(office|board)|editor-in-chief|managing editor)[,!.。]?\s*$/i,
  /^(on behalf of|we look forward to)\b/i,
  /^(尊敬的作者|尊敬的教授|尊敬的编辑部|此致敬礼|此致|敬礼)[!！，,。.]?\s*$/,
  /^感谢(您|你)(提交|投稿|的稿件)[^。\n]{0,40}?[。.]?\s*$/,
  /^(manuscript|article|paper|journal|editor)\s*(id|number|no\.?|#)?\s*[:：]/i,
];

/** 纯装饰分隔线（----- / ===== / *****） */
const DECORATION_LINE_RE = /^[\s=\-*_~#>]{3,}$/;

/** 文件名中的页眉页脚去重阈值：数字化占位后出现 ≥3 次的整行视为页眉/页脚 */
const REPEAT_LINE_THRESHOLD = 3;

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return NOISE_LINE_RE.some((re) => re.test(t));
}

/** 剔除套话行；页眉页脚重复行（数字归一后仍相同的整行，如 "Page 2 of 8"）整类去除 */
function removeNoise(text: string): string {
  const lines = text.split(/\r\n?|\n/);
  const counts = new Map<string, number>();
  for (const line of lines) {
    const t = line.trim();
    if (t.length < 6) continue; // 太短的行不作为页眉页脚候选
    const key = t.replace(/\d+/g, '#');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = new Set(
    [...counts.entries()].filter(([, n]) => n >= REPEAT_LINE_THRESHOLD).map(([k]) => k),
  );
  return lines
    .filter((line) => {
      if (isNoiseLine(line)) return false;
      const t = line.trim();
      if (t.length >= 6 && repeated.has(t.replace(/\d+/g, '#'))) return false;
      return true;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// 审稿人分段
// ---------------------------------------------------------------------------

interface ReviewerBlock {
  number: number;
  raw: string;
}

/** 剥掉行的首尾装饰（=== / --- / *** / # / 引用符） */
function stripDecorations(line: string): string {
  return line.replace(/^[\s=\-*_~#>]+/, '').replace(/[\s=\-*_~<]+$/, '').trim();
}

const REVIEWER_PREFIX_RE = /^(?:reviewer|referee|审稿人)\s*#?\s*(\d+)\s*(.*)$/i;
/** 审稿人标题行尾巴允许出现的词（"Reviewer 2 Comments:" / "审稿人1意见："） */
const REVIEWER_TAIL_RE = /^(?:comments?|review|意见|审稿意见|评审意见|报告|回复)?[\s:：、,.．\-—]*$/i;
/** "R1: 正文" 形式（必须带冒号，避免与条目编号 R1.1 混淆） */
const REVIEWER_RN_COLON_RE = /^[Rr](\d{1,2})\s*[:：]\s*(.*)$/;
/** 装饰包裹的裸 "R2"（**R2** / === R2 ===） */
const REVIEWER_RN_BARE_RE = /^[Rr]\d{1,2}$/;

/**
 * 识别一行是否为审稿人分隔头。
 * 返回 [审稿人号, 行内剩余内容（如 "R1: The intro..." 中冒号后的正文）]。
 * 注意 "R1.1 xxx" 是条目编号：只有带冒号的 R1:/R1： 或裸 R1 才算分隔头。
 */
function matchReviewerHeader(line: string): [number, string] | null {
  const bare = stripDecorations(line);
  if (!bare) return null;

  const m1 = REVIEWER_PREFIX_RE.exec(bare);
  if (m1) {
    const tail = m1[2] ?? '';
    if (REVIEWER_TAIL_RE.test(tail)) return [Number(m1[1]), ''];
    // "Reviewer 2: 正文…" —— 尾巴以冒号起头时视为「分隔头 + 同行正文」；
    // "Reviewer 2 said…" 这类叙述行（无冒号）不算分隔头
    if (/^\s*[:：]/.test(tail)) {
      return [Number(m1[1]), tail.replace(/^\s*[:：、,.．\-—\s]+/, '')];
    }
    return null;
  }

  const m2 = REVIEWER_RN_COLON_RE.exec(bare);
  if (m2) return [Number(m2[1]), (m2[2] ?? '').trim()];

  if (REVIEWER_RN_BARE_RE.test(bare)) return [Number(bare.slice(1)), ''];
  return null;
}

function splitReviewers(cleaned: string): ReviewerBlock[] {
  const lines = cleaned.split('\n');
  const blocks: Array<{ number: number; lines: string[] }> = [];
  let current: { number: number; lines: string[] } | null = null;
  for (const line of lines) {
    const header = matchReviewerHeader(line);
    if (header) {
      const [num, rest] = header;
      current = { number: num, lines: rest ? [rest] : [] };
      blocks.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }

  // 无分隔符时整体作为一个 Reviewer 1
  if (blocks.length === 0) return [{ number: 1, raw: lines.join('\n') }];
  return blocks.map((b) => ({ number: b.number, raw: b.lines.join('\n') }));
}

// ---------------------------------------------------------------------------
// 逐条拆分（编号 → 小节头 → 段落降级）
// ---------------------------------------------------------------------------

/** 小节头 → 条目类型；映射表顺序即优先级 */
const SECTION_PATTERNS: Array<{ re: RegExp; type: ReviewItemType }> = [
  {
    re: /^(?:weakness(?:es)?|weak\s*points?|major\s*(?:concerns?|weakness(?:es)?|issues?)|concerns?|criticisms?|缺点|弱项|不足|主要(?:缺点|问题|不足))$/i,
    type: 'weakness',
  },
  {
    re: /^(?:questions?|问题|疑问|提问|质询|询问)$/i,
    type: 'question',
  },
  {
    re: /^(?:minor(?:\s+(?:comments?|issues?|points?|revisions?|concerns?))?|小修|细节(?:问题)?|次要(?:问题|意见))$/i,
    type: 'minor',
  },
  // 优点/亮点等小节的条目按通用意见处理（type 联合里没有 strengths）
  {
    re: /^(?:strengths?|advantages?|merits?|优点|亮点|强项)$/i,
    type: 'comment',
  },
  {
    re: /^(?:comments?|general\s*comments?|remarks?|overall(?:\s+(?:assessment|comments?))?|summary|总评|意见|审稿意见|评审意见|概述|摘要|其他)$/i,
    type: 'comment',
  },
];

/** 剥掉标题行的装饰：#、列表标记、强调符号（不带结尾冒号，冒号由行内式处理） */
function normalizeHeading(line: string): string {
  return line
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\s*[-*+>]+\s*/, '')
    .replace(/[*_`]+/g, '')
    .replace(/[：:]\s*$/, '')
    .trim();
}

function matchSectionType(stripped: string): ReviewItemType | null {
  if (!stripped) return null;
  for (const { re, type } of SECTION_PATTERNS) {
    if (re.test(stripped)) return type;
  }
  return null;
}

/**
 * 编号条目起始模式（i 标志：Comment/Comment 通用）：
 * 1. / 1、/ 1) / （1） / 一、 / Comment 1: / 意见2： / W1.2 / R1.1 / Q3:
 * （"1." 后跟数字视为小数而非编号，避免把 "1.5 line spacing" 拆条）
 */
const ITEM_NUMBERED_RE = new RegExp(
  [
    '^(\\d{1,3})[)）．、]', // 1) 1、1．
    '^(\\d{1,3})[.](?!\\d)', // 1.（后不接数字）
    '^[(（\\[]\\s*(\\d{1,3})\\s*[)）\\]]', // (1) [1] （1）
    '^([一二三四五六七八九十]{1,3})\\s*[、.．:：)）]', // 一、 二：
    '^(?:comment|concern|point|issue|objection|remark|意见|问题)\\s*(\\d{1,3})\\s*[.、:：)）]', // Comment 1: / 意见1：
    '^[WwRr](\\d{1,2})\\.(\\d{1,3})\\s*[.、:：)]?', // W1.2 / R1.1
    '^[Qq](\\d{1,3})\\s*[.、:：)）]', // Q1:
  ].join('|'),
  'i',
);

/** 无编号的列表符号行（- xxx / • xxx）也算一条新条目 */
const ITEM_BULLET_RE = /^[-*•·◦‣][\s]+(.*)$/;

interface DraftItem {
  type?: ReviewItemType;
  lines: string[];
}

/** 把单个审稿人块拆为条目（保留小节头带来的 type；小节头本身不产生条目） */
function splitItems(raw: string): Array<{ type?: ReviewItemType; text: string }> {
  const lines = raw.split('\n');
  const items: DraftItem[] = [];
  let sectionType: ReviewItemType | undefined;
  let openNumbered: DraftItem | null = null; // 编号条目开启（后续行软换行合并）
  let paragraph: DraftItem | null = null; // 无编号段落缓冲（连续短行合并，空行分界）

  const closeParagraph = (): void => {
    if (paragraph) {
      items.push(paragraph);
      paragraph = null;
    }
  };
  const closeAll = (): void => {
    closeParagraph();
    openNumbered = null;
  };

  /** 处理一行"内容"（已剥掉小节头/编号符的剩余部分可能是空） */
  const pushContent = (text: string, asNewItem: boolean): void => {
    const t = text.trim();
    if (!t) return;
    if (asNewItem || !openNumbered) {
      closeParagraph();
      openNumbered = { type: sectionType, lines: [t] };
      items.push(openNumbered);
    } else {
      openNumbered.lines.push(t);
    }
  };

  const processLine = (line: string): void => {
    if (!line.trim()) {
      // 空行：段落分界（也结束编号条目，下一段无编号文字按新段落降级处理）
      closeAll();
      return;
    }
    if (DECORATION_LINE_RE.test(line)) return;

    // 小节头：独立标题行（## Weaknesses / **缺点**）或行内式（Weaknesses: 1) ...）
    const sepIdx = line.search(/[：:]/);
    if (sepIdx > 0) {
      const headStripped = normalizeHeading(line.slice(0, sepIdx));
      const inlineType = matchSectionType(headStripped);
      if (inlineType) {
        sectionType = inlineType;
        const inline = line.slice(sepIdx + 1).trim();
        if (inline) processLine(inline);
        else closeAll(); // 独立标题行（"Weaknesses:"）
        return;
      }
    }
    const headingType = matchSectionType(normalizeHeading(line));
    if (headingType) {
      sectionType = headingType;
      closeAll();
      return; // 小节头本身不产生条目
    }

    // 编号条目
    if (ITEM_NUMBERED_RE.test(line.trim())) {
      const rest = line.trim().replace(ITEM_NUMBERED_RE, '').trim();
      closeParagraph();
      openNumbered = { type: sectionType, lines: [] };
      items.push(openNumbered);
      if (rest) openNumbered.lines.push(rest);
      return;
    }

    // 列表符号行（新条目）
    const bullet = ITEM_BULLET_RE.exec(line.trim());
    if (bullet) {
      closeParagraph();
      openNumbered = { type: sectionType, lines: [] };
      items.push(openNumbered);
      if (bullet[1]!.trim()) openNumbered.lines.push(bullet[1]!.trim());
      return;
    }

    // 普通行：并入开启中的编号条目（软换行），否则并入段落缓冲
    const t = line.trim();
    if (openNumbered) {
      openNumbered.lines.push(t);
      return;
    }
    paragraph ??= { type: sectionType, lines: [] };
    paragraph.lines.push(t);
  };

  for (const line of lines) processLine(line);
  closeParagraph();

  return items
    .map((it) => ({ type: it.type, text: it.lines.join(' ').replace(/\s+/g, ' ').trim() }))
    .filter((it) => it.text.length > 0);
}

// ---------------------------------------------------------------------------
// 对外主函数
// ---------------------------------------------------------------------------

/** 审稿人名里的编号（"Reviewer 3" → 3） */
function reviewerNumber(name: string): number {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? Number(m[1]) : 1;
}

/** 把条目 id 重整为 R{n}.{k} */
function renumberItems(items: ReviewItem[], n: number): ReviewItem[] {
  return items.map((it, i) => ({ ...it, id: `R${n}.${i + 1}` }));
}

export function parseReviewsText(text: string): ParsedReview[] {
  if (!text || !text.trim()) return [];
  const cleaned = removeNoise(text);
  const blocks = splitReviewers(cleaned);

  // 显式分隔头编号重复（两个 "Reviewer 1"）时按出现顺序重编号
  const nums = blocks.map((b) => b.number);
  const hasDup = new Set(nums).size !== nums.length;

  const reviews: ParsedReview[] = [];
  blocks.forEach((block, i) => {
    const n = hasDup ? i + 1 : block.number;
    const items = renumberItems(
      splitItems(block.raw).map((it) => ({ id: '', text: it.text, type: it.type })),
      n,
    );
    if (items.length === 0) return; // 空块（纯噪音/装饰）丢弃
    reviews.push({ reviewer: `Reviewer ${n}`, items, raw: block.raw.trim() });
  });
  return reviews;
}

/** 按顺序重编号（1..N），审稿人名与条目 id 一并重整 */
export function renumberReviews(reviews: ParsedReview[]): ParsedReview[] {
  return reviews.map((r, i) => ({
    reviewer: `Reviewer ${i + 1}`,
    items: renumberItems(r.items, i + 1),
    raw: r.raw,
  }));
}

/** 文件名中的审稿人编号：reviewer2.txt / R3.pdf / 审稿人_4.docx → 2 / 3 / 4 */
export function reviewerNumberFromFileName(name: string): number | null {
  const base = name.replace(/\.[^.]+$/, '');
  const m = /(?:reviewer|referee|审稿人|r)[\s_.-]*(\d{1,2})\b/i.exec(base);
  return m ? Number(m[1]) : null;
}

/**
 * 多文件合并解析（每位审稿人一个文件的常见形态）：
 * - 每个文件独立 parseReviewsText；
 * - 单审稿人文件且文件名含 reviewer 数字时，用文件名数字命名并重整编号；
 * - 多审稿人文件（内含显式分隔头）保持原编号；
 * - 合并后编号冲突（两个 Reviewer 2）时按文件顺序重编号。
 */
export function parseReviewsFiles(files: Array<{ name: string; text: string }>): ParsedReview[] {
  const merged: ParsedReview[] = [];
  for (const f of files) {
    if (!f.text?.trim()) continue;
    const parsed = parseReviewsText(f.text);
    const fileNum = reviewerNumberFromFileName(f.name);
    if (parsed.length === 1 && fileNum !== null) {
      const only = parsed[0]!;
      merged.push({
        reviewer: `Reviewer ${fileNum}`,
        items: renumberItems(only.items, fileNum),
        raw: only.raw,
      });
    } else {
      merged.push(...parsed);
    }
  }
  const nums = merged.map((r) => reviewerNumber(r.reviewer));
  if (new Set(nums).size !== nums.length) return renumberReviews(merged);
  return merged;
}

/**
 * 拼成 W7 Rebuttal 工作流的 reviews 变量文本：
 * 【Reviewer 1】\nR1.1: ...\nR1.2: ...\n\n【Reviewer 2】...
 * 条目内换行折叠为空格（一行一条，便于模型逐条解析）。
 */
export function reviewsToWorkflowInput(reviews: ParsedReview[]): string {
  return reviews
    .filter((r) => r.items.some((it) => it.text.trim().length > 0))
    .map((r) => {
      const lines = r.items
        .filter((it) => it.text.trim().length > 0)
        .map((it) => `${it.id}: ${it.text.replace(/\s*\n+\s*/g, ' ').trim()}`);
      return `【${r.reviewer}】\n${lines.join('\n')}`;
    })
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// 最小 .docx 文本提取器（zip → word/document.xml → 剥标签）
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(xml: string): string {
  return xml.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** 规整提取文本：\r 清除、逐行 trim、3+ 连续空行折叠为 1 个空行 */
function cleanupExtracted(text: string): string {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * 从 .docx（Office Open XML，zip 容器）提取纯文本。
 * 只解析中央目录定位 word/document.xml（fflate unzipSync），
 * 再剥 XML 标签：`</w:p>`/`<w:br/>` 换行、`<w:tab/>` 制表、其余剔除、实体解码。
 * 非 zip 或缺 word/document.xml 时抛中文错误。
 */
export function extractDocxText(data: ArrayBuffer): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error('无法解析该文件：不是有效的 .docx（Word）文件，请另存为 .docx 后重试');
  }
  const doc = entries['word/document.xml'];
  if (!doc) {
    throw new Error('该 .docx 内缺少 word/document.xml，无法提取文本（旧版 .doc 请先另存为 .docx）');
  }
  const xml = new TextDecoder('utf-8').decode(doc);
  const text = xml
    .replace(/<w:br\b[^>]*\/?>/gi, '\n')
    .replace(/<w:tab\b[^>]*\/?>/gi, '\t')
    .replace(/<\/w:p>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return cleanupExtracted(decodeEntities(text));
}
