/**
 * 多项目管理对话框（sf-projects-*）：保存当前项目 / 打开 / 重命名（行内输入）/ 复制 / 删除（应用内确认对话框）/
 * 新建空白项目。挂载时自动把当前工作区写入固定 id（__current__）的临时记录供崩溃恢复，
 * 列表置顶展示「当前（未保存快照）」，可一键转正式保存。
 * 模态结构复用 sf-dialog 系列类；文案使用组件内 zh/en 本地字典（跟随 settingsStore.language）。
 */

import { useEffect, useState } from 'react';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { CURRENT_PROJECT_ID, useProjectsStore, type ProjectRecord } from '../state/projectsStore';

const STRINGS = {
  zh: {
    title: '项目管理',
    saveLabel: '保存当前项目',
    savePlaceholder: '项目名称…',
    save: '保存',
    newBlank: '新建空白项目',
    currentBadge: '当前（未保存快照）',
    promote: '转正式保存',
    open: '打开',
    rename: '重命名',
    duplicate: '复制',
    remove: '删除',
    confirm: '确定',
    cancel: '取消',
    close: '关闭',
    empty: '暂无已保存项目——先在上方保存当前项目。',
    confirmRemove: (name: string) => `确定删除项目「${name}」？该操作不可撤销。`,
    filesUnit: (n: number) => `${n} 个文件`,
  },
  en: {
    title: 'Projects',
    saveLabel: 'Save current project',
    savePlaceholder: 'Project name…',
    save: 'Save',
    newBlank: 'New blank project',
    currentBadge: 'Current (unsaved snapshot)',
    promote: 'Save as record',
    open: 'Open',
    rename: 'Rename',
    duplicate: 'Duplicate',
    remove: 'Delete',
    confirm: 'OK',
    cancel: 'Cancel',
    close: 'Close',
    empty: 'No saved projects yet — save the current project above.',
    confirmRemove: (name: string) => `Delete project "${name}"? This cannot be undone.`,
    filesUnit: (n: number) => `${n} files`,
  },
} as const;

type Dict = (typeof STRINGS)['zh'] | (typeof STRINGS)['en'];

/** 新建空白项目的最小可编译模板 */
const BLANK_MAIN_TEX = `\\documentclass[11pt]{article}
\\begin{document}
\\section{Introduction}
Start writing here.
\\end{document}
`;

export function ProjectSwitcher({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const projects = useProjectsStore((s) => s.projects);
  const saveCurrent = useProjectsStore((s) => s.saveCurrent);
  const openProject = useProjectsStore((s) => s.openProject);
  const removeProject = useProjectsStore((s) => s.removeProject);
  const renameProject = useProjectsStore((s) => s.renameProject);
  const duplicateProject = useProjectsStore((s) => s.duplicateProject);
  const saveCurrentTemp = useProjectsStore((s) => s.saveCurrentTemp);
  const promoteCurrent = useProjectsStore((s) => s.promoteCurrent);

  const [nameInput, setNameInput] = useState(projectName);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const L: Dict = STRINGS[language];

  // P1 崩溃恢复：挂载即把当前工作区写入临时记录（幂等覆盖），供下次启动/列表置顶转正式保存
  useEffect(() => {
    saveCurrentTemp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 应用内确认对话框（删除确认）打开时，Esc 属于对话框的取消操作，不关闭本面板
      if (e.key === 'Escape' && !useUiStore.getState().textDialog) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const temp = projects.find((p) => p.id === CURRENT_PROJECT_ID) ?? null;
  const saved = projects.filter((p) => p.id !== CURRENT_PROJECT_ID);

  const handleSave = () => {
    saveCurrent(nameInput.trim() || undefined);
  };

  const open = (id: string) => {
    if (openProject(id)) onClose();
  };

  const newBlank = () => {
    useWorkspaceStore.getState().loadProject('未命名项目', 'main.tex', { 'main.tex': BLANK_MAIN_TEX });
    onClose();
  };

  const remove = (rec: ProjectRecord) => {
    // 删除确认走应用内文本对话框（confirm 模式）：取消（null）保留，确认后移除
    void new Promise<string | null>((resolve) => {
      useUiStore.getState().openTextDialog({
        title: L.confirmRemove(rec.name),
        mode: 'confirm',
        confirmText: L.remove,
        resolve,
      });
    }).then((answer) => {
      if (answer === null) return;
      removeProject(rec.id);
    });
  };

  const startRename = (rec: ProjectRecord) => {
    setRenamingId(rec.id);
    setRenameValue(rec.name);
  };

  const confirmRename = () => {
    if (renamingId) renameProject(renamingId, renameValue);
    setRenamingId(null);
  };

  const meta = (rec: ProjectRecord) =>
    `${L.filesUnit(Object.keys(rec.snapshot.files).length)} · ${new Date(rec.savedAt).toLocaleString()}`;

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-projects" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <div className="sf-projects-toolbar">
            <label className="sf-projects-save-label" htmlFor="sf-projects-save-input">
              {L.saveLabel}
            </label>
            <input
              id="sf-projects-save-input"
              className="sf-projects-save-input"
              placeholder={L.savePlaceholder}
              value={nameInput}
              spellCheck={false}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSave();
              }}
            />
            <button className="sf-btn" onClick={handleSave}>
              {L.save}
            </button>
            <button className="sf-btn" onClick={newBlank}>
              {L.newBlank}
            </button>
          </div>

          <ul className="sf-projects-list">
            {temp && (
              <li className="sf-projects-row current">
                <div className="sf-projects-main">
                  <span className="sf-projects-name">
                    {temp.name} <em className="sf-chip">{L.currentBadge}</em>
                  </span>
                  <span className="sf-projects-meta">{meta(temp)}</span>
                </div>
                <div className="sf-projects-actions">
                  <button className="sf-btn" onClick={() => promoteCurrent()}>
                    {L.promote}
                  </button>
                </div>
              </li>
            )}
            {saved.map((rec) =>
              renamingId === rec.id ? (
                <li key={rec.id} className="sf-projects-row">
                  <div className="sf-projects-rename">
                    <input
                      className="sf-projects-rename-input"
                      value={renameValue}
                      autoFocus
                      spellCheck={false}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') confirmRename();
                        else if (e.key === 'Escape') setRenamingId(null);
                      }}
                    />
                    <button className="sf-btn" onClick={confirmRename}>
                      {L.confirm}
                    </button>
                    <button className="sf-btn" onClick={() => setRenamingId(null)}>
                      {L.cancel}
                    </button>
                  </div>
                </li>
              ) : (
                <li key={rec.id} className="sf-projects-row">
                  <div className="sf-projects-main">
                    <span className="sf-projects-name">{rec.name}</span>
                    <span className="sf-projects-meta">{meta(rec)}</span>
                  </div>
                  <div className="sf-projects-actions">
                    <button className="sf-btn" onClick={() => open(rec.id)}>
                      {L.open}
                    </button>
                    <button className="sf-btn" onClick={() => startRename(rec)}>
                      {L.rename}
                    </button>
                    <button className="sf-btn" onClick={() => duplicateProject(rec.id)}>
                      {L.duplicate}
                    </button>
                    <button className="sf-btn" onClick={() => remove(rec)}>
                      {L.remove}
                    </button>
                  </div>
                </li>
              ),
            )}
            {saved.length === 0 && !temp && <li className="placeholder">{L.empty}</li>}
          </ul>

          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={onClose}>
              {L.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
