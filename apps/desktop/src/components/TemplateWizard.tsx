/**
 * 模板向导：选择内置模板 → 填标题/作者 → scaffoldProject 写入工作区。
 */

import { useState } from 'react';
import { listTemplates, scaffoldProject } from '@scholarforge/compile';
import { useT } from '../i18n';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useUiStore } from '../state/uiStore';

export function TemplateWizard({ onDone }: { onDone: (message: string) => void }) {
  const tr = useT();
  const templates = listTemplates();
  const loadProject = useWorkspaceStore((s) => s.loadProject);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const setTemplateWizardOpen = useUiStore((s) => s.setTemplateWizardOpen);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [title, setTitle] = useState(tr('wiz.defaultTitle'));
  const [authors, setAuthors] = useState(tr('wiz.defaultAuthors'));

  const selected = templates.find((tpl) => tpl.id === templateId);

  const create = () => {
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

  return (
    <div className="sf-dialog-overlay" onMouseDown={() => setTemplateWizardOpen(false)}>
      <div className="sf-dialog sf-wiz" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{tr('wiz.title')}</strong>
        </header>
        <div className="sf-dialog-body">
          <ul className="sf-wiz-list">
            {templates.map((tpl) => (
              <li
                key={tpl.id}
                className={`sf-wiz-item ${tpl.id === templateId ? 'active' : ''}`}
                onClick={() => setTemplateId(tpl.id)}
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
            <button className="sf-btn sf-btn--primary" onClick={create} disabled={!selected}>
              {tr('wiz.create')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
