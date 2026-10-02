/**
 * 提示词库对话框（v1.2.0 ③；LazyFeatureDialog 契约：export PromptLibraryDialog({ onClose })）：
 * 管理研究者沉淀的高频指令——新增（标题 + 正文）、就地编辑、删除；
 * 保存即进斜杠菜单（/ 标题 → 正文填入聊天输入框，可改后发送）。
 * 数据源 usePromptStore（localStorage 持久化）；zh/en 组件内字典；不新增 CSS。
 */

import { useEffect, useState } from 'react';
import { confirmDialog } from '../dialogs';
import { useSettingsStore } from '../state/settingsStore';
import {
  usePromptStore,
  PROMPT_TITLE_MAX,
  PROMPT_BODY_MAX,
  type UserPrompt,
} from '../state/promptStore';

const STRINGS = {
  zh: {
    title: '提示词库',
    desc: '保存你的高频指令：聊天输入 / 即可呼出，正文自动填入（可修改后发送）。',
    empty: '还没有保存的提示词',
    addTitle: '标题（如：检查时态一致性）',
    addBody: '指令正文（发送给 agent 的完整内容）',
    add: '新增',
    save: '保存',
    cancel: '取消',
    edit: '编辑',
    del: '删除',
    confirmDelete: (title: string) => `删除提示词「${title}」？`,
    close: '关闭',
    chars: (n: number) => `${n} 字`,
    titleRequired: '标题与正文不能为空',
  },
  en: {
    title: 'Prompt library',
    desc: 'Save your recurring instructions: type / in chat to invoke; the body fills the input for editing before sending.',
    empty: 'No saved prompts yet',
    addTitle: 'Title (e.g. Check tense consistency)',
    addBody: 'Prompt body (full content sent to the agent)',
    add: 'Add',
    save: 'Save',
    cancel: 'Cancel',
    edit: 'Edit',
    del: 'Delete',
    confirmDelete: (title: string) => `Delete prompt "${title}"?`,
    close: 'Close',
    chars: (n: number) => `${n} chars`,
    titleRequired: 'Title and body are required',
  },
} as const;

export function PromptLibraryDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];

  const prompts = usePromptStore((s) => s.prompts);
  const addPrompt = usePromptStore((s) => s.addPrompt);
  const updatePrompt = usePromptStore((s) => s.updatePrompt);
  const deletePrompt = usePromptStore((s) => s.deletePrompt);

  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAdd = (): void => {
    if (!newTitle.trim() || !newBody.trim()) {
      setError(L.titleRequired);
      return;
    }
    setError(null);
    addPrompt(newTitle, newBody);
    setNewTitle('');
    setNewBody('');
  };

  const beginEdit = (p: UserPrompt): void => {
    setEditingId(p.id);
    setEditTitle(p.title);
    setEditBody(p.body);
  };

  const handleSaveEdit = (): void => {
    if (!editingId) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError(L.titleRequired);
      return;
    }
    setError(null);
    updatePrompt(editingId, { title: editTitle, body: editBody });
    setEditingId(null);
  };

  const handleDelete = (p: UserPrompt): void => {
    // Tauri WKWebView 下 window.confirm 静默失效 → 走应用内 TextDialog（D2 规范）
    void confirmDialog(L.confirmDelete(p.title)).then((ok) => {
      if (!ok) return;
      deletePrompt(p.id);
      if (editingId === p.id) setEditingId(null);
    });
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--fg-2)' }}>{L.desc}</p>

          {/* —— 新增表单 —— */}
          <div className="sf-form" style={{ marginBottom: 12 }}>
            <label className="sf-form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{L.addTitle}</span>
              <input
                className="sf-input"
                value={newTitle}
                maxLength={PROMPT_TITLE_MAX}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </label>
            <label className="sf-form-field" style={{ gridColumn: '1 / -1' }}>
              <span>{L.addBody}</span>
              <textarea
                className="sf-input"
                rows={3}
                value={newBody}
                maxLength={PROMPT_BODY_MAX}
                onChange={(e) => setNewBody(e.target.value)}
              />
            </label>
          </div>
          {error && <p style={{ margin: '0 0 8px', fontSize: 12, color: 'var(--err)' }}>{error}</p>}
          <button className="sf-btn" onClick={handleAdd} disabled={!newTitle.trim() || !newBody.trim()}>
            {L.add}
          </button>

          {/* —— 列表（新的在前） —— */}
          {prompts.length === 0 ? (
            <p style={{ margin: '14px 0 0', fontSize: 12.5, color: 'var(--fg-2)' }}>{L.empty}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 8 }}>
              {prompts.map((p) => (
                <li
                  key={p.id}
                  style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px' }}
                >
                  {editingId === p.id ? (
                    <div className="sf-form" style={{ gap: 6 }}>
                      <input
                        className="sf-input"
                        value={editTitle}
                        maxLength={PROMPT_TITLE_MAX}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <textarea
                        className="sf-input"
                        rows={3}
                        value={editBody}
                        maxLength={PROMPT_BODY_MAX}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button className="sf-btn" onClick={handleSaveEdit}>
                          {L.save}
                        </button>
                        <button className="sf-btn dim" onClick={() => setEditingId(null)}>
                          {L.cancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong style={{ flex: 1, fontSize: 13 }}>{p.title}</strong>
                        <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{L.chars(p.body.length)}</span>
                        <button className="sf-link-btn" onClick={() => beginEdit(p)}>
                          {L.edit}
                        </button>
                        <button className="sf-link-btn" onClick={() => handleDelete(p)}>
                          {L.del}
                        </button>
                      </div>
                      <p
                        style={{
                          margin: '4px 0 0',
                          fontSize: 12,
                          color: 'var(--fg-2)',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          maxHeight: 60,
                          overflow: 'hidden',
                        }}
                      >
                        {p.body}
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <footer className="sf-lib-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="sf-btn dim" onClick={onClose}>
            {L.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
