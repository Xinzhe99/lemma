/**
 * SyncTeX 桥（集成者预置 stub）：
 * - 编译成功后由 compileAction 调 setSynctexIndex 注册索引；
 * - 源码 → PDF：jumpSourceToPdf(file, line) 命中则发出 onPdfGoto 事件（App 打开 PDF 视图并定位）；
 * - PDF → 源码：jumpPdfToSource(page, x, y) 命中则调用既有 editorJump.jumpTo 跳源码。
 * 无索引（浏览器/模拟编译）时所有查询返回 false，功能静默不可用。
 */

import { lineLocation, sourceLocation, type SynctexIndex } from '@lemma/compile';

type PdfGotoListener = (goto: { page: number; y?: number }) => void;

let index: SynctexIndex | null = null;
const listeners = new Set<PdfGotoListener>();

export function setSynctexIndex(i: SynctexIndex | null): void {
  index = i;
}

export function hasSynctexIndex(): boolean {
  return index !== null;
}

/** 源码 → PDF：命中返回 true 并广播 {page, y}；无索引/未命中返回 false */
export function jumpSourceToPdf(file: string, line: number): boolean {
  if (!index) return false;
  const loc = lineLocation(index, file, line);
  if (!loc) return false;
  for (const cb of listeners) cb({ page: loc.page, y: loc.y });
  return true;
}

/** PDF → 源码：命中返回 true 并跳转源码；无索引/未命中返回 false */
export function jumpPdfToSource(page: number, x: number, y: number): boolean {
  if (!index) return false;
  const loc = sourceLocation(index, page, x, y);
  if (!loc) return false;
  void import('./editorJump').then(({ jumpTo }) => jumpTo({ file: loc.file, line: loc.line }));
  return true;
}

export function onPdfGoto(cb: PdfGotoListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ---------------------------------------------------------------------------
// v5.0.0 AI 改动定位：AI 编辑落盘时排队源码位置，下一次编译成功（新 synctex
// 索引注册后）自动 flush——PDF 滚到「AI 刚改的地方」，所见即所得。
// ---------------------------------------------------------------------------

let pendingGoto: { file: string; line: number } | null = null;

/** AI 编辑采纳后调用：记录待定位位置（后写覆盖先写，跟最后一次改动走） */
export function queueSourceGoto(file: string, line: number): void {
  pendingGoto = { file, line };
}

/** 编译成功后由 compileAction 调用：索引已更新，执行排队中的定位 */
export function flushQueuedSourceGoto(): void {
  if (!pendingGoto || !index) return;
  const { file, line } = pendingGoto;
  pendingGoto = null;
  jumpSourceToPdf(file, line);
}
