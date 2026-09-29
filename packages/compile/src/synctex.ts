import { gunzipSync } from 'fflate';

/**
 * SyncTeX 子集解析与正反向查询。
 *
 * 本解析器覆盖一个文档化的一致子集（fixture 与解析器自洽）：
 *   SyncTeX Version:<n>                       版本头
 *   Input:<tag>:<path>                        输入文件记录（tag -> 路径）
 *   {<page>}                                  切换当前页
 *   {<tag>,<line>}                            输入锚点：之后的块归属该输入文件与行
 *   ([hv],)?x:<n>,y:<n>,w:<n>,h:<n>           块记录（缺省按 h 处理），单位为文件自身的
 *                                             synctex 单位（scaled point），不做换算
 * 其余行（Output:/Magnification:/Unit:/Content: 等）一律忽略。真实 .synctex 的
 * 完整语法更繁琐（vbox、k、x-星号、链等记录），此处刻意只实现可满足正反向查询的最小子集。
 */

export interface SynctexInput {
  tag: number;
  path: string;
}

export interface SynctexBlock {
  page: number;
  tag: number;
  line: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SynctexIndex {
  version: number;
  inputs: SynctexInput[];
  blocks: SynctexBlock[];
}

export interface SourceLocation {
  file: string;
  line: number;
}

export interface PdfLocation {
  page: number;
  x: number;
  y: number;
}

/** 解析 .synctex（gzip 魔数 0x1f 0x8b 自动解压，否则按 UTF-8 文本处理） */
export function parseSynctex(bytes: Uint8Array): SynctexIndex {
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  const text = new TextDecoder('utf-8').decode(isGzip ? gunzipSync(bytes) : bytes);
  return parseSynctexText(text);
}

function parseSynctexText(text: string): SynctexIndex {
  const index: SynctexIndex = { version: 0, inputs: [], blocks: [] };
  let currentPage = 0;
  let anchor: { tag: number; line: number } | undefined;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let m = /^SyncTeX Version:(\d+)$/.exec(line);
    if (m) {
      index.version = Number(m[1]);
      continue;
    }
    m = /^Input:(\d+):(.+)$/.exec(line);
    if (m) {
      index.inputs.push({ tag: Number(m[1]), path: normalizePath(m[2]) });
      continue;
    }
    m = /^\{(\d+),(\d+)\}$/.exec(line);
    if (m) {
      anchor = { tag: Number(m[1]), line: Number(m[2]) };
      continue;
    }
    m = /^\{(\d+)\}$/.exec(line);
    if (m) {
      currentPage = Number(m[1]);
      continue;
    }
    m = /^(?:([hv]),)?x:(-?\d+),y:(-?\d+),w:(\d+),h:(\d+)$/.exec(line);
    if (m && anchor) {
      index.blocks.push({
        page: currentPage,
        tag: anchor.tag,
        line: anchor.line,
        x: Number(m[2]),
        y: Number(m[3]),
        w: Number(m[4]),
        h: Number(m[5]),
      });
    }
    // 其余行按文档忽略
  }
  return index;
}

/** PDF→源码：页码与页面坐标（synctex 单位）→ 源文件与行号；未命中返回 undefined */
export function sourceLocation(index: SynctexIndex, page: number, x: number, y: number): SourceLocation | undefined {
  const candidates = index.blocks.filter(
    (b) => b.page === page && x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h,
  );
  if (candidates.length === 0) return undefined;
  // 命中多个时取面积最小的块（最具体）
  const best = candidates.reduce((a, b) => (b.w * b.h < a.w * a.h ? b : a));
  const input = index.inputs.find((i) => i.tag === best.tag);
  if (!input) return undefined;
  return { file: input.path, line: best.line };
}

/** 源码→PDF：文件与行号 → 页码与块左上角坐标；未命中返回 undefined */
export function lineLocation(index: SynctexIndex, file: string, line: number): PdfLocation | undefined {
  const target = normalizePath(file);
  const base = basename(target);
  const blocks = index.blocks.filter((b) => {
    const input = index.inputs.find((i) => i.tag === b.tag);
    if (!input) return false;
    const p = input.path;
    return p === target || p.endsWith('/' + target) || basename(p) === base;
  });
  if (blocks.length === 0) return undefined;
  // 就近行匹配（源码行与块的行号无需完全一致，取距离最近者）
  const best = blocks.reduce((a, b) => (Math.abs(b.line - line) < Math.abs(a.line - line) ? b : a));
  return { page: best.page, x: best.x, y: best.y };
}

function normalizePath(p: string): string {
  let s = p.trim();
  while (s.startsWith('./')) s = s.slice(2);
  return s;
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}
