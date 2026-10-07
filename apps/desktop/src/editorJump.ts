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
  // 注意：jumpTo 的调用方（大纲/报告/批注链接）传的是工作区键；SyncTeX 反查的
  // 物化目录路径由 synctexBridge 先经 resolveToWorkspaceFile 解析后再进来。
  pending = target;
  useWorkspaceStore.getState().openFile(target.file);
  useUiStore.getState().setCenterView('editor');
}

/**
 * v7.9.5：SyncTeX 反查返回的 file 可能是引擎物化目录下的路径（Windows 绝对路径、
 * 带 ./ 前缀或反斜杠），与工作区键（项目相对路径）不一致——直接 openFile 会
 * 开出内容为空的同名新标签（用户看到「点击 PDF 凭空多出一个空的 main.tex」）。
 * 解析顺序：精确 → 归一化（反斜杠→斜杠 / 去 ./ 与尾部斜杠 / 压缩双斜杠）→
 * 相对后缀唯一匹配 → basename 唯一匹配；解析失败返回 null（调用方跳过本次跳转）。
 */
export function resolveToWorkspaceFile(file: string): string | null {
  const ws = useWorkspaceStore.getState();
  const norm = (p: string): string =>
    p.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  const target = norm(file);
  if (target in ws.files) return target;
  const keys = Object.keys(ws.files).map((key) => ({ key, n: norm(key) }));
  const bySuffix = keys.filter((k) => k.n.endsWith('/' + target) || target.endsWith('/' + k.n));
  if (bySuffix.length === 1) return bySuffix[0]!.key;
  const base = target.split('/').pop() ?? '';
  const byBase = keys.filter((k) => k.n.split('/').pop() === base);
  return byBase.length === 1 ? byBase[0]!.key : null;
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
