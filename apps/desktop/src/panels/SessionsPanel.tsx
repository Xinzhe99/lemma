/**
 * 会话管理面板（v5.6.0 Codex 式两级结构）：
 * 项目分组 → 项目下多个会话。
 * - 新建项目：空模板 + 自动切入 + 建首个会话；
 * - 项目组：点击折叠/展开，hover 出「打开 / 重命名 / 删除」；
 *   删除项目仅解除归属（会话移入「未分组」），不删数据；
 * - 会话项：点击切换，hover 出「重命名 / 删除」；
 * - 项目名 = 会话的 projectName 隔离键（与 workspace.projectName / projectsStore 记录一致）。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useProjectsStore } from '../state/projectsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { confirmDialog, promptDialog } from '../dialogs';

/** 未分组会话的组键（projectName 为空的旧会话） */
const UNGROUPED = '__ungrouped__';
const UNGROUPED_LABEL = '未分组';

/** 新项目的最小可编译模板 */
const NEW_PROJECT_FILES: Record<string, string> = {
  'main.tex': [
    '\\documentclass{article}',
    '\\usepackage{amsmath,graphicx,hyperref}',
    '',
    '\\title{新论文}',
    '\\author{}',
    '\\date{\\today}',
    '',
    '\\begin{document}',
    '\\maketitle',
    '',
    '\\section{引言}',
    '从这里开始写。',
    '',
    '\\end{document}',
    '',
  ].join('\n'),
};

export function SessionsPanel() {
  const sessions = useAgentHubStore((s) => s.sessions);
  const activeSessionId = useAgentHubStore((s) => s.activeSessionId);
  const projects = useProjectsStore((s) => s.projects);
  const projectName = useWorkspaceStore((s) => s.projectName);
  /** 折叠的组键集合（默认全部展开） */
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);

  // 组顺序：当前项目 → 其他项目记录（新在前）→ 未分组
  const groups = useMemo(() => {
    const byKey = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const key = s.projectName || UNGROUPED;
      const list = byKey.get(key) ?? [];
      list.push(s);
      byKey.set(key, list);
    }
    const keys: string[] = [];
    const cur = projectName || UNGROUPED;
    keys.push(cur);
    for (const p of projects) {
      if (p.name !== cur && !keys.includes(p.name)) keys.push(p.name);
    }
    // 会话里有、但既不是当前项目也不是项目记录的名字（记录被挤掉/改名前的残留）
    for (const key of byKey.keys()) {
      if (key !== UNGROUPED && !keys.includes(key)) keys.push(key);
    }
    if (byKey.has(UNGROUPED) && !keys.includes(UNGROUPED)) keys.push(UNGROUPED);
    return keys.map((key) => ({
      key,
      label: key === UNGROUPED ? UNGROUPED_LABEL : key,
      isCurrent: key === cur,
      record: projects.find((p) => p.name === key),
      sessions: (byKey.get(key) ?? [])
        .slice()
        .sort(
          (a, b) =>
            (b.messages[b.messages.length - 1]?.createdAt ?? 0) -
            (a.messages[a.messages.length - 1]?.createdAt ?? 0),
        ),
    }));
  }, [sessions, projects, projectName]);

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onCreateSession = () => {
    useAgentHubStore.getState().newSession('host', projectName || undefined);
  };

  const onCreateProject = async () => {
    const input = await promptDialog('新建项目', '新论文');
    const name = input?.trim();
    if (!name) return;
    setBusy(true);
    try {
      useWorkspaceStore.getState().loadProject(name, 'main.tex', { ...NEW_PROJECT_FILES });
      useProjectsStore.getState().saveCurrent(name);
      useAgentHubStore.getState().newSession('host', name);
    } finally {
      setBusy(false);
    }
  };

  const onOpenProject = (id: string) => {
    useProjectsStore.getState().openProject(id);
  };

  const onRenameProject = async (key: string, recordId?: string) => {
    const input = await promptDialog('重命名项目', key);
    const name = input?.trim();
    if (!name || name === key) return;
    if (recordId) {
      useProjectsStore.getState().renameProject(recordId, name);
    }
    // 同步：当前项目名 + 该项目下所有会话的归属键
    if (key === projectName) {
      useWorkspaceStore.setState({ projectName: name });
    }
    useAgentHubStore.setState({
      sessions: useAgentHubStore.getState().sessions.map((s) =>
        s.projectName === key ? { ...s, projectName: name } : s,
      ),
    });
  };

  const onDeleteProject = async (key: string, recordId?: string) => {
    if (
      !(await confirmDialog(
        `删除项目「${key}」？`,
        '只删除项目分组（项目文件记录一并移除），其下会话将移入「未分组」，不会丢失。',
      ))
    ) {
      return;
    }
    setBusy(true);
    try {
      if (recordId) useProjectsStore.getState().removeProject(recordId);
      useAgentHubStore.setState({
        sessions: useAgentHubStore.getState().sessions.map((s) =>
          s.projectName === key ? { ...s, projectName: '' } : s,
        ),
      });
    } finally {
      setBusy(false);
    }
  };

  const onRenameSession = async (id: string, current: string) => {
    const title = await promptDialog('重命名会话', current);
    if (title && title.trim()) useAgentHubStore.getState().renameSession(id, title.trim());
  };

  const onDeleteSession = async (id: string) => {
    if (!(await confirmDialog('删除该会话？', '会话消息将一并删除，不可恢复。'))) return;
    setBusy(true);
    try {
      useAgentHubStore.getState().deleteSession(id);
    } finally {
      setBusy(false);
    }
  };

  const renderSession = (s: (typeof sessions)[number]) => {
    const last = s.messages[s.messages.length - 1];
    const preview = last?.content.replace(/\s+/g, ' ').trim().slice(0, 48) || '（空会话）';
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
              void onRenameSession(s.id, s.title);
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
              void onDeleteSession(s.id);
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="sf-sessions">
      <div className="sf-sessions-actions">
        <button type="button" className="sf-pill-btn" onClick={onCreateSession} title="在当前项目下新建会话">
          <FilePlus2 size={13} /> 新会话
        </button>
        <button type="button" className="sf-pill-btn" onClick={() => void onCreateProject()} disabled={busy} title="新建项目（空模板 + 首个会话）">
          <FolderPlus size={13} /> 新建项目
        </button>
      </div>
      {groups.map((g) => {
        const isCollapsed = collapsed.has(g.key);
        return (
          <div key={g.key} className="sf-sessions-group">
            <div
              className={`sf-sessions-group-head ${g.isCurrent ? 'current' : ''}`}
              onClick={() => toggle(g.key)}
            >
              {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              <span className="sf-sessions-group-name" title={g.label}>
                {g.label}
              </span>
              <span className="sf-sessions-group-count">{g.sessions.length}</span>
              <span className="sf-sessions-group-actions" onClick={(e) => e.stopPropagation()}>
                {g.record && !g.isCurrent ? (
                  <button type="button" title="打开此项目" onClick={() => onOpenProject(g.record!.id)}>
                    ↗
                  </button>
                ) : null}
                <button
                  type="button"
                  title="重命名项目"
                  onClick={() => void onRenameProject(g.key, g.record?.id)}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title="删除项目"
                  disabled={busy}
                  onClick={() => {
                    const recordId = g.record?.id;
                    void onDeleteProject(g.key, recordId);
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </span>
            </div>
            {!isCollapsed && (
              <div className="sf-sessions-group-body">
                {g.sessions.length === 0 ? (
                  <div className="sf-sessions-item dim">（无会话——点「新会话」开始）</div>
                ) : (
                  g.sessions.map(renderSession)
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
