/**
 * 表格代码 → 编辑器光标插入桥。模式同 editorJump.ts：
 * EditorArea 挂载时注册 handler（dispatch replaceSelection + focus），卸载时清理；
 * TableEditor 调用 insertAtCursor 把 tabular 代码写入当前编辑器光标处。
 */

let handler: ((code: string) => void) | null = null;

export function setInsertHandler(fn: ((code: string) => void) | null): void {
  handler = fn;
}

/** 插入到当前编辑器光标处；无可用 handler（编辑器未挂载）返回 false，调用方据此保持对话框打开 */
export function insertAtCursor(code: string): boolean {
  if (!handler) return false;
  handler(code);
  return true;
}
