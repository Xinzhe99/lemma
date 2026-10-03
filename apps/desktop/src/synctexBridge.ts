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
