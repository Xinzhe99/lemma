import type { Paper } from '@scholarforge/shared';

/**
 * Better-BibTeX 风格 citekey 生成。
 * 模式为冒号分隔的片段名，输出以 “:” 连接各片段，未知片段忽略：
 *   auth       首作者 family，去除非字母字符
 *   auth3      最多前 3 位作者的 family 拼接
 *   authEtAl   ≤2 位作者取全部 family；>2 位取首作者 + “EtAl”
 *   year       发表年份
 *   shorttitle 标题前 3 个实词（跳过虚词），每个词首字母大写后拼接
 *   alpha      首作者首字母（大写）+ 年份后两位
 */

/** 虚词表：冠词/介词/连词/代词/助动词等（用于 shorttitle）。 */
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the',
  'of', 'on', 'in', 'for', 'with', 'at', 'by', 'from', 'as', 'via', 'into', 'onto', 'upon',
  'within', 'without', 'between', 'over', 'under', 'through', 'across', 'after', 'before', 'during',
  'and', 'or', 'nor', 'but',
  'it', 'its', 'this', 'that', 'these', 'those', 'we', 'our', 'us', 'they', 'their', 'them',
  'he', 'she', 'his', 'her', 'him', 'you', 'your', 'i', 'my', 'me',
  'what', 'which', 'who', 'whose', 'when', 'where', 'why', 'how',
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'has', 'have', 'had',
  'do', 'does', 'did', 'will', 'would', 'can', 'could', 'should', 'may', 'might', 'must', 'shall',
  'not', 'no',
]);

function familyOf(paper: Paper, index: number): string {
  const family = paper.authors[index]?.family ?? '';
  // 去非字母（Unicode，保留变音与中文）；若全被去掉则保留原词小写
  const lettersOnly = family.replace(/[^\p{L}]/gu, '').toLowerCase();
  return lettersOnly || family.trim().toLowerCase();
}

function shortTitle(title: string): string {
  const cleaned = title
    .replace(/\\[a-zA-Z]+\s?/g, '') // 去除 TeX 命令
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const picked: string[] = [];
  for (const rawWord of cleaned.split(' ')) {
    // 去除词首尾标点（如 "Adam:" 的冒号）
    const word = rawWord.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!word) continue;
    if (TITLE_STOPWORDS.has(word.toLowerCase())) continue;
    picked.push(word.charAt(0).toUpperCase() + word.slice(1));
    if (picked.length === 3) break;
  }
  return picked.join('');
}

/** 按 Better-BibTeX 风格模式生成 citekey；模式片段用 “:” 分隔。 */
export function generateCitekey(paper: Paper, pattern = 'auth:year:shorttitle'): string {
  const segments: string[] = [];
  for (const token of pattern.split(':')) {
    let segment = '';
    switch (token) {
      case 'auth':
        segment = familyOf(paper, 0) || 'anon';
        break;
      case 'auth3':
        segment = [0, 1, 2].map(i => familyOf(paper, i)).filter(Boolean).join('');
        break;
      case 'authEtAl': {
        const families = paper.authors.map((_, i) => familyOf(paper, i)).filter(Boolean);
        segment = families.length > 2 ? `${families[0]!}EtAl` : families.join('');
        break;
      }
      case 'year':
        segment = paper.year !== undefined ? String(paper.year) : '';
        break;
      case 'shorttitle':
        segment = shortTitle(paper.title);
        break;
      case 'alpha': {
        const family = familyOf(paper, 0);
        const letter = family ? family.charAt(0).toUpperCase() : 'X';
        segment = paper.year !== undefined ? letter + String(paper.year).slice(-2) : letter;
        break;
      }
      default:
        segment = ''; // 未知片段忽略
    }
    if (segment) segments.push(segment);
  }
  return segments.length > 0 ? segments.join(':') : 'nokey';
}

/** 1→a … 26→z 27→aa 的双字母后缀。 */
function ordinalToSuffix(n: number): string {
  let suffix = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    suffix = String.fromCharCode(97 + r) + suffix;
    x = Math.floor((x - 1) / 26);
  }
  return suffix;
}

/** 与既有 citekey 集合消歧：冲突时追加 -a、-b… 后缀。 */
export function disambiguateCitekey(key: string, existing: Set<string>): string {
  if (!existing.has(key)) return key;
  for (let n = 1; ; n++) {
    const candidate = `${key}-${ordinalToSuffix(n)}`;
    if (!existing.has(candidate)) return candidate;
  }
}
