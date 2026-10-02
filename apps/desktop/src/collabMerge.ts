/**
 * 多人协同·阶段一（v1.5.0 B）：CRDT 异步补丁往返——不依赖任何服务器。
 *
 * 协议（关键：双方必须克隆同一份「基线快照」的历史，Yjs 项目 ID 才能对上）：
 *  1. A 导出补丁：.sfpatch = JSON { v, base: 基线全文, text: A 改后全文, meta }；
 *  2. B 合并：由 base 重建共享历史 → B 克隆套自己的改动（base→my 全文 diff）→
 *     A 克隆套 A 的改动 → 把 A 的状态 update 应用到 B 的文档 → CRDT 自动融合
 *     （不同区域共存；同区域双方变体相邻共存，绝不静默丢字）。
 *
 * 实现：editDocText 以「行级公共前后缀」定位改动区间，在 Y.Text 上 delete+insert；
 * 双方改动都相对 base 的原始内容计算，克隆共享历史保证 ID 一致，应用顺序无关。
 */

import * as Y from 'yjs';

export const COLLAB_DOC_FIELD = 'manuscript';
export const COLLAB_PATCH_EXT = '.sfpatch';

// ---------------------------------------------------------------------------
// .sfpatch 文件（JSON 文本：人可读、工具可校验）
// ---------------------------------------------------------------------------

export interface PatchFileMeta {
  file?: string;
  author?: string;
  at?: number;
}

export interface PatchFile {
  v: 1;
  /** 合并双方共同出发的基线全文 */
  base: string;
  /** 补丁方改后的全文 */
  text: string;
  meta: PatchFileMeta;
}

export function makePatchFile(base: string, text: string, meta: PatchFileMeta): string {
  return JSON.stringify({ v: 1, base, text, meta }, null, 1);
}

export function parsePatchFile(content: string): PatchFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('补丁文件不是合法 JSON（应为 ScholarForge .sfpatch）');
  }
  const o = parsed as Record<string, unknown>;
  if (o?.v !== 1 || typeof o.base !== 'string' || typeof o.text !== 'string') {
    throw new Error('补丁文件缺少 v/base/text 字段（v1 格式）');
  }
  return { v: 1, base: o.base, text: o.text, meta: (o.meta as PatchFileMeta) ?? {} };
}

// ---------------------------------------------------------------------------
// 行级 diff → Y.Text 编辑（公共前后缀定位唯一改动区间）
// ---------------------------------------------------------------------------

function splitLines(s: string): string[] {
  return s.split('\n');
}

/**
 * 把 doc 中「from 文本」编辑为「to 文本」：以行级公共前缀/后缀夹出唯一改动区间，
 * 在 Y.Text 上执行 delete+insert。from 必须与文档当前内容一致（调用方保证）。
 */
function editDocText(doc: Y.Doc, from: string, to: string): void {
  const ytext = doc.getText(COLLAB_DOC_FIELD);
  const a = splitLines(from);
  const b = splitLines(to);
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  const aMid = a.slice(p, a.length - s);
  const bMid = b.slice(p, b.length - s);

  // 行 p 的起始字符偏移（含前导换行）
  let start = 0;
  for (let i = 0; i < p; i++) start += (a[i]?.length ?? 0) + 1;
  let delLen = 0;
  for (const line of aMid) delLen += line.length + 1;
  // 改动区间不含尾随换行（区间后仍有 s 行时，中段末行的换行属于边界、保留原位）
  if (aMid.length > 0 && s > 0) delLen -= 1;

  // 插入 = 新中段按行拼接（s>0 时不补尾换行——边界换行已在文档原位）
  const insert = bMid.join('\n');
  if (delLen > 0) ytext.delete(start, delLen);
  if (insert.length > 0) ytext.insert(start, insert);
}

/** 由文本构建基线快照 update（共享历史的种子；同一 merge 内只编码一次） */
function baseSnapshot(base: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(COLLAB_DOC_FIELD).insert(0, base);
  const update = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return update;
}

// ---------------------------------------------------------------------------
// 对外 API
// ---------------------------------------------------------------------------

/**
 * 合并协作者补丁到我的全文（我方 = base + 我的改动；补丁方 = base + 他的改动）。
 * 返回合并后的全文；坏补丁抛错（调用方展示，不动稿件）。
 *
 * 关键：基线快照只编码一次，我的克隆与补丁方的克隆共用同一字节——Yjs 项目
 * ID 才一致，双方改动才能在 CRDT 上正确融合（否则会整体重复）。
 */
export function applyCollabPatch(myText: string, patchContent: string): { merged: string; meta: PatchFileMeta } {
  const patch = parsePatchFile(patchContent);
  const snapshot = baseSnapshot(patch.base);

  const mine = new Y.Doc();
  Y.applyUpdate(mine, snapshot);
  editDocText(mine, patch.base, myText);

  const other = new Y.Doc();
  Y.applyUpdate(other, snapshot);
  editDocText(other, patch.base, patch.text);
  Y.applyUpdate(mine, Y.encodeStateAsUpdate(other));

  const merged = mine.getText(COLLAB_DOC_FIELD).toString();
  mine.destroy();
  other.destroy();
  return { merged, meta: patch.meta };
}

/** 三方文本是否两两一致（完全无分歧，UI 可提示"无差异"） */
export function textsDiffer(a: string, b: string): boolean {
  return a !== b;
}
