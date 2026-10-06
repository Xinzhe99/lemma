/**
 * 全项目搜索浮层（Ctrl+Shift+F，WS-3 检索与联动）：
 *  - 顶部输入 + 大小写/整词两个 toggle + 按文件分组的结果列表（「文件名 · 命中数」小标题，
 *    每条「行号：行文本」，命中词 <mark> 高亮）；
 *  - 输入 200ms 防抖实时搜索（searchProject 纯函数）；toggle 立即生效；
 *  - 点击命中 jumpTo({file, line}) 且面板保持打开（可连续跳转）；Enter 跳第一条；
 *    Esc / 遮罩点击关闭；结果区滚动；输入框自动聚焦。
 * 结构复用 sf-dialog / sf-quickopen 系列既有结构类（不新增 CSS），
 * 交互测试挂钩使用 sf-searchpanel-* 语义类名。
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { searchProject, replaceInProject, type SearchHit } from '../searchProject';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore } from '../state/settingsStore';
import { jumpTo } from '../editorJump';

const DEBOUNCE_MS = 200;

const STRINGS = {
  zh: {
    title: '全项目搜索',
    placeholder: '搜索所有项目文件…',
    hint: '输入关键词，在全项目文件中实时搜索（200ms 防抖）',
    empty: '无匹配结果',
    summary: (n: number, files: number) => `共 ${n} 条命中 · ${files} 个文件`,
    truncated: '结果较多，仅显示前 500 条',
    caseSensitive: '区分大小写',
    wholeWord: '全字匹配',
    replaceToggle: '替换',
    replacePlaceholder: '替换为…',
    replaceAll: '全部替换',
    replacePreview: (n: number, files: number) => `将替换 ${n} 处 · ${files} 个文件`,
    replaceEmpty: '无替换结果',
    replaceDone: (n: number, files: number) => `✓ 已替换 ${n} 处（${files} 个文件）`,
    replaceNoQuery: '请输入搜索词',
    replaceConfirm: '确认替换？',
    replaceConfirmDesc: (n: number, files: number) => `将在 ${files} 个文件中替换 ${n} 处。此操作可通过版本面板恢复。`,
  },
  en: {
    title: 'Search in project',
    placeholder: 'Search all project files…',
    hint: 'Type to search across project files (200ms debounce)',
    empty: 'No matching results',
    summary: (n: number, files: number) => `${n} hit(s) in ${files} file(s)`,
    truncated: 'Too many hits — showing first 500',
    caseSensitive: 'Match case',
    wholeWord: 'Whole word',
    replaceToggle: 'Replace',
    replacePlaceholder: 'Replace with…',
    replaceAll: 'Replace all',
    replacePreview: (n: number, files: number) => `${n} replacement(s) in ${files} file(s)`,
    replaceEmpty: 'No replacements',
    replaceDone: (n: number, files: number) => `✓ Replaced ${n} occurrence(s) in ${files} file(s)`,
    replaceNoQuery: 'Enter a search term',
    replaceConfirm: 'Confirm replace?',
    replaceConfirmDesc: (n: number, files: number) => `${n} replacement(s) in ${files} file(s). Can be undone via version panel.`,
  },
} as const;

/** 行文本 + <mark> 高亮（matchStart/End 相对 text，由 searchProject 保证自洽） */
function HitText({ hit }: { hit: SearchHit }) {
  const { text, matchStart, matchEnd } = hit;
  if (matchStart < 0 || matchEnd > text.length || matchStart >= matchEnd) return <>{text}</>;
  return (
    <>
      {text.slice(0, matchStart)}
      <mark className="sf-searchpanel-mark">{text.slice(matchStart, matchEnd)}</mark>
      {text.slice(matchEnd)}
    </>
  );
}

export function SearchPanel({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const files = useWorkspaceStore((s) => s.files);
  const L = STRINGS[language];

  const [inputValue, setInputValue] = useState('');
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  // v7.2.0 F1：替换模式
  const [replaceMode, setReplaceMode] = useState(false);
  const [replacement, setReplacement] = useState('');
  const [replaceNote, setReplaceNote] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);
  // v7.2.0 F1：Ctrl+Shift+H 进入时自动开替换模式
  const initialReplace = typeof window !== 'undefined' && window.location.hash === '#replace';
  useEffect(() => {
    inputRef.current?.focus();
    if (initialReplace) {
      setReplaceMode(true);
      window.location.hash = '';
    }
  }, []);

  // 输入防抖 200ms → 实际参与搜索的 query
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(inputValue), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [inputValue]);

  const result = useMemo(
    () => searchProject(files, query, { caseSensitive, wholeWord }),
    [files, query, caseSensitive, wholeWord],
  );

  // 替换预览（实时计算，不修改 store）
  const replacePreview = useMemo(
    () => (replaceMode && query ? replaceInProject(files, query, replacement, { caseSensitive, wholeWord }) : null),
    [replaceMode, files, query, replacement, caseSensitive, wholeWord],
  );

  const doReplaceAll = () => {
    if (!replacePreview || replacePreview.replacementCount === 0) return;
    setReplaceNote(L.replaceDone(replacePreview.replacementCount, replacePreview.changedFiles.length));
    const ws = useWorkspaceStore.getState();
    for (const file of replacePreview.changedFiles) {
      const after = replacePreview.newFiles[file];
      if (after !== undefined) ws.updateFile(file, after);
    }
  };

  // 按文件分组（保持命中顺序）
  const groups = useMemo(() => {
    const list: Array<{ file: string; hits: SearchHit[] }> = [];
    const byFile = new Map<string, { file: string; hits: SearchHit[] }>();
    for (const hit of result.hits) {
      let g = byFile.get(hit.file);
      if (!g) {
        g = { file: hit.file, hits: [] };
        byFile.set(hit.file, g);
        list.push(g);
      }
      g.hits.push(hit);
    }
    return list;
  }, [result]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const first = result.hits[0];
        if (first) jumpTo({ file: first.file, line: first.line }); // 面板保持打开
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [result, onClose]);

  const open = (hit: SearchHit) => jumpTo({ file: hit.file, line: hit.line });

  return (
    <div className="sf-quickopen-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog sf-quickopen sf-searchpanel"
        role="dialog"
        aria-label={L.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div
          className="sf-searchpanel-toolbar"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}
        >
          <input
            ref={inputRef}
            className="sf-quickopen-input sf-searchpanel-input"
            style={{ flex: 1, borderBottom: 'none', padding: '6px 2px' }}
            placeholder={L.placeholder}
            value={inputValue}
            spellCheck={false}
            aria-label={L.title}
            onChange={(e) => setInputValue(e.target.value)}
          />
          <button
            type="button"
            className={`sf-btn sf-searchpanel-toggle sf-searchpanel-toggle-case${caseSensitive ? ' active' : ''}`}
            aria-pressed={caseSensitive}
            title={L.caseSensitive}
            onClick={() => setCaseSensitive((v) => !v)}
          >
            Aa
          </button>
          <button
            type="button"
            className={`sf-btn sf-searchpanel-toggle sf-searchpanel-toggle-word${wholeWord ? ' active' : ''}`}
            aria-pressed={wholeWord}
            title={L.wholeWord}
            onClick={() => setWholeWord((v) => !v)}
          >
            {language === 'zh' ? '整词' : 'Word'}
          </button>
          <button
            type="button"
            className={`sf-btn sf-searchpanel-toggle${replaceMode ? ' active' : ''}`}
            aria-pressed={replaceMode}
            title={L.replaceToggle}
            onClick={() => { setReplaceMode((v) => !v); setReplaceNote(''); }}
          >
            {L.replaceToggle}
          </button>
        </div>

        {/* v7.2.0 F1：替换输入行 + 全部替换按钮 */}
        {replaceMode ? (
          <div
            className="sf-searchpanel-toolbar sf-searchpanel-replace-bar"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--border)' }}
          >
            <input
              className="sf-quickopen-input sf-searchpanel-replace-input"
              style={{ flex: 1, borderBottom: 'none', padding: '6px 2px' }}
              placeholder={L.replacePlaceholder}
              value={replacement}
              spellCheck={false}
              aria-label={L.replacePlaceholder}
              onChange={(e) => { setReplacement(e.target.value); setReplaceNote(''); }}
            />
            <button
              type="button"
              className="sf-btn sf-searchpanel-replace-all"
              disabled={!replacePreview || replacePreview.replacementCount === 0}
              onClick={doReplaceAll}
            >
              {L.replaceAll}
            </button>
          </div>
        ) : null}
        {replaceNote ? (
          <div className="sf-searchpanel-replace-note" style={{ padding: '4px 10px', fontSize: 11, color: 'var(--accent, #10a37f)' }}>
            {replaceNote}
          </div>
        ) : null}

        <ul className="sf-quickopen-list sf-searchpanel-results">
          {query !== '' && (
            <li className="sf-quickopen-meta sf-searchpanel-summary">
              {L.summary(result.hits.length, groups.length)}
              {result.truncated ? ` · ${L.truncated}` : ''}
            </li>
          )}
          {/* v7.2.0 F1：替换预览摘要 */}
          {replaceMode && replacePreview && replacePreview.replacementCount > 0 ? (
            <li className="sf-quickopen-meta sf-searchpanel-replace-summary" style={{ color: 'var(--accent, #10a37f)' }}>
              {L.replacePreview(replacePreview.replacementCount, replacePreview.changedFiles.length)}
            </li>
          ) : null}
          {groups.map((g) => (
            <Fragment key={g.file}>
              <li className="sf-quickopen-meta sf-searchpanel-file">
                {g.file} · {g.hits.length}
              </li>
              {g.hits.map((hit) => (
                <li
                  key={`${hit.file}:${hit.line}:${hit.matchStart}`}
                  className="sf-quickopen-item sf-searchpanel-hit"
                  title={`${hit.file}:${hit.line}`}
                  onClick={() => open(hit)}
                >
                  <span className="sf-quickopen-meta sf-searchpanel-line">{hit.line}</span>
                  <span className="sf-quickopen-path sf-searchpanel-text">
                    <HitText hit={hit} />
                  </span>
                </li>
              ))}
            </Fragment>
          ))}
          {query !== '' && result.hits.length === 0 && (
            <li className="sf-quickopen-empty sf-searchpanel-empty">{L.empty}</li>
          )}
          {query === '' && <li className="sf-quickopen-empty sf-searchpanel-hint">{L.hint}</li>}
        </ul>
      </div>
    </div>
  );
}
