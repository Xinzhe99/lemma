import type { Paper, PaperAuthor, Venue } from '@scholarforge/shared';

/**
 * 引用格式化纯函数（L1 条目详情视图用）。
 *
 * 三种样式的关键差异（测试断言点）：
 * - 作者：
 *   - IEEE  名字缩写前置（A. B. Family）；>6 位只列第 1 位 + “et al.”；
 *   - APA   「Family, A. B.」+ 末位前 “&”；>20 位列前 19 位 + “...” + 末位；
 *   - AMA   「Family AB」（缩写连写不带点）；>6 位列前 3 位 + “et al.”；
 * - 斜体（用 *…* 标记，渲染层经 parseCitationSegments 转为斜体段）：
 *   - IEEE  期刊/会议名斜体，标题加引号；
 *   - APA   期刊名与卷号一起斜体（期号不斜体）；
 *   - AMA   仅期刊名斜体，卷号(期号)正体；
 * - 年份位置：IEEE 在末尾、APA 紧跟作者括注 (2017).、AMA 在分号后（…; 2017.）。
 *
 * 缺省字段的处理：无作者→省略作者段；无年份→APA 用 (n.d.)，IEEE/AMA 省略；
 * 无 venue 时若有 arXiv id 按 arXiv 预印本呈现。
 */

export type CitationStyle = 'IEEE' | 'APA' | 'AMA';

/** 详情视图按序切换用。 */
export const CITATION_STYLES: readonly CitationStyle[] = ['IEEE', 'APA', 'AMA'];

/** 渲染辅助：把 *斜体* 标记的引用文本拆为有序片段。 */
export interface CitationSegment {
  text: string;
  italic: boolean;
}

/** 将 formatCitation 输出按 *…* 标记拆分；未配对的 * 按普通文本处理。 */
export function parseCitationSegments(citation: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  const pattern = /\*([^*]+)\*/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(citation)) !== null) {
    if (match.index > cursor) segments.push({ text: citation.slice(cursor, match.index), italic: false });
    segments.push({ text: match[1]!, italic: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < citation.length) segments.push({ text: citation.slice(cursor), italic: false });
  return segments.length > 0 ? segments : [{ text: citation, italic: false }];
}

// ---------------------------------------------------------------------------
// 作者格式化
// ---------------------------------------------------------------------------

/** "Tom B." → ["T.", "B."] */
function givenInitials(given?: string): string[] {
  if (!given) return [];
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}.`);
}

function ieeeAuthor(author: PaperAuthor): string {
  const initials = givenInitials(author.given).join(' ');
  return initials ? `${initials} ${author.family}` : author.family;
}

function apaAuthor(author: PaperAuthor): string {
  const initials = givenInitials(author.given).join(' ');
  return initials ? `${author.family}, ${initials}` : author.family;
}

function amaAuthor(author: PaperAuthor): string {
  const initials = givenInitials(author.given)
    .map((s) => s.replace(/\./g, ''))
    .join('');
  return initials ? `${author.family} ${initials}` : author.family;
}

function truncateAuthors(authors: PaperAuthor[], style: CitationStyle): PaperAuthor[] {
  if (style === 'IEEE') return authors.length > 6 ? [authors[0]!] : authors;
  if (style === 'AMA') return authors.length > 6 ? authors.slice(0, 3) : authors;
  // APA：>20 位 → 前 19 位 + … + 末位（不用 &）
  return authors.length > 20 ? [...authors.slice(0, 19), authors[authors.length - 1]!] : authors;
}

function formatAuthors(authors: PaperAuthor[], style: CitationStyle): string {
  const list = truncateAuthors(authors, style);
  const truncatedEtAl =
    (style === 'IEEE' && authors.length > 6) || (style === 'AMA' && authors.length > 6);

  let joined: string;
  if (style === 'IEEE') {
    const names = list.map(ieeeAuthor);
    joined =
      names.length <= 1
        ? names.join('')
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]!}`;
  } else if (style === 'APA') {
    const names = list.map(apaAuthor);
    const ellipsis = authors.length > 20;
    if (names.length <= 1) joined = names.join('');
    else if (ellipsis) joined = `${names.slice(0, -1).join(', ')}, ... ${names[names.length - 1]!}`;
    else if (names.length === 2) joined = `${names[0]}, & ${names[1]}`;
    else joined = `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]!}`;
  } else {
    joined = list.map(amaAuthor).join(', ');
  }

  if (truncatedEtAl) joined += style === 'AMA' ? ', et al.' : ' et al.';
  return joined;
}

// ---------------------------------------------------------------------------
// 场所（期刊/会议/预印本）片段
// ---------------------------------------------------------------------------

function isJournalLike(venue: Venue): boolean {
  return venue.type === 'journal' || venue.type === 'book' || venue.type === 'thesis';
}

/** IEEE 场所段：以空格开头，以句点结尾；期刊/会议名斜体。 */
function ieeeVenue(paper: Paper): string {
  const venue = paper.venue;
  const year = paper.year !== undefined ? `, ${paper.year}` : '';
  if (venue?.name) {
    if (isJournalLike(venue)) {
      const vol = venue.volume ? `, vol. ${venue.volume}` : '';
      const issue = venue.issue ? `, no. ${venue.issue}` : '';
      const pages = venue.pages ? `, pp. ${venue.pages}` : '';
      return ` *${venue.name}*${vol}${issue}${pages}${year}.`;
    }
    if (venue.type === 'conference' || venue.type === 'workshop') {
      const pages = venue.pages ? `, pp. ${venue.pages}` : '';
      return ` in *${venue.name}*${pages}${year}.`;
    }
    const arxiv = paper.arxivId ? `, arXiv:${paper.arxivId}` : '';
    return ` *${venue.name}*${arxiv}${year}.`;
  }
  if (paper.arxivId) return ` arXiv:${paper.arxivId}${year}.`;
  return year ? ` ${paper.year}.` : '.';
}

/** APA 场所段：期刊名+卷号斜体；DOI 以 https://doi.org/ 全链形式附后。 */
function apaVenue(paper: Paper): string {
  const venue = paper.venue;
  let out: string;
  if (venue?.name) {
    const vol = venue.volume ? `, ${venue.volume}` : '';
    const italic = `*${venue.name}${vol}*`;
    const issue = venue.issue ? `(${venue.issue})` : '';
    const pages = venue.pages ? `, ${venue.pages}` : '';
    out = `${italic}${issue}${pages}.`;
  } else if (paper.arxivId) {
    out = `*arXiv*.`;
  } else {
    out = '';
  }
  if (paper.arxivId) out += ` arXiv:${paper.arxivId}.`;
  if (paper.doi) out += ` https://doi.org/${paper.doi}.`;
  return out;
}

/** AMA 场所段：仅期刊名斜体；卷(期):页码; 年份. */
function amaVenue(paper: Paper): string {
  const venue = paper.venue;
  let out: string;
  if (venue?.name) {
    out = `*${venue.name}*.`;
    const volIssuePages =
      `${venue.volume ?? ''}${venue.issue ? `(${venue.issue})` : ''}${venue.pages ? `:${venue.pages}` : ''}`;
    const tail: string[] = [];
    if (volIssuePages) tail.push(volIssuePages);
    if (paper.year !== undefined) tail.push(String(paper.year));
    if (tail.length > 0) out += ` ${tail.join('; ')}.`;
  } else if (paper.arxivId) {
    out = `*arXiv*${paper.year !== undefined ? `; ${paper.year}` : ''}. arXiv:${paper.arxivId}.`;
  } else {
    out = paper.year !== undefined ? `${paper.year}.` : '';
  }
  if (paper.doi) out += ` doi:${paper.doi}.`;
  return out;
}

// ---------------------------------------------------------------------------
// 主函数
// ---------------------------------------------------------------------------

/** 按指定样式生成引用文本；斜体用 *…* 标记（见 parseCitationSegments）。 */
export function formatCitation(paper: Paper, style: CitationStyle): string {
  const title = paper.title.trim();
  const year = paper.year !== undefined ? String(paper.year) : 'n.d.';
  const authors = paper.authors.length > 0 ? formatAuthors(paper.authors, style) : '';

  if (style === 'IEEE') {
    // A. Author, "Title," *Journal*, vol. 1, no. 2, pp. 3-4, 2017.
    const head = authors ? `${authors}, ` : '';
    const venue = ieeeVenue(paper);
    // 无场所且无年份时 ieeeVenue 返回孤立句点 → 标题自身收尾
    if (venue === '.') return `${head}"${title}."`;
    return `${head}"${title},"${venue}`;
  }

  if (style === 'APA') {
    // Author, A. (2017). Title. *Journal, 1*(2), 3-4. https://doi.org/...
    const head = `${authors ? `${authors} ` : ''}(${year}). `;
    const venue = apaVenue(paper);
    return `${head}${title}.${venue ? ` ${venue}` : ''}`;
  }

  // AMA：Author AB. Title. *Journal*. 1(2):3-4; 2017. doi:...
  // （作者列表整体以句点收尾；et al. 自带的句点去重）
  const amaAuthors = paper.authors.length > 0 ? formatAuthors(paper.authors, 'AMA') : '';
  const head = amaAuthors ? `${amaAuthors.replace(/\.$/, '')}. ` : '';
  const venue = amaVenue(paper);
  return `${head}${title}.${venue ? ` ${venue}` : ''}`;
}
