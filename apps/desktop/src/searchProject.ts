/**
 * WS-3 全项目文本搜索（纯函数，无 DOM / store 依赖，可独立单测）：
 *  - 空 query 返回空结果；大小写默认不敏感（caseSensitive 关闭）；
 *  - wholeWord：拉丁词用 \b 等价的边界判定；CJK 不适用拉丁边界——整词模式下
 *    CJK 连续串须精确匹配（相邻汉字视为词字符，不部分命中）；
 *  - 跳过空文件与 >2MB 文本、跳过 .synctex / .synctex.gz 后缀；
 *  - limit 默认 500，超出截断，以 { truncated: true } 标记（可选方案的「返回 truncated」一种）；
 *  - 行文本 trimStart 后截断到 ~160 字符（命中越出初始窗口时窗口右缘贴住命中），
 *    matchStart/matchEnd 相对 text，恒有 text.slice(matchStart, matchEnd) === 命中原文，
 *    且列号反映 trimStart 前的原始列位置。
 */

export interface SearchHit {
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 截断到 ~160 字符的行内容（trimStart + 命中可见性窗口，越界侧以 … 标记） */
  text: string;
  /** 命中起点（相对 text，字符偏移） */
  matchStart: number;
  /** 命中终点（开区间，相对 text） */
  matchEnd: number;
}

export interface SearchProjectOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  limit?: number;
}

export interface SearchProjectResult {
  hits: SearchHit[];
  /** 命中数超出 limit 被截断时为 true */
  truncated: boolean;
}

/** 单文件大小上限（2MB）：超长生成物（如 synctex 之外的巨型日志）不参与搜索 */
const MAX_FILE_CHARS = 2 * 1024 * 1024;
const DEFAULT_LIMIT = 500;
/** 行文本窗口（~160 字符） */
const SNIPPET_WINDOW = 160;

/** CJK 表意/音节文字区段（整词模式下视为词字符：连续串不得部分命中） */
function isCJKCodePoint(cp: number): boolean {
  return (
    (cp >= 0x3040 && cp <= 0x30ff) || // 平假名 / 片假名
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK 扩展 A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 基本区
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 兼容表意
    (cp >= 0xac00 && cp <= 0xd7af) || // 谚文音节
    (cp >= 0x20000 && cp <= 0x2ffff) // CJK 扩展 B 及以后
  );
}

/** 拉丁词字符或 CJK 文字（整词边界判定用） */
function isWordChar(ch: string | undefined): boolean {
  if (!ch) return false;
  if (/[A-Za-z0-9_]/.test(ch)) return true;
  return isCJKCodePoint(ch.codePointAt(0)!);
}

/** 整词判定：命中两侧紧邻字符都不是词字符（等价拉丁 \b，且把 CJK 连续串当作一个词） */
function isWholeWordAt(line: string, start: number, length: number): boolean {
  return !isWordChar(line[start - 1]) && !isWordChar(line[start + length]);
}

/** 在单行内找出全部命中区间（原文列坐标）。 */
function findSpans(
  line: string,
  query: string,
  queryLower: string,
  caseSensitive: boolean,
  wholeWord: boolean,
): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (caseSensitive) {
    let idx = line.indexOf(query);
    while (idx !== -1) {
      if (!wholeWord || isWholeWordAt(line, idx, query.length)) spans.push([idx, idx + query.length]);
      idx = line.indexOf(query, idx + 1);
    }
    return spans;
  }
  // 大小写不敏感：在小写行上取候选列，再回原行做片段等值校验——
  // 保证命中列号恒对齐原文；个别 Unicode 大小写折叠会改变长度，候选可能漂移，
  // 校验兜底确保绝不产生错位假命中（仅此类病态字符可能漏报，LaTeX/中文语料不涉及）。
  const lower = line.toLowerCase();
  let idx = lower.indexOf(queryLower);
  while (idx !== -1) {
    if (
      line.slice(idx, idx + query.length).toLowerCase() === queryLower &&
      (!wholeWord || isWholeWordAt(line, idx, query.length))
    ) {
      spans.push([idx, idx + query.length]);
    }
    idx = lower.indexOf(queryLower, idx + 1);
  }
  return spans;
}

/** .synctex 与 .synctex.gz 均为编译生成物，不参与搜索 */
function isSkippedPath(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith('.synctex') || lower.endsWith('.synctex.gz');
}

/** 行文本 → 截断窗口内的 text + 相对偏移的 matchStart/matchEnd */
function buildHit(file: string, line: number, raw: string, start: number, end: number): SearchHit {
  let shift = 0;
  while (shift < raw.length && /\s/.test(raw[shift]!)) shift++;
  let winStart = shift;
  let winEnd = Math.min(raw.length, shift + SNIPPET_WINDOW);
  if (end > winEnd) {
    // 命中越过初始窗口：窗口右缘贴住命中末端，左缘在保留 SNIPPET_WINDOW 宽度的前提下
    // 尽量前移，但不越过命中起点（命中自身超过窗口宽度时完整展示命中）。
    winEnd = Math.max(end, Math.min(raw.length, shift + SNIPPET_WINDOW));
    winStart = Math.max(shift, Math.min(start, winEnd - SNIPPET_WINDOW));
  }
  const prefix = winStart > shift ? '…' : '';
  const suffix = winEnd < raw.length ? '…' : '';
  return {
    file,
    line,
    text: prefix + raw.slice(winStart, winEnd) + suffix,
    matchStart: start - winStart + prefix.length,
    matchEnd: end - winStart + prefix.length,
  };
}

/**
 * 全项目文本搜索主入口。文件按 Object.keys 顺序、行号 1-based、命中按行内出现次序返回。
 */
export function searchProject(
  files: Record<string, string>,
  query: string,
  opts: SearchProjectOptions = {},
): SearchProjectResult {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const caseSensitive = opts.caseSensitive ?? false;
  const wholeWord = opts.wholeWord ?? false;
  const queryLower = query.toLowerCase();
  const hits: SearchHit[] = [];
  if (!query) return { hits, truncated: false };

  let truncated = false;
  outer: for (const file of Object.keys(files)) {
    if (isSkippedPath(file)) continue;
    const content = files[file];
    if (!content || content.length > MAX_FILE_CHARS) continue; // 空文件 / 超大文件
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const [start, end] of findSpans(line, query, queryLower, caseSensitive, wholeWord)) {
        if (hits.length >= limit) {
          truncated = true; // 已有 limit 条且仍有新命中 → 截断
          break outer;
        }
        hits.push(buildHit(file, i + 1, line, start, end));
      }
    }
  }
  return { hits, truncated };
}

// ---------------------------------------------------------------------------
// v7.2.0 F1：项目级搜索替换（Ctrl+Shift+H）——纯函数层
// ---------------------------------------------------------------------------

export interface ReplaceResult {
  /** 被修改的文件路径列表 */
  changedFiles: string[];
  /** 总替换次数（所有文件所有行） */
  replacementCount: number;
  /** 每文件的预览（file → [before, after] 行对，前 200 行对） */
  preview: Array<{ file: string; line: number; before: string; after: string }>;
}

/**
 * 项目级搜索替换（纯函数）：返回替换后的新 files（不修改原对象）。
 * 与 searchProject 的 findSpans 共用同一匹配语义（大小写/整字，含 CJK 整词）；
 * 替换文本按字面量写入——绝不走 String.replace 的 $&/$1/$$ 模式展开
 * （LaTeX 里 `$$…$$`、`$&` 是常见书写，展开会静默改写数学公式）。
 */
export function replaceInProject(
  files: Record<string, string>,
  query: string,
  replacement: string,
  opts: { caseSensitive?: boolean; wholeWord?: boolean } = {},
): ReplaceResult & { newFiles: Record<string, string> } {
  const changedFiles: string[] = [];
  const preview: Array<{ file: string; line: number; before: string; after: string }> = [];
  let replacementCount = 0;
  const newFiles: Record<string, string> = {};
  if (!query) return { changedFiles, replacementCount: 0, preview, newFiles: files };

  const caseSensitive = opts.caseSensitive ?? false;
  const wholeWord = opts.wholeWord ?? false;
  const queryLower = query.toLowerCase();
  for (const file of Object.keys(files)) {
    if (isSkippedPath(file)) { newFiles[file] = files[file]!; continue; }
    const content = files[file]!;
    if (!content || content.length > MAX_FILE_CHARS) { newFiles[file] = content; continue; }
    const lines = content.split('\n');
    let fileChanged = false;
    const newLines: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const spans = findSpans(line, query, queryLower, caseSensitive, wholeWord);
      if (spans.length === 0) {
        newLines.push(line);
        continue;
      }
      // 命中区间逐段拼接（重叠命中按不重叠语义处理：如查询 "aa" 命中 "aaa" 只替换首处）
      let after = '';
      let cursor = 0;
      let applied = 0;
      for (const [start, end] of spans) {
        if (start < cursor) continue;
        after += line.slice(cursor, start) + replacement;
        cursor = end;
        applied++;
      }
      if (applied === 0) {
        newLines.push(line);
        continue;
      }
      after += line.slice(cursor);
      if (after !== line) {
        fileChanged = true;
        replacementCount += applied;
        if (preview.length < 200) preview.push({ file, line: i + 1, before: line, after });
      }
      newLines.push(after);
    }
    if (fileChanged) {
      changedFiles.push(file);
      newFiles[file] = newLines.join('\n');
    } else {
      newFiles[file] = content;
    }
  }
  return { changedFiles, replacementCount, preview, newFiles };
}
