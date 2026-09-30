/**
 * 模板向导：选择内置模板 → 填标题/作者 → scaffoldProject 写入工作区。
 * 自定义模板扩展（templatesStore）：
 *  - 模板列表顶部「自定义模板」区（name + 描述 + 文件数 + savedAt，可选中）；
 *    选中后创建直接以其 entry + files 调 loadProject（不走 scaffoldProject）；
 *  - 底部「保存当前项目为模板」折叠区（name/description 输入 + 保存 → saveFromWorkspace，
 *    成功 inline 提示、失败显示原因）。
 * 新增文案为组件内 zh/en 字典；既有文案仍走全局 i18n。
 */

import { useState } from 'react';
import { listTemplates, scaffoldProject } from '@scholarforge/compile';
import { useT } from '../i18n';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useUiStore } from '../state/uiStore';
import { useTemplatesStore, type UserTemplate } from '../state/templatesStore';

// ---------------------------------------------------------------------------
// 双语文案（组件内字典：zh / en）
// ---------------------------------------------------------------------------

interface Dict {
  userSection: string;
  userFiles: (n: number) => string;
  noDescription: string;
  saveToggle: string;
  saveName: string;
  saveDesc: string;
  saveBtn: string;
  saveNeedName: string;
  saveNoFiles: string;
  saveTooMany: (max: number) => string;
  savedMsg: (name: string) => string;
}

const DICT: Record<Language, Dict> = {
  zh: {
    userSection: '自定义模板',
    userFiles: (n) => `${n} 个文件`,
    noDescription: '（无描述）',
    saveToggle: '保存当前项目为模板',
    saveName: '模板名',
    saveDesc: '描述（可选）',
    saveBtn: '保存模板',
    saveNeedName: '保存失败：请输入模板名',
    saveNoFiles: '保存失败：当前项目没有文件',
    saveTooMany: (max) => `保存失败：文件数超过 ${max} 上限`,
    savedMsg: (name) => `已保存模板「${name}」，可在上方自定义模板区选用`,
  },
  en: {
    userSection: 'Custom templates',
    userFiles: (n) => `${n} files`,
    noDescription: '(no description)',
    saveToggle: 'Save current project as template',
    saveName: 'Template name',
    saveDesc: 'Description (optional)',
    saveBtn: 'Save template',
    saveNeedName: 'Save failed: enter a template name',
    saveNoFiles: 'Save failed: the current project has no files',
    saveTooMany: (max) => `Save failed: more than ${max} files`,
    savedMsg: (name) => `Template "${name}" saved; pick it from the custom section above`,
  },
};

interface SaveMsg {
  ok: boolean;
  text: string;
}

export function TemplateWizard({ onDone }: { onDone: (message: string) => void }) {
  const tr = useT();
  const lang = useSettingsStore((s) => s.language);
  const d = DICT[lang];
  const templates = listTemplates();
  const loadProject = useWorkspaceStore((s) => s.loadProject);
  const wsFiles = useWorkspaceStore((s) => s.files);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const setTemplateWizardOpen = useUiStore((s) => s.setTemplateWizardOpen);

  const userTemplates = useTemplatesStore((s) => s.templates);
  const saveFromWorkspace = useTemplatesStore((s) => s.saveFromWorkspace);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  /** 选中的自定义模板 id（与内置模板选中互斥） */
  const [userTplId, setUserTplId] = useState('');
  const [title, setTitle] = useState(tr('wiz.defaultTitle'));
  const [authors, setAuthors] = useState(tr('wiz.defaultAuthors'));

  // 「保存当前项目为模板」折叠区（默认折叠）
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveMsg, setSaveMsg] = useState<SaveMsg | null>(null);

  const selected = templates.find((tpl) => tpl.id === templateId);
  const selectedUser = userTemplates.find((t) => t.id === userTplId);

  const create = () => {
    if (selectedUser) {
      // 自定义模板：直接以保存时的 entry + files 载入（不走 scaffoldProject）
      loadProject(title.trim() || selectedUser.name, selectedUser.entry, { ...selectedUser.files });
      setSidebarTab('files');
      setTemplateWizardOpen(false);
      onDone(tr('wiz.created', { name: selectedUser.name }));
      return;
    }
    if (!selected) return;
    const fileMap = scaffoldProject(selected.id, {
      title: title.trim() || tr('wiz.defaultTitle'),
      authors: authors.trim() || tr('wiz.defaultAuthors'),
      DATE: new Date().toISOString().slice(0, 10),
      VENUE: selected.venue,
      ABSTRACT: tr('wiz.defaultAbstract'),
    });
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(fileMap)) {
      files[path] = typeof content === 'string' ? content : new TextDecoder().decode(content);
    }
    loadProject(title.trim() || selected.id, selected.entry, files);
    setSidebarTab('files');
    setTemplateWizardOpen(false);
    onDone(tr('wiz.created', { name: selected.name }));
  };

  /** 保存当前项目为模板：成功 inline 提示；失败按原因提示（名称 / 文件数） */
  const saveTemplate = () => {
    const name = saveName.trim();
    if (!name) {
      setSaveMsg({ ok: false, text: d.saveNeedName });
      return;
    }
    if (!saveFromWorkspace(name, saveDesc)) {
      const count = Object.keys(wsFiles).length;
      setSaveMsg({
        ok: false,
        text: count === 0 ? d.saveNoFiles : d.saveTooMany(50),
      });
      return;
    }
    setSaveMsg({ ok: true, text: d.savedMsg(name) });
    setSaveName('');
    setSaveDesc('');
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={() => setTemplateWizardOpen(false)}>
      <div className="sf-dialog sf-wiz" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{tr('wiz.title')}</strong>
        </header>
        <div className="sf-dialog-body">
          {userTemplates.length > 0 && (
            <div className="sf-wiz-user" style={{ marginBottom: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--fg-2)',
                  margin: '0 0 6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <strong style={{ color: 'var(--fg-1)' }}>{d.userSection}</strong>
                <span className="sf-chip">{userTemplates.length}</span>
              </div>
              <ul className="sf-wiz-list">
                {userTemplates.map((tpl: UserTemplate) => (
                  <li
                    key={tpl.id}
                    className={`sf-wiz-item ${tpl.id === userTplId ? 'active' : ''}`}
                    onClick={() => {
                      setUserTplId(tpl.id === userTplId ? '' : tpl.id);
                      setTemplateId('');
                    }}
                  >
                    <strong>{tpl.name}</strong>
                    <span>{tpl.description || d.noDescription}</span>
                    <span>
                      {d.userFiles(Object.keys(tpl.files).length)} ·{' '}
                      {new Date(tpl.savedAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ul className="sf-wiz-list">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className={`sf-wiz-item ${tpl.id === templateId && !selectedUser ? 'active' : ''}`}
                onClick={() => {
                  setTemplateId(tpl.id);
                  setUserTplId('');
                }}
              >
                <strong>{tpl.name}</strong>
                <span>{tpl.description}</span>
              </li>
            ))}
          </ul>
          <label className="sf-form-field">
            {tr('wiz.fieldTitle')}
            <input className="sf-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="sf-form-field">
            {tr('wiz.fieldAuthors')}
            <input className="sf-input" value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={() => setTemplateWizardOpen(false)}>
              {tr('wiz.cancel')}
            </button>
            <button className="sf-btn sf-btn--primary" onClick={create} disabled={!selected && !selectedUser}>
              {tr('wiz.create')}
            </button>
          </div>
          <div
            className="sf-wiz-save"
            style={{ borderTop: '1px solid var(--border)', marginTop: 10, paddingTop: 8 }}
          >
            <button className="sf-btn" onClick={() => setSaveOpen((v) => !v)}>
              {saveOpen ? '▾' : '▸'} {d.saveToggle}
            </button>
            {saveOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <label className="sf-form-field">
                  {d.saveName}
                  <input
                    className="sf-input"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                </label>
                <label className="sf-form-field">
                  {d.saveDesc}
                  <input
                    className="sf-input"
                    value={saveDesc}
                    onChange={(e) => setSaveDesc(e.target.value)}
                  />
                </label>
                <div className="sf-lib-dialog-actions">
                  <button className="sf-btn sf-btn--primary" onClick={saveTemplate}>
                    {d.saveBtn}
                  </button>
                </div>
                {saveMsg && (
                  <p
                    className="placeholder"
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: saveMsg.ok ? 'var(--fg-2)' : 'var(--warn)',
                    }}
                  >
                    {saveMsg.text}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
