/** 编辑器标签条：顺序渲染 openTabs，active 高亮，单击切换，× 关闭；右侧可挂动作位。
 *  v7.9.1：标签可拖入 AI 对话框（HTML5 DnD，application/x-lemma-paths），
 *  右键弹出菜单支持「添加到对话」（经 uiStore.requestAddToChat 桥接到 AgentPanel）。
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspaceStore';

export const TAB_PATHS_MIME = 'application/x-lemma-paths';

export function EditorTabs({
  actions,
  onAddToConversation,
  addToConversationLabel = '添加到对话',
  closeTabLabel = '关闭标签',
}: {
  actions?: ReactNode;
  /** 右键菜单「添加到对话」回调；不传则右键无菜单 */
  onAddToConversation?: (path: string) => void;
  addToConversationLabel?: string;
  closeTabLabel?: string;
}) {
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  /** 右键菜单（fixed 定位在光标处；点击任意处关闭） */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 点外部 / Esc 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  if (openTabs.length === 0) return <div className="tabbar empty" />;

  return (
    <div className="tabbar">
      {openTabs.map((path) => (
        <span
          key={path}
          className={`tab ${path === activeTab ? 'active' : ''}`}
          title={path}
          onClick={() => setActive(path)}
          // v7.9.1：可拖入 AI 对话框（拖拽负载 = 工作区相对路径数组）
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(TAB_PATHS_MIME, JSON.stringify([path]));
            e.dataTransfer.setData('text/plain', path);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onContextMenu={(e) => {
            if (!onAddToConversation) return;
            e.preventDefault();
            setMenu({ x: e.clientX, y: e.clientY, path });
          }}
        >
          <span className="tab-name">{path.split('/').pop()}</span>
          <button
            className="tab-close"
            title={path}
            onClick={(e) => {
              e.stopPropagation();
              closeTab(path);
            }}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      {actions && <div className="tabbar-actions">{actions}</div>}
      {menu && (
        <div className="sf-tab-menu" style={{ left: menu.x, top: menu.y }} ref={menuRef}>
          {onAddToConversation && (
            <button
              type="button"
              className="sf-tab-menu-item"
              onClick={() => {
                onAddToConversation(menu.path);
                setMenu(null);
              }}
            >
              {addToConversationLabel}
            </button>
          )}
          <button
            type="button"
            className="sf-tab-menu-item"
            onClick={() => {
              closeTab(menu.path);
              setMenu(null);
            }}
          >
            {closeTabLabel}
          </button>
        </div>
      )}
    </div>
  );
}
