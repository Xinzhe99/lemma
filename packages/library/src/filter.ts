import type { Paper, ReadStatus } from '@lemma/shared';

/**
 * 智能过滤器查询语言：
 *   year:>2023 | year:>=2020 | year:2020-2024 | year:2023
 *   venue:CVPR（venue.name 子串，忽略大小写）
 *   status:unread|reading|done
 *   tag:xyz（忽略大小写精确匹配；含空格的取值加引号：tag:"machine learning"）
 *   rating:>=4 | rating:3
 *   "带引号短语"（匹配 title/abstract）
 *   裸词（关键词 AND，匹配题录全部可检索字段）
 * 节点之间为 AND；无法解析的词宽松降级为 invalid 并在过滤时忽略。
 */

export type FilterCompareOp = '>' | '>=' | '<' | '<=' | '=';

export type FilterNode =
  | { type: 'year'; op: FilterCompareOp; value: number }
  | { type: 'yearRange'; from: number; to: number }
  | { type: 'venue'; value: string }
  | { type: 'status'; value: ReadStatus }
  | { type: 'tag'; value: string }
  | { type: 'rating'; op: FilterCompareOp; value: number }
  | { type: 'phrase'; value: string }
  | { type: 'keyword'; value: string }
  | { type: 'invalid'; raw: string };

export interface ParsedFilter {
  nodes: FilterNode[];
}

interface Token {
  text: string;
  quoted: boolean;
}

const STATUS_ALIASES: Record<string, ReadStatus> = {
  unread: 'to-read',
  'to-read': 'to-read',
  reading: 'reading',
  done: 'done',
  read: 'done',
};

/** 字段取值前缀：“name:” 之后可以跟引号取值（tag:"machine learning"）。 */
const FIELD_PREFIX = /^[a-zA-Z]+:$/;

/** 去掉字段取值外层的成对引号；未闭合引号（宽松降级）只去掉开引号，其余原样返回。 */
function unquoteValue(raw: string): string {
  const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
  if (quoted) return quoted[2]!;
  return /^["']/.test(raw) ? raw.slice(1) : raw;
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < query.length) {
    const ch = query[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // 未闭合引号：把剩余部分当作短语（宽松降级）
      const end = query.indexOf(ch, i + 1);
      if (end === -1) {
        tokens.push({ text: query.slice(i + 1), quoted: true });
        break;
      }
      tokens.push({ text: query.slice(i + 1, end), quoted: true });
      i = end + 1;
    } else {
      let j = i;
      while (j < query.length && !/\s/.test(query[j]!)) {
        // 字段取值带引号（tag:"machine learning"）：引号内允许空白，整体作为一个 token
        const c = query[j]!;
        if ((c === '"' || c === "'") && FIELD_PREFIX.test(query.slice(i, j))) {
          const end = query.indexOf(c, j + 1);
          j = end === -1 ? query.length : end + 1;
          continue;
        }
        j++;
      }
      tokens.push({ text: query.slice(i, j), quoted: false });
      i = j;
    }
  }
  return tokens;
}

function parseNumberToken(raw: string): { op: FilterCompareOp; value: number } | null {
  const range = /^(\d{3,4})\s*-\s*(\d{3,4})$/.exec(raw);
  if (range) return null; // 范围由调用方处理
  const cmp = /^(>=|<=|>|<|=)?\s*(\d+(?:\.\d+)?)$/.exec(raw);
  if (!cmp) return null;
  return { op: (cmp[1] ?? '=') as FilterCompareOp, value: Number(cmp[2]) };
}

function parseYearNode(raw: string, source: string): FilterNode {
  const range = /^(\d{3,4})\s*-\s*(\d{3,4})$/.exec(raw);
  if (range) return { type: 'yearRange', from: Number(range[1]), to: Number(range[2]) };
  const parsed = parseNumberToken(raw);
  if (parsed) return { type: 'year', op: parsed.op, value: parsed.value };
  return { type: 'invalid', raw: source };
}

function parseRatingNode(raw: string, source: string): FilterNode {
  const parsed = parseNumberToken(raw);
  if (parsed) return { type: 'rating', op: parsed.op, value: parsed.value };
  return { type: 'invalid', raw: source };
}

function parseStatusNode(raw: string, source: string): FilterNode {
  const status = STATUS_ALIASES[raw.toLowerCase()];
  if (status) return { type: 'status', value: status };
  return { type: 'invalid', raw: source };
}

/** 解析查询字符串为结构化 AST（节点间为 AND 关系）。 */
export function parseFilter(query: string): ParsedFilter {
  const nodes: FilterNode[] = [];
  for (const token of tokenize(query)) {
    if (token.quoted) {
      const value = token.text.trim();
      nodes.push(value ? { type: 'phrase', value } : { type: 'invalid', raw: token.text });
      continue;
    }
    const field = /^([a-zA-Z]+):(.*)$/.exec(token.text);
    if (!field) {
      if (token.text.trim()) nodes.push({ type: 'keyword', value: token.text.toLowerCase() });
      else nodes.push({ type: 'invalid', raw: token.text });
      continue;
    }
    const name = field[1]!.toLowerCase();
    const raw = unquoteValue(field[2]!.trim());
    switch (name) {
      case 'year':
        nodes.push(parseYearNode(raw, token.text));
        break;
      case 'venue':
        nodes.push(raw ? { type: 'venue', value: raw } : { type: 'invalid', raw: token.text });
        break;
      case 'status':
        nodes.push(parseStatusNode(raw, token.text));
        break;
      case 'tag':
        nodes.push(raw ? { type: 'tag', value: raw } : { type: 'invalid', raw: token.text });
        break;
      case 'rating':
        nodes.push(parseRatingNode(raw, token.text));
        break;
      // 未知字段按关键词处理（宽松降级）
      default:
        nodes.push({ type: 'keyword', value: token.text.toLowerCase() });
    }
  }
  return { nodes };
}

function compare(actual: number, op: FilterCompareOp, expected: number): boolean {
  switch (op) {
    case '>':
      return actual > expected;
    case '>=':
      return actual >= expected;
    case '<':
      return actual < expected;
    case '<=':
      return actual <= expected;
    case '=':
      return actual === expected;
  }
}

/** 关键词的检索范围：标题、摘要、作者、场所、标签。 */
function searchableText(paper: Paper): string {
  const parts: string[] = [paper.title, paper.abstract ?? ''];
  for (const author of paper.authors) {
    parts.push(author.family, author.given ?? '');
  }
  if (paper.venue?.name) parts.push(paper.venue.name);
  parts.push(paper.tags.join(' '));
  return parts.join(' ').toLowerCase();
}

function matchesNode(paper: Paper, node: FilterNode): boolean {
  switch (node.type) {
    case 'year':
      return paper.year !== undefined && compare(paper.year, node.op, node.value);
    case 'yearRange':
      return paper.year !== undefined && paper.year >= node.from && paper.year <= node.to;
    case 'venue': {
      const name = paper.venue?.name;
      return !!name && name.toLowerCase().includes(node.value.toLowerCase());
    }
    case 'status':
      return paper.readStatus === node.value;
    case 'tag':
      return paper.tags.some(tag => tag.toLowerCase() === node.value.toLowerCase());
    case 'rating':
      return paper.rating !== undefined && compare(paper.rating, node.op, node.value);
    case 'phrase': {
      const haystack = `${paper.title}\n${paper.abstract ?? ''}`.toLowerCase();
      return haystack.includes(node.value.toLowerCase());
    }
    case 'keyword':
      return searchableText(paper).includes(node.value);
    case 'invalid':
      return true;
  }
}

/** 对文献列表执行智能过滤查询。 */
export function applyFilter(papers: Paper[], query: string): Paper[] {
  const { nodes } = parseFilter(query);
  const active = nodes.filter(node => node.type !== 'invalid');
  if (active.length === 0) return [...papers];
  return papers.filter(paper => active.every(node => matchesNode(paper, node)));
}
