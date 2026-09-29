/**
 * 论文切块（RAG 索引前处理）。
 * 有 sections 按 section 切；单节超长再按句子边界细分（块间字符重叠）；
 * 无 sections 用 fallbackText 滑窗切。块 id 为确定性 hash，可重复构建。
 */
import type { Paper, TextChunk } from '@scholarforge/shared';
import { fnv1a } from './util';

/** 单节超过该长度时按句子边界二次切分 */
export const SECTION_MAX_CHARS = 1600;
/** 相邻块之间的字符重叠 */
export const CHUNK_OVERLAP = 150;

export interface ChunkPlainTextOptions {
  /** 窗口大小（字符），默认 1200 */
  size?: number;
  /** 窗口重叠（字符），默认 150；会截断到 < size */
  overlap?: number;
}

const SENTENCE_TERMINATORS = new Set(['.', '!', '?', '。', '！', '？']);
const SENTENCE_CLOSERS = /["')\]」』）】》"”’]/;

/**
 * 句子边界切分，保留句末标点（含连续标点与收尾引号），每句去除首尾空白。
 * 拉丁终止符后须跟空白或文末（避免切开 "3.14"、"e.g."）；中文句号/问叹号无条件断句。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!SENTENCE_TERMINATORS.has(text[i])) continue;
    const cjkEnd = '。！？'.includes(text[i]);
    let end = i;
    while (end + 1 < text.length && SENTENCE_TERMINATORS.has(text[end + 1])) end++;
    while (end + 1 < text.length && SENTENCE_CLOSERS.test(text[end + 1])) end++;
    const followedBySpace = end + 1 >= text.length || /\s/.test(text[end + 1]);
    if (followedBySpace || cjkEnd) {
      out.push(text.slice(start, end + 1).trim());
      start = end + 1;
      i = end;
    }
  }
  if (start < text.length) out.push(text.slice(start).trim());
  return out.filter((s) => s.length > 0);
}

/**
 * 按句子边界把长文本切成 ≤ maxSize 的块，相邻块保留 overlap 字符重叠
 *（重叠取上一块尾部，可能从句中开始，属预期行为）。
 */
export function chunkBySentence(text: string, maxSize = SECTION_MAX_CHARS, overlap = CHUNK_OVERLAP): string[] {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text.trim().length > 0 ? [text.trim()] : [];
  const blocks: string[] = [];
  let cur = '';
  for (const s of sentences) {
    if (cur.length > 0 && cur.length + 1 + s.length > maxSize) {
      blocks.push(cur);
      cur = cur.length > overlap ? cur.slice(cur.length - overlap) : cur;
    }
    cur = cur.length > 0 ? `${cur} ${s}` : s;
  }
  if (cur.length > 0) blocks.push(cur);
  return blocks;
}

/** 无结构文本的滑窗切块 */
export function chunkPlainText(text: string, opts: ChunkPlainTextOptions = {}): string[] {
  const size = Math.max(1, Math.floor(opts.size ?? 1200));
  const overlap = Math.min(Math.max(0, Math.floor(opts.overlap ?? 150)), size - 1);
  const step = Math.max(1, size - overlap);
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  const chunks: string[] = [];
  for (let i = 0; i < trimmed.length; i += step) {
    const piece = trimmed.slice(i, i + size).trim();
    if (piece.length > 0) chunks.push(piece);
    if (i + size >= trimmed.length) break;
  }
  return chunks;
}

/**
 * 论文 → 检索块。块 id = fnv1a(paperId + '#' + 序号)，确定性可重建。
 */
export function chunkPaper(paper: Pick<Paper, 'sections'> & { id: string }, fallbackText?: string): TextChunk[] {
  const chunks: TextChunk[] = [];

  const push = (text: string, sectionId: string | undefined, heading: string | undefined, page: number | undefined) => {
    const id = `chk-${fnv1a(`${paper.id}#${chunks.length}`).toString(36)}`;
    chunks.push({ id, paperId: paper.id, sectionId, heading, page, text });
  };

  const sections = paper.sections ?? [];
  if (sections.length > 0) {
    for (const sec of sections) {
      const blocks =
        sec.text.length > SECTION_MAX_CHARS ? chunkBySentence(sec.text) : sec.text.trim().length > 0 ? [sec.text.trim()] : [];
      for (const b of blocks) push(b, sec.id, sec.heading, sec.pageStart);
    }
    return chunks;
  }

  if (fallbackText !== undefined) {
    for (const b of chunkPlainText(fallbackText)) push(b, undefined, undefined, undefined);
  }
  return chunks;
}
