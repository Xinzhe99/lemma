/**
 * 引用面板：「问题」区（LaTeX lint）+ 正文 \cite 与 refs.bib、文献库三方对账（4.4 引用完整性）。
 * 问题区支持「当前文件 / 全项目（合并去重）」两种范围，点击行跳转到对应 .tex 行。
 */

import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { bibCitekeys, citedKeys } from '../projectDoc';
import { collectLabels, lintLatex, type LintIssue } from '@lemma/editor';
import { jumpTo } from '../editorJump';

// ---------------------------------------------------------------------------
// 问题区双语文案（组件内本地字典，不进全局 i18n）
// ---------------------------------------------------------------------------

interface IssuesDict {
  title: string;
  scopeActive: string;
  scopeAll: string;
  empty: string;
  noActiveTex: string;
  jumpHint: string;
}

const ISSUES_DICT: Record<Language, IssuesDict> = {
  zh: {
    title: '问题',
    scopeActive: '当前文件',
    scopeAll: '全项目',
    empty: '未发现问题',
    noActiveTex: '当前没有激活的 .tex 文件',
    jumpHint: '点击跳转到对应行',
  },
  en: {
    title: 'Issues',
    scopeActive: 'Current file',
    scopeAll: 'Whole project',
    empty: 'No issues found',
    noActiveTex: 'No active .tex file',
    jumpHint: 'Click to jump to the line',
  },
};

interface IssueRow {
  file: string;
  issue: LintIssue;
}

export function CitationsPanel() {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const it = ISSUES_DICT[language];

  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const papers = useLibraryStore((s) => s.papers);
  const importBibtex = useLibraryStore((s) => s.importBibtex);
  const [issueScope, setIssueScope] = useState<'active' | 'all'>('active');
  const [message, setMessage] = useState<string | null>(null);

  const texFiles = useMemo(
    () => Object.keys(files).filter((f) => f.endsWith('.tex')),
    [files],
  );

  /** 全项目 label 集合 + citekey 集合（.bib + 文献库），供跨文件校验 */
  const lintSets = useMemo(() => {
    const labels = new Set<string>();
    for (const path of texFiles) {
      for (const label of collectLabels(files[path] ?? '')) labels.add(label.name);
    }
    const citekeys = bibCitekeys(files);
    for (const paper of papers) citekeys.add(paper.citekey);
    return { labels, citekeys };
  }, [files, papers, texFiles]);

  /** 逐个 .tex 文件 lint，附上所在文件路径 */
  const fileIssues = useMemo(() => {
    const rows: IssueRow[] = [];
    for (const path of texFiles) {
      for (const issue of lintLatex(files[path] ?? '', lintSets)) {
        rows.push({ file: path, issue });
      }
    }
    return rows;
  }, [files, texFiles, lintSets]);

  /** 当前范围的问题行（active 过滤当前 .tex；all 合并去重后按文件+行号排序） */
  const issueRows = useMemo(() => {
    if (issueScope === 'active') {
      if (!activeTab || !activeTab.endsWith('.tex')) return [];
      return fileIssues.filter((row) => row.file === activeTab);
    }
    const seen = new Set<string>();
    const rows: IssueRow[] = [];
    for (const row of fileIssues) {
      const key = `${row.file}\u0000${row.issue.line}\u0000${row.issue.severity}\u0000${row.issue.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
    return rows.sort((a, b) => a.file.localeCompare(b.file) || a.issue.line - b.issue.line);
  }, [fileIssues, issueScope, activeTab]);

  const cited = useMemo(() => citedKeys(files), [files]);
  const bibSet = useMemo(() => bibCitekeys(files), [files]);
  const libSet = useMemo(() => new Set(papers.map((p) => p.citekey)), [papers]);

  const missingInBib = cited.filter((k) => !bibSet.has(k));
  const missingInLib = cited.filter((k) => bibSet.has(k) && !libSet.has(k));
  const bibPath = Object.keys(files).find((p) => p.endsWith('.bib'));

  const importFromBib = () => {
    if (!bibPath) return;
    const result = importBibtex(files[bibPath] ?? '');
    setMessage(
      t('cites.imported', {
        path: bibPath,
        n: result.added,
        errors: result.errors.length ? t('cites.importErrors', { n: result.errors.length }) : '',
      }),
    );
  };

  const emptyHint =
    issueScope === 'active' && (!activeTab || !activeTab.endsWith('.tex'))
      ? it.noActiveTex
      : it.empty;

  return (
    <div className="sf-cites">
      {/* 问题区（LaTeX lint）：当前激活 .tex / 全项目 双范围 */}
      <section className="sf-issues">
        <div className="sf-issues-head">
          <span className="sf-issues-title">
            {it.title}
            <span className="sf-issues-count">{issueRows.length}</span>
          </span>
          <div className="sf-issues-scope" role="group" aria-label={it.title}>
            <button
              type="button"
              className={`sf-issues-scope-btn${issueScope === 'active' ? ' active' : ''}`}
              onClick={() => setIssueScope('active')}
            >
              {it.scopeActive}
            </button>
            <button
              type="button"
              className={`sf-issues-scope-btn${issueScope === 'all' ? ' active' : ''}`}
              onClick={() => setIssueScope('all')}
            >
              {it.scopeAll}
            </button>
          </div>
        </div>
        {issueRows.length === 0 ? (
          <p className="sf-issues-empty">{emptyHint}</p>
        ) : (
          <ul className="sf-issues-list">
            {issueRows.map(({ file, issue }) => (
              <li key={`${file}:${issue.line}:${issue.message}`}>
                <button
                  type="button"
                  className={`sf-issues-row sf-issues-row--${issue.severity}`}
                  title={it.jumpHint}
                  onClick={() => jumpTo({ file, line: issue.line })}
                >
                  <span className="sf-issues-sev" aria-hidden />
                  <code className="sf-issues-loc">
                    {file}:{issue.line}
                  </code>
                  <span className="sf-issues-msg">{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="sf-cites-summary">
        <span>{t('cites.bodyCited', { n: cited.length })}</span>
        <span className={missingInBib.length ? 'sf-chip err' : 'sf-chip ok'}>
          {t('cites.missingBib', { n: missingInBib.length })}
        </span>
        <span className={missingInLib.length ? 'sf-chip warn' : 'sf-chip ok'}>
          {t('cites.missingLib', { n: missingInLib.length })}
        </span>
      </div>

      {missingInLib.length > 0 && bibPath && (
        <button className="sf-btn sf-cites-import" onClick={importFromBib}>
          {t('cites.importFrom', { path: bibPath })}
        </button>
      )}
      {message && <p className="sf-cites-msg">{message}</p>}

      {cited.length === 0 ? (
        <p className="placeholder">{t('cites.empty')}</p>
      ) : (
        <ul className="sf-cites-list">
          {cited.map((key) => (
            <li key={key} className="sf-cites-row">
              <code className="sf-cites-key">{key}</code>
              <span className="sf-cites-chips">
                <span className={bibSet.has(key) ? 'sf-chip ok' : 'sf-chip err'}>
                  {bibSet.has(key) ? t('cites.inBib') : t('cites.notInBib')}
                </span>
                <span className={libSet.has(key) ? 'sf-chip ok' : 'sf-chip dim'}>
                  {libSet.has(key) ? t('cites.inLib') : t('cites.notInLib')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
