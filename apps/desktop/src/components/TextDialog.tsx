/**
 * 应用内文本对话框（sf-dialog 结构）：替代原生 prompt/confirm 对话框的统一入口
 * （Tauri WKWebView 下原生对话框不可用，故全部走此组件）。
 * 由 uiStore.textDialog（TextDialogRequest）驱动，App 以懒加载方式挂载：
 * - prompt 模式：标题 + 输入框（initial 初值 / placeholder 占位），确认时 resolve(输入值)；
 * - confirm 模式：标题 + 确认/取消按钮（confirmText 可覆盖确认文案），确认时 resolve(非空串)；
 * - 取消（取消按钮 / Esc / 点击遮罩）一律 resolve(null)，随后 onClose() 关闭对话框。
 * resolve 的值由调用方（FileTree / commands / ProjectSwitcher）在各自包装的 Promise 中消费。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';

const STRINGS = {
  zh: { cancel: '取消', confirm: '确定' },
  en: { cancel: 'Cancel', confirm: 'OK' },
} as const;

export function TextDialog({ onClose }: { onClose: () => void }) {
  const request = useUiStore((s) => s.textDialog);
  const language = useSettingsStore((s) => s.language);
  const [value, setValue] = useState(request?.initial ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const L = STRINGS[language];

  // 请求变化时同步输入框初值（对话框按需挂载，通常整树重建；此处为防御性同步）
  useEffect(() => {
    setValue(request?.initial ?? '');
  }, [request]);

  // prompt 模式：挂载即聚焦并全选初值，便于直接输入覆盖
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const cancel = useCallback(() => {
    useUiStore.getState().textDialog?.resolve(null);
    onClose();
  }, [onClose]);

  const confirm = useCallback(() => {
    const req = useUiStore.getState().textDialog;
    if (!req) return;
    req.resolve(value);
    onClose();
  }, [onClose, value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancel]);

  if (!request) return null;

  return (
    <div className="sf-dialog-overlay" onMouseDown={cancel}>
      <div
        className="sf-dialog sf-text-dialog"
        role="dialog"
        aria-label={request.title}
        style={{ width: 440 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{request.title}</strong>
        </header>
        <div className="sf-dialog-body" style={{ minHeight: 0 }}>
          {request.mode === 'prompt' && (
            <input
              ref={inputRef}
              className="sf-input"
              style={{ width: '100%' }}
              value={value}
              placeholder={request.placeholder}
              spellCheck={false}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
            />
          )}
          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" data-action="cancel" onClick={cancel}>
              {L.cancel}
            </button>
            <button className="sf-btn primary" data-action="confirm" onClick={confirm}>
              {request.confirmText ?? L.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
