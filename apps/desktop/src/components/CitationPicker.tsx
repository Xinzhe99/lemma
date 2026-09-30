/**
 * 引用插入向导（insert.citation 命令 / EditorArea「引用」按钮触发，App 懒加载挂载）：
 *  - 顶部搜索框实时过滤文献库（citekey / 标题 / 作者 / 年份子串，大小写不敏感）；
 *  - 「智能推荐」：当前标签为 .tex 时，以内容尾部为 query 走 citationSuggest +
 *    libraryStore.searchKnowledge 混合检索，结果以「推荐」徽章显示在列表顶部区域，
 *    点击行即选中；loading 态 + 失败 inline 提示；
 *  - 结果列表多选（点击行切换选中态），已选 chips 区可移除；
 *  - 「插入 N 条引用」：insertAtCursor('\cite{a,b}')，成功才 onClose，
 *    失败 role=alert 提示并保持打开；空选择禁用按钮。
 * 模态结构复用 sf-dialog / sf-quickopen 系列既有结构类（不新增 CSS），
 * 交互测试挂钩使用 sf-citepicker-* 语义类名；UI 字符串使用组件内 zh/en 本地字典。
 */

import { useEffect, useMemo, useState } from 'react';
import { collectCitekeys } from '@scholarforge/editor';
import type { Paper } from '@scholarforge/shared';
import { useLibraryStore } from '../state/libraryStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore } from '../state/settingsStore';
import { insertAtCursor } from '../editorInsert';
import {
  suggestCitations,
  type CitationSuggestion,
  type RetrieveFn,
} from '../citationSuggest';

const STRINGS = {
  zh: {
    title: '插入引用',
    placeholder: '过滤文献库（citekey / 标题 / 作者 / 年份）',
    suggest: '智能推荐',
    suggesting: '推荐中…',
    suggestTitle: '根据当前 .tex 内容语义检索文献库',
    suggestHead: '智能推荐结果',
    suggestEmpty: '文献库中没有可推荐的条目',
    suggestFailed: '智能推荐失败，请重试',
    suggestNeedTex: '智能推荐需要当前标签页为 .tex 文件',
    badge: '推荐',
    libraryHead: '文献库',
    empty: '无匹配文献',
    selectedTitle: '已选择（点击 × 移除）',
    remove: '移除',
    cancel: '取消',
    insert: (n: number) => `插入 ${n} 条引用`,
    insertTitle: '以 \\cite{…} 插入到当前编辑器光标处',
    noEditor: '未找到可用的编辑器：请先打开一个 .tex 文件再插入',
  },
  en: {
    title: 'Insert citation',
    placeholder: 'Filter library (citekey / title / authors / year)',
    suggest: 'Smart suggest',
    suggesting: 'Suggesting…',
    suggestTitle: 'Semantic search over the library using the current .tex content',
    suggestHead: 'Smart suggestions',
    suggestEmpty: 'No suggestions available from the library',
    suggestFailed: 'Smart suggestion failed — please retry',
    suggestNeedTex: 'Smart suggestions require an open .tex tab',
    badge: 'suggested',
    libraryHead: 'Library',
    empty: 'No matching papers',
    selectedTitle: 'Selected (click × to remove)',
    remove: 'Remove',
    cancel: 'Cancel',
    insert: (n: number) => `Insert ${n} citation${n === 1 ? '' : 's'}`,
    insertTitle: "Insert as \\cite{…} at the editor cursor",
    noEditor: 'No active editor found: open a .tex file before inserting',
  },
} as const;

/** 过滤：citekey / 标题 / 作者（family+given）/ 年份子串，大小写不敏感 */
export function paperMatches(p: Paper, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    p.citekey,
    p.title,
    ...p.authors.map((a) => `${a.given ?? ''} ${a.family}`.trim()),
    p.year !== undefined ? String(p.year) : '',
  ]
    .join('\n')
    .toLowerCase();
  return hay.includes(q);
}

/** 年份 · venue 展示串 */
function yearVenue(p: Paper): string {
  const year = p.year !== undefined ? String(p.year) : '';
  const venue = p.venue?.name ?? '';
  return [year, venue].filter(Boolean).join(' · ') || '—';
}

export function CitationPicker({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];
  const papers = useLibraryStore((s) => s.papers);
  const searchKnowledge = useLibraryStore((s) => s.searchKnowledge);
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]); // 保持点击顺序
  const [suggestions, setSuggestions] = useState<CitationSuggestion[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');
  const [insertError, setInsertError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => papers.filter((p) => paperMatches(p, query)), [papers, query]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (citekey: string) => {
    setInsertError('');
    setSelected((prev) =>
      prev.includes(citekey) ? prev.filter((k) => k !== citekey) : [...prev, citekey],
    );
  };

  /** 智能推荐：当前标签为 .tex 时，以内容尾部为 query 检索知识索引 */
  const runSuggest = async () => {
    if (suggesting) return;
    if (!activeTab || !activeTab.toLowerCase().endsWith('.tex')) {
      setSuggestError(L.suggestNeedTex);
      return;
    }
    const content = files[activeTab] ?? '';
    setSuggesting(true);
    setSuggestError('');
    try {
      const retrieve: RetrieveFn = (q, k) => searchKnowledge(q, k);
      const results = await suggestCitations(content, papers, collectCitekeys(content), retrieve);
      setSuggestions(results);
    } catch {
      setSuggestError(L.suggestFailed);
    } finally {
      setSuggesting(false);
    }
  };

  const insert = () => {
    if (selected.length === 0) return;
    if (insertAtCursor(`\\cite{${selected.join(',')}}`)) {
      onClose();
      return;
    }
    setInsertError(L.noEditor); // 插入失败：保持打开并提示
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog sf-citepicker"
        role="dialog"
        aria-label={L.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <div
            className="sf-citepicker-toolbar"
            style={{ display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <input
              className="sf-quickopen-input sf-citepicker-input"
              style={{ flex: 1, borderBottom: 'none', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              placeholder={L.placeholder}
              value={query}
              spellCheck={false}
              aria-label={L.title}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              type="button"
              className="sf-btn sf-citepicker-suggest-btn"
              title={L.suggestTitle}
              disabled={suggesting}
              onClick={() => void runSuggest()}
            >
              {suggesting ? L.suggesting : L.suggest}
            </button>
          </div>

          {suggestError && (
            <p className="sf-citepicker-suggest-error" role="alert" style={{ margin: '6px 2px 0', fontSize: 12, color: 'var(--err, #ff7a85)' }}>
              {suggestError}
            </p>
          )}

          <ul className="sf-quickopen-list sf-citepicker-list" role="listbox" aria-label={L.title} style={{ maxHeight: 260 }}>
            {suggestions !== null && (
              <>
                <li className="sf-quickopen-meta sf-citepicker-suggest-head">{L.suggestHead}</li>
                {suggestions.length === 0 ? (
                  <li className="sf-quickopen-meta sf-citepicker-suggest-empty">{L.suggestEmpty}</li>
                ) : (
                  suggestions.map((s) => {
                    const isSel = selectedSet.has(s.citekey);
                    return (
                      <li
                        key={s.citekey}
                        role="option"
                        aria-selected={isSel}
                        className={`sf-quickopen-item sf-citepicker-row sf-citepicker-suggest-row ${isSel ? 'selected' : ''}`}
                        style={isSel ? { background: 'var(--bg-3)' } : undefined}
                        title={s.reason}
                        onClick={() => toggle(s.citekey)}
                      >
                        <em className="sf-chip ok sf-citepicker-badge">{L.badge}</em>
                        <span style={{ flex: 1, minWidth: 0, display: 'flex', gap: 8, alignItems: 'baseline' }}>
                          <code className="sf-citepicker-key" style={{ fontSize: 12 }}>{s.citekey}</code>
                          <span className="sf-citepicker-title" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {s.title}
                          </span>
                        </span>
                        {isSel && <em className="sf-chip ok">✓</em>}
                      </li>
                    );
                  })
                )}
              </>
            )}

            <li className="sf-quickopen-meta sf-citepicker-lib-head">{L.libraryHead}</li>
            {filtered.map((p) => {
              const isSel = selectedSet.has(p.citekey);
              return (
                <li
                  key={p.id}
                  role="option"
                  aria-selected={isSel}
                  className={`sf-quickopen-item sf-citepicker-row ${isSel ? 'selected' : ''}`}
                  style={isSel ? { background: 'var(--bg-3)' } : undefined}
                  onClick={() => toggle(p.citekey)}
                >
                  <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ display: 'flex', gap: 8, alignItems: 'baseline', minWidth: 0 }}>
                      <code className="sf-citepicker-key" style={{ fontSize: 12, flex: 'none' }}>{p.citekey}</code>
                      <span className="sf-citepicker-title" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {p.title}
                      </span>
                    </span>
                  </span>
                  <span className="sf-quickopen-meta sf-citepicker-meta" style={{ flex: 'none' }}>{yearVenue(p)}</span>
                  {isSel && <em className="sf-chip ok">✓</em>}
                </li>
              );
            })}
            {filtered.length === 0 && <li className="sf-quickopen-empty sf-citepicker-empty">{L.empty}</li>}
          </ul>

          {insertError && (
            <p className="sf-citepicker-hint" role="alert" style={{ margin: '6px 2px', fontSize: 12, color: 'var(--err)' }}>
              {insertError}
            </p>
          )}

          <div className="sf-citepicker-chips" style={{ marginTop: 8 }}>
            <div className="sf-quickopen-meta" style={{ marginBottom: selected.length > 0 ? 4 : 0 }}>{L.selectedTitle}</div>
            {selected.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {selected.map((k) => (
                  <span key={k} className="sf-chip sf-citepicker-chip" style={{ fontSize: 11, padding: '3px 8px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <code>{k}</code>
                    <button
                      type="button"
                      className="sf-citepicker-chip-remove"
                      aria-label={`${L.remove} ${k}`}
                      title={L.remove}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', padding: '0 2px', color: 'inherit', fontWeight: 700 }}
                      onClick={() => toggle(k)}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="sf-lib-dialog-actions sf-citepicker-actions">
            <button className="sf-btn" onClick={onClose}>
              {L.cancel}
            </button>
            <button
              type="button"
              className="sf-btn sf-btn--primary sf-citepicker-insert"
              title={L.insertTitle}
              disabled={selected.length === 0}
              onClick={insert}
            >
              {L.insert(selected.length)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
