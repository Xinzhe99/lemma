/**
 * 快捷键速查模态（Ctrl+/ 或 ?，sf-shortcuts）：按 全局 / 编辑 / 工作流 / 编译 分组列出真实 kbd 约定。
 * Esc 或点击遮罩关闭；触发判定导出为纯函数（isShortcutsTrigger）供全局 keydown 复用。
 */

import { Fragment, useEffect } from 'react';
import { useSettingsStore } from '../state/settingsStore';

/** 全局触发判定：Ctrl/Cmd+/，或裸 ?（输入框/文本域/编辑器内容可编辑元素内不触发） */
export function isShortcutsTrigger(
  e: { metaKey?: boolean; ctrlKey?: boolean; key: string },
  target: EventTarget | null,
): boolean {
  if ((e.metaKey || e.ctrlKey) && e.key === '/') return true;
  if (e.key === '?') {
    const el = target as HTMLElement | null;
    const typing =
      !!el &&
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable === true);
    return !typing;
  }
  return false;
}

interface ShortcutItem {
  desc: string;
  kbd: string;
}

const GROUPS: Record<'zh' | 'en', { title: string; items: ShortcutItem[] }[]> = {
  zh: [
    {
      title: '全局',
      items: [
        { desc: '命令面板', kbd: '⌘K / Ctrl+K' },
        { desc: '快速打开文件', kbd: 'Ctrl+P' },
        { desc: '快捷键帮助', kbd: 'Ctrl+/' },
        { desc: '设置', kbd: 'Ctrl+,' },
      ],
    },
    {
      title: '编辑',
      items: [
        { desc: '保存（自动持久化到工作区）', kbd: 'Ctrl+S' },
        { desc: '撤销 / 重做', kbd: 'Ctrl+Z / Ctrl+Shift+Z' },
        { desc: '查找与替换', kbd: 'Ctrl+F' },
        { desc: '缩进', kbd: 'Tab' },
      ],
    },
    {
      title: '工作流',
      items: [
        { desc: '运行工作流（润色 / 审稿 / 反驳信…）', kbd: '⌘K → 工作流' },
        { desc: 'AI 润色选中段落', kbd: '⌘K → 润色' },
        { desc: '版本历史（快照恢复）', kbd: 'Ctrl+H' },
      ],
    },
    {
      title: '编译',
      items: [{ desc: '编译当前项目', kbd: 'Ctrl+Enter' }],
    },
  ],
  en: [
    {
      title: 'Global',
      items: [
        { desc: 'Command palette', kbd: '⌘K / Ctrl+K' },
        { desc: '立即编译（保存并编译）', kbd: 'Ctrl+S / ⌘S' },
        { desc: 'Quick open file', kbd: 'Ctrl+P' },
        { desc: 'Keyboard shortcuts', kbd: 'Ctrl+/' },
        { desc: 'Settings', kbd: 'Ctrl+,' },
      ],
    },
    {
      title: 'Editor',
      items: [
        { desc: 'Save (auto-persisted to workspace)', kbd: 'Ctrl+S' },
        { desc: 'Undo / Redo', kbd: 'Ctrl+Z / Ctrl+Shift+Z' },
        { desc: 'Find & replace', kbd: 'Ctrl+F' },
        { desc: 'Indent', kbd: 'Tab' },
      ],
    },
    {
      title: 'Workflow',
      items: [
        { desc: 'Run workflow (polish / review / rebuttal…)', kbd: '⌘K → workflow' },
        { desc: 'AI-polish selection', kbd: '⌘K → polish' },
        { desc: 'Version history (snapshots)', kbd: 'Ctrl+H' },
      ],
    },
    {
      title: 'Compile',
      items: [{ desc: 'Compile current project', kbd: 'Ctrl+Enter' }],
    },
  ],
};

const STRINGS = {
  zh: { title: '快捷键', close: '关闭' },
  en: { title: 'Keyboard shortcuts', close: 'Close' },
} as const;

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sf-shortcuts-overlay" onMouseDown={onClose}>
      <div
        className="sf-shortcuts"
        role="dialog"
        aria-label={L.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="sf-shortcuts-title">{L.title}</h2>
        {GROUPS[language].map((group) => (
          <section key={group.title}>
            <h3 className="sf-shortcuts-group">{group.title}</h3>
            <div className="sf-shortcuts-grid">
              {group.items.map((item) => (
                <Fragment key={item.desc}>
                  <span className="sf-shortcuts-desc">{item.desc}</span>
                  <kbd>{item.kbd}</kbd>
                </Fragment>
              ))}
            </div>
          </section>
        ))}
        <div className="sf-shortcuts-close">
          <button className="sf-btn" onClick={onClose}>
            {L.close}
          </button>
        </div>
      </div>
    </div>
  );
}
