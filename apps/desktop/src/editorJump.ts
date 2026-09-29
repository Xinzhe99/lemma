/**
 * 大纲/SyncTeX → 编辑器的行级跳转桥。
 * EditorArea 挂载时注册 handler；面板调用 jumpTo；跨文件跳转先暂存，待目标文件编辑器就绪后消费。
 */

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
  if (handler) handler(target);
  else pending = target;
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
