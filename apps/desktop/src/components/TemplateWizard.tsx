/**
 * 模板向导：选择内置模板 → 填标题/作者 → scaffoldProject 写入工作区。
 */

import { useState } from 'react';
import { listTemplates, scaffoldProject } from '@scholarforge/compile';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useUiStore } from '../state/uiStore';

export function TemplateWizard({ onDone }: { onDone: (message: string) => void }) {
  const templates = listTemplates();
  const loadProject = useWorkspaceStore((s) => s.loadProject);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const setTemplateWizardOpen = useUiStore((s) => s.setTemplateWizardOpen);

  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '');
  const [title, setTitle] = useState('未命名论文');
  const [authors, setAuthors] = useState('作者姓名');

  const selected = templates.find((t) => t.id === templateId);

  const create = () => {
    if (!selected) return;
    const fileMap = scaffoldProject(selected.id, {
      title: title.trim() || '未命名论文',
      authors: authors.trim() || '作者姓名',
      DATE: new Date().toISOString().slice(0, 10),
      VENUE: selected.venue,
      ABSTRACT: '（待填写摘要）',
    });
    const files: Record<string, string> = {};
    for (const [path, content] of Object.entries(fileMap)) {
      files[path] = typeof content === 'string' ? content : new TextDecoder().decode(content);
    }
    loadProject(title.trim() || selected.id, selected.entry, files);
    setSidebarTab('files');
    setTemplateWizardOpen(false);
    onDone(`已按模板「${selected.name}」创建项目`);
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={() => setTemplateWizardOpen(false)}>
      <div className="sf-dialog sf-wiz" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>新建项目（模板向导）</strong>
        </header>
        <div className="sf-dialog-body">
          <ul className="sf-wiz-list">
            {templates.map((t) => (
              <li
                key={t.id}
                className={`sf-wiz-item ${t.id === templateId ? 'active' : ''}`}
                onClick={() => setTemplateId(t.id)}
              >
                <strong>{t.name}</strong>
                <span>{t.description}</span>
              </li>
            ))}
          </ul>
          <label className="sf-form-field">
            标题
            <input className="sf-input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="sf-form-field">
            作者
            <input className="sf-input" value={authors} onChange={(e) => setAuthors(e.target.value)} />
          </label>
          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={() => setTemplateWizardOpen(false)}>
              取消
            </button>
            <button className="sf-btn sf-btn--primary" onClick={create} disabled={!selected}>
              创建项目
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
