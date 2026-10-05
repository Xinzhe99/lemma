/**
 * 会话列表面板（v5.0.0 Codex 式布局）：
 * 一个论文项目下的全部 AI 会话——新建、切换、重命名、删除。
 * 会话按 projectName 隔离（旧会话无归属时在「全部」可见）。
 */
import { useMemo, useState } from 'react';
import { MessageSquarePlus, Pencil, Trash2 } from 'lucide-react';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useWorkspaceStore } from '../state/workspaceStore';
import { confirmDialog, promptDialog } from '../dialogs';

export function SessionsPanel() {
  const sessions = useAgentHubStore((s) => s.sessions);
  const activeSessionId = useAgentHubStore((s) => s.activeSessionId);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const [busy, setBusy] = useState(false);

  // 当前项目的会话在前；无归属的旧会话也列出（projectName 为空 = 全部可见）
  const visible = useMemo(
    () =>
      sessions.filter((s) => !s.projectName || s.projectName === projectName),
    [sessions, projectName],
  );

  const onCreate = () => {
    useAgentHubStore.getState().newSession('host', projectName || undefined);
  };

  const onRename = async (id: string, current: string) => {
    const title = await promptDialog('重命名会话', current);
    if (title && title.trim()) useAgentHubStore.getState().renameSession(id, title.trim());
  };

  const onDelete = async (id: string) => {
    if (!(await confirmDialog('删除该会话？', '会话消息将一并删除，不可恢复。'))) return;
    setBusy(true);
    try {
      useAgentHubStore.getState().deleteSession(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-sessions">
      <button type="button" className="sf-sessions-new" onClick={onCreate}>
        <MessageSquarePlus size={14} /> 新会话
      </button>
      {visible.length === 0 ? (
        <p className="placeholder">还没有会话——点「新会话」开始与 AI 协作。</p>
      ) : (
        visible.map((s) => {
          const last = s.messages[s.messages.length - 1];
          const preview =
            last?.content.replace(/\s+/g, ' ').trim().slice(0, 60) || '（空会话）';
          return (
            <div
              key={s.id}
              className={`sf-sessions-item ${s.id === activeSessionId ? 'active' : ''}`}
              onClick={() => useAgentHubStore.getState().setActiveSession(s.id)}
            >
              <div className="sf-sessions-item-title" title={s.title}>
                {s.title}
              </div>
              <div className="sf-sessions-item-preview">{preview}</div>
              <div className="sf-sessions-item-meta">
                <span>{s.messages.length} 条</span>
                <button
                  type="button"
                  title="重命名"
                  onClick={(e) => {
                    e.stopPropagation();
                    void onRename(s.id, s.title);
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  title="删除"
                  disabled={busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onDelete(s.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
