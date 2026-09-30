/**
 * 大纲/SyncTeX → 编辑器的行级跳转桥。
 * EditorArea 挂载时注册 handler；面板调用 jumpTo；跨文件跳转先暂存，待目标文件编辑器就绪后消费。
 * 编辑器未挂载（如 PDF 视图下 EditorArea 卸载）时 jumpTo 兜底打开目标文件并切回编辑器视图，
 * 暂存目标仍保留，编辑器挂载后由 takePendingJump 精确定位行。
 * 依赖方向：本模块 → stores（单向；stores 不回 import 本模块，无环）。
 */

import { useWorkspaceStore } from './state/workspaceStore';
import { useUiStore } from './state/uiStore';

export interface JumpTarget {
  file: string;
  line: number;
}

let handler: ((t: JumpTarget) => void) | null = null;
let pending: JumpTarget | null = null;

export function setJumpHandler(fn: ((t: JumpTarget) => void) | null): void {
  handler = fn;
}

/** 暂存跳转目标（跨文件：等目标文件编辑器挂载后由 takePendingJump 消费） */
export function stashPendingJump(target: JumpTarget): void {
  pending = target;
}

export function jumpTo(target: JumpTarget): void {
  if (handler) {
    handler(target);
    return;
  }
  // 兜底（编辑器未挂载，如 PDF 视图）：打开目标文件并切回编辑器；
  // 同时暂存目标，编辑器挂载后由 takePendingJump 消费，精确定位到行。
  pending = target;
  useWorkspaceStore.getState().openFile(target.file);
  useUiStore.getState().setCenterView('editor');
}

/** EditorArea 在编辑器就绪后取用（仅消费匹配当前文件的暂存目标） */
export function takePendingJump(file: string): JumpTarget | null {
  if (
    pending &&
    (pending.file === file || pending.file.replace(/\.tex$/, '') === file.replace(/\.tex$/, ''))
  ) {
    const t = pending;
    pending = null;
    return t;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 光标桥：编辑器光标位置（行/列）供批注等功能读取（与跳转桥相互独立）。
// notifyCursor 时通知全部订阅者；面板经 useSyncExternalStore(subscribeCursor, lastCursor)
// 响应式获取光标（快照为模块级对象引用，两次通知之间保持稳定，满足 getSnapshot 契约）。
// ---------------------------------------------------------------------------

export interface CursorInfo {
  file: string;
  line: number;
  col: number;
}

let cursor: CursorInfo = { file: '', line: 1, col: 1 };
const cursorListeners = new Set<(c: CursorInfo) => void>();

export function notifyCursor(info: CursorInfo): void {
  cursor = info;
  for (const cb of cursorListeners) cb(cursor);
}

export function lastCursor(): CursorInfo {
  return cursor;
}

/** 订阅光标变化（useSyncExternalStore 兼容）：返回取消订阅函数 */
export function subscribeCursor(cb: (c: CursorInfo) => void): () => void {
  cursorListeners.add(cb);
  return () => cursorListeners.delete(cb);
}
