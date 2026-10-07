/**
 * 会话管理面板（v5.6.0 Codex 式两级结构）：
 * 项目分组 → 项目下多个会话。
 * - 新建项目：正式 sf-dialog（名称 + 本地文件夹选择，NewProjectDialog）+ 自动切入 + 建首个会话；
 * - 项目组：点击折叠/展开，hover 出「打开 / 重命名 / 删除」；
 *   删除项目仅解除归属（会话移入「未分组」），不删数据；
 * - 会话项：点击切换，hover 出「重命名 / 删除」；
 * - 项目名 = 会话的 projectName 隔离键（与 workspace.projectName / projectsStore 记录一致）；
 * - 空态（无项目无会话）：引导创建第一个项目。
 */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FilePlus2, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useProjectsStore } from '../state/projectsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { confirmDialog, promptDialog } from '../dialogs';
import { openProjectWithDiskSync } from '../state/projectDisk';
import { useT } from '../i18n';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';

/** 未分组会话的组键（projectName 为空的旧会话） */
const UNGROUPED = '__ungrouped__';
const UNGROUPED_LABEL_KEY = 'sessions.ungrouped';

export function SessionsPanel() {
  const t = useT();
  // v7.8.0：语言进依赖——此前分组标签只在 sessions/projects 变化时重算，
  // 设置里切到英文后「未分组」仍是中文（要等会话变动才刷新）
  const language = useSettingsStore((s) => s.language);
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
      label: key === UNGROUPED ? t(UNGROUPED_LABEL_KEY) : key,
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
  }, [sessions, projects, projectName, language]); // language：t 的取值随语言变化（见上）

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const onCreateSession = () => {
    // v7.5.0：默认标题随界面语言（此前硬编码「新会话」）
    useAgentHubStore.getState().newSession('host', projectName || undefined, t('sessions.newSession'));
  };

  const onCreateProject = () => {
    // 新建项目走正式对话框（名称 + 本地文件夹选择 + 物化），会话由对话框创建后统一建首个
    useUiStore.getState().setNewProjectDialogOpen(true);
  };

  const onOpenProject = (id: string) => {
    // 打开并与其本地目录增量同步（磁盘有而记录无 → 并入；磁盘更新 → 以磁盘为准），提示合并数
    void openProjectWithDiskSync(id).then((res) => {
      if (!res.opened) return;
      if (res.sync && (res.sync.merged.length > 0 || res.sync.updated.length > 0)) {
        useUiStore
          .getState()
          .showToast(t('toast.diskSync', { merged: res.sync.merged.length, updated: res.sync.updated.length }));
      }
    });
  };

  const onRenameProject = async (key: string, recordId?: string) => {
    const input = await promptDialog(t('sessions.renameProject'), key);
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
        t('sessions.deleteProjectConfirmTitle', { name: key }),
        t('sessions.delete'),
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
    const title = await promptDialog(t('sessions.renameSessionTitle'), current);
    if (title && title.trim()) useAgentHubStore.getState().renameSession(id, title.trim());
  };

  const onDeleteSession = async (id: string) => {
    if (!(await confirmDialog(t('sessions.deleteSessionConfirmTitle'), t('sessions.delete')))) return;
    setBusy(true);
    try {
      useAgentHubStore.getState().deleteSession(id);
    } finally {
      setBusy(false);
    }
  };

  const renderSession = (s: (typeof sessions)[number]) => {
    const last = s.messages[s.messages.length - 1];
    const preview = last?.content.replace(/\s+/g, ' ').trim().slice(0, 48) || t('sessions.emptySession');;
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
          <span>{s.messages.length}{t('sessions.msgCount')}</span>
          <button
            type="button"
            title={t('sessions.rename')}
            onClick={(e) => {
              e.stopPropagation();
              void onRenameSession(s.id, s.title);
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            type="button"
            title={t('sessions.delete')}
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
        <button type="button" className="sf-pill-btn" onClick={onCreateSession} title={t('sessions.newSessionHint')}>
          <FilePlus2 size={13} /> {t('sessions.newSession')}
        </button>
        <button type="button" className="sf-pill-btn" onClick={() => void onCreateProject()} disabled={busy} title={t('sessions.newProject')}>
          <FolderPlus size={13} /> {t('sessions.newProject')}
        </button>
      </div>
      {groups.length === 0 && (
        <div className="sf-sessions-empty" data-testid="sessions-empty-guide">
          <p className="sf-sessions-empty-text">{t('sessions.emptyGuide')}</p>
          <button type="button" className="sf-pill-btn" onClick={onCreateProject}>
            <FolderPlus size={13} /> {t('sessions.newProject')}
          </button>
        </div>
      )}
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
                  <button type="button" title={t('sessions.openProject')} onClick={() => onOpenProject(g.record!.id)}>
                    ↗
                  </button>
                ) : null}
                <button
                  type="button"
                  title={t('sessions.renameProject')}
                  onClick={() => void onRenameProject(g.key, g.record?.id)}
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title={t('sessions.deleteProject')}
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
                  <div className="sf-sessions-item dim">{t('sessions.noSessionsInGroup')}</div>
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
