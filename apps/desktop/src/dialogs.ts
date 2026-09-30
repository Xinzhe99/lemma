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
