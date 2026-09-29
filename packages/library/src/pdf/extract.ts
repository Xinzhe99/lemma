import { createId, type PaperSection } from '@scholarforge/shared';

/**
 * 纯函数启发式分节：
 * - 识别 "Abstract"、"1 Introduction"、"1. Introduction"、"2.1 Related Work"、
 *   "I. INTRODUCTION"（IEEE 罗马数字 + 全大写）以及独立全大写标题行。
 * - 页眉反复出现的同名标题视为非标题（忽略重复）。
 * - 完全没有匹配时按页分块兜底。
 */

export interface PdfPageText {
  page: number;
  text: string;
}

interface HeadingMatch {
  heading: string;
  level: number;
  /** 同行剩余文本（如 IEEE "Abstract—正文…"） */
  inlineRest: string;
}

const SPECIAL_HEADINGS: Record<string, string> = {
  abstract: 'Abstract',
  references: 'References',
  bibliography: 'References',
  acknowledgments: 'Acknowledgments',
  acknowledgements: 'Acknowledgments',
};

interface Line {
  page: number;
  text: string;
}

function matchSpecial(line: string): HeadingMatch | null {
  const special =
    /^(abstract|references|bibliography|acknowledgments?|acknowledgements?|appendix\s+[a-z0-9]?)$/i.exec(line);
  if (special) {
    const raw = special[1]!.toLowerCase();
    const canonical = SPECIAL_HEADINGS[raw] ?? SPECIAL_HEADINGS[raw.replace(/s$/, '')] ?? raw;
    return { heading: canonical.charAt(0).toUpperCase() + canonical.slice(1), level: 1, inlineRest: '' };
  }
  // IEEE 风格：Abstract—正文在同一行
  const inline = /^abstract\s*[—–:\-]\s*(.+)$/i.exec(line);
  if (inline) {
    return { heading: 'Abstract', level: 1, inlineRest: inline[1]!.trim() };
  }
  return null;
}

function isCapitalizedTitleCase(title: string): boolean {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) return false;
  return words.every(word => /^[A-Z]/.test(word));
}

function matchHeading(line: string): HeadingMatch | null {
  if (!line || line.length > 120) return null;

  const special = matchSpecial(line);
  if (special) return special;

  // 阿拉伯数字编号："1 Introduction" / "1. Introduction" / "2.1 Related Work"
  const arabic = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/.exec(line);
  if (arabic && arabic[2]!.length <= 100 && /^[A-Z0-9\u4e00-\u9fff]/.test(arabic[2]!)) {
    return {
      heading: arabic[2]!.trim(),
      level: arabic[1]!.split('.').length,
      inlineRest: '',
    };
  }

  // 罗马数字编号（IEEE）："I. INTRODUCTION"、"II. Related Work"
  const roman = /^([IVXLCDM]{1,6})\.?\s+([A-Z].*)$/.exec(line);
  if (roman && roman[2]!.length <= 100 && isCapitalizedTitleCase(roman[2]!)) {
    return { heading: roman[2]!.trim(), level: 1, inlineRest: '' };
  }

  // 独立全大写标题（无编号）：含空格时至少 4 字符，纯单词至少 8 字符，以排除 "GPU" 之类缩写
  const caps = /^[A-Z][A-Z0-9 '&:,\-/.]{2,60}$/.exec(line);
  if (caps && /[A-Z]{3}/.test(line)) {
    const hasSpace = /\s/.test(line);
    if (hasSpace || line.trim().length >= 8) {
      return { heading: line.trim(), level: 1, inlineRest: '' };
    }
  }

  return null;
}

/** 对 PDF 各页文本做启发式结构化分节。 */
export function extractSections(pages: { page: number; text: string }[]): PaperSection[] {
  const lines: Line[] = [];
  for (const page of pages) {
    for (const raw of page.text.split(/\r?\n/)) {
      const trimmed = raw.trim();
      if (trimmed) lines.push({ page: page.page, text: trimmed });
    }
  }
  if (lines.length === 0) return [];

  // 单遍扫描：重复出现的同名标题视为页眉，整行丢弃；首个标题前的 front matter 丢弃
  const seenHeadings = new Set<string>();
  const sections: PaperSection[] = [];
  let current: { heading: string; level: number; page: number; body: string[] } | null = null;
  let headingCount = 0;

  const finalize = (): void => {
    if (!current) return;
    const text = current.body.join('\n').trim();
    if (text) {
      sections.push({
        id: createId(),
        heading: current.heading,
        level: current.level,
        text,
        pageStart: current.page,
      });
    }
    current = null;
  };

  for (const line of lines) {
    const match = matchHeading(line.text);
    if (!match) {
      if (current) current.body.push(line.text);
      continue;
    }
    const normalized = match.heading.toLowerCase();
    if (seenHeadings.has(normalized)) continue; // 页眉重复：整行丢弃
    finalize();
    seenHeadings.add(normalized);
    headingCount++;
    current = {
      heading: match.heading,
      level: match.level,
      page: line.page,
      body: match.inlineRest ? [match.inlineRest] : [],
    };
  }
  finalize();

  if (headingCount === 0) {
    // 兜底：没有任何标题模式命中时按页分块
    return pages
      .filter(page => page.text.trim().length > 0)
      .map(page => ({
        id: createId(),
        heading: `第 ${page.page} 页`,
        level: 1,
        text: page.text.trim(),
        pageStart: page.page,
      }));
  }
  return sections;
}
