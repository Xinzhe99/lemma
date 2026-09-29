/** 编辑器标签条：顺序渲染 openTabs，active 高亮，单击切换，× 关闭。 */

import { X } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspaceStore';

export function EditorTabs() {
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const closeTab = useWorkspaceStore((s) => s.closeTab);

  if (openTabs.length === 0) return <div className="tabbar empty" />;

  return (
    <div className="tabbar">
      {openTabs.map((path) => (
        <span
          key={path}
          className={`tab ${path === activeTab ? 'active' : ''}`}
          title={path}
          onClick={() => setActive(path)}
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
    </div>
  );
}
