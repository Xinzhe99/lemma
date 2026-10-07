/**
 * 应用内对话框 helper（缺陷 D2 修复）：window.confirm / window.prompt 在 Tauri WKWebView
 * 下静默失效（删除确认点了没反应、无法输入标题），统一改走 uiStore.openTextDialog →
 * TextDialog 组件（App 按 textDialog 懒加载挂载；用户确认/取消后 resolve 并 onClose
 * 自动清空请求，组件卸载也不悬挂）。范式同 FileTree.tsx 的 askText。
 */

import { useUiStore } from './state/uiStore';

/** 打开应用内文本对话框并等待用户操作（取消 / Esc / 点遮罩 → resolve(null)） */
function askText(req: {
  title: string;
  mode: 'confirm' | 'prompt';
  initial?: string;
  confirmText?: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    useUiStore.getState().openTextDialog({ ...req, resolve });
  });
}

/** 应用内 confirm（替代 window.confirm）：确认 → true；取消 → false */
export function confirmDialog(title: string, confirmText?: string): Promise<boolean> {
  return askText({ title, mode: 'confirm', confirmText }).then((answer) => answer !== null);
}

/** 应用内 prompt（替代 window.prompt）：确认 → 输入串（可为空串）；取消 → null */
export function promptDialog(title: string, initial?: string): Promise<string | null> {
  return askText({ title, mode: 'prompt', initial });
}

/** 模态浮层选择器（styles.css 的 z-index 分层）：对话框 200 / 快捷键 210 / 快速打开 150 / 命令面板 100 */
export const MODAL_OVERLAY_SELECTOR = '.sf-dialog-overlay, .sf-quickopen-overlay, .sf-shortcuts-overlay';

/**
 * 是否已有模态浮层打开。命令面板（100）与快速打开（150）层级低于对话框（200）：
 * 叠开会被对话框遮住，却仍会抢走键盘输入（用户以为「没反应」，实际输入落进看不见的浮层，
 * Enter 还可能执行命令）。故打开新浮层前先判定。
 * includePalette=false 用于命令面板自身的开关：面板开着时仍可再按一次关闭。
 */
export function isModalOverlayOpen(includePalette = true, root: ParentNode = document): boolean {
  return root.querySelector(`${MODAL_OVERLAY_SELECTOR}${includePalette ? ', .palette-overlay' : ''}`) !== null;
}
