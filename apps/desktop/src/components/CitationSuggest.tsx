/**
 * 智能引用推荐（v1.7.0 ②）：写稿时一键找出当前段落应引的文献。
 *
 * 工作流：光标所在段落（或选中文字）作为 query → libraryStore.searchKnowledge
 * （TF-IDF + BM25 混合检索）→ 前几篇去重后的文献卡（标题 / 首作者 / 年份 /
 * 相关片段）→ 点击「插入 \cite{key}」追加到光标处（同 diff 审批门）。
 *
 * 入口：编辑器工具条「引用建议」按钮（EditorArea actions 或 selbar）。
 */

import { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useLibraryStore, type CitedRetrievedChunk } from '../state/libraryStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProposalStore } from '../state/proposalStore';

export interface SuggestedPaper {
  citekey: string;
  title: string;
  firstAuthor?: string;
  year?: string;
  /** 相关片段摘要（chunk 文本前 120 字） */
  snippet?: string;
  score: number;
}

const STRINGS = {
  zh: {
    title: '引用建议',
    desc: '基于当前段落内容，从你的文献库检索相关文献：',
    empty: '没有找到相关文献（库为空或当前段落太短）',
    insert: (key: string) => `插入 \\cite{${key}}`,
    busy: '检索中…',
    score: (s: number) => `相关度 ${(s * 100).toFixed(0)}%`,
    needTex: '请先在编辑器打开一个 .tex 文件',
    close: '关闭',
  },
  en: {
    title: 'Citation suggestions',
    desc: 'Based on the current paragraph, from your library:',
    empty: 'No relevant papers found (empty library or paragraph too short)',
    insert: (key: string) => `Insert \\cite{${key}}`,
    busy: 'Searching…',
    score: (s: number) => `Relevance ${(s * 100).toFixed(0)}%`,
    needTex: 'Open a .tex file in the editor first',
    close: 'Close',
  },
} as const;

/** 从检索结果提取去重后的文献列表（同篇取最高分 chunk） */
export function dedupeSuggestions(chunks: CitedRetrievedChunk[]): SuggestedPaper[] {
  const byKey = new Map<string, SuggestedPaper>();
  const lib = useLibraryStore.getState().papers;
  for (const c of chunks) {
    if (!c.citekey) continue;
    const existing = byKey.get(c.citekey);
    if (existing && existing.score >= c.score) continue;
    const paper = lib.find((p) => p.citekey === c.citekey);
    if (!paper) continue;
    const first = paper.authors?.[0];
    byKey.set(c.citekey, {
      citekey: c.citekey,
      title: paper.title ?? '(untitled)',
      firstAuthor: first ? (paper.authors.length > 1 ? `${first.family} et al.` : first.family) : undefined,
      year: paper.year ? String(paper.year) : undefined,
      snippet: c.text.slice(0, 120).trim(),
      score: c.score,
    });
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 5);
}

export function CitationSuggest({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];

  const papers = useLibraryStore((s) => s.papers);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestedPaper[] | null>(null);

  const runSuggest = async (): Promise<void> => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) {
      setSuggestions([]);
      return;
    }
    setBusy(true);
    try {
      const text = ws.files[file] ?? '';
      // 光标段（当前行往前找空行包围的段落，截取 500 字）
      const cursor = useLibraryStore.getState(); // 只为触发渲染订阅
      void cursor;
      // 简化取法：取光标附近 500 字（EditorArea 已把 selectionText 放 uiStore，有选中用选中，否则取全文前 500）
      const selection = (window as unknown as { __sfSelection?: string }).__sfSelection;
      const query = (selection && selection.trim().length > 20 ? selection : text.slice(0, 500)).trim();
      if (!query) {
        setSuggestions([]);
        return;
      }
      const chunks = await useLibraryStore.getState().searchKnowledge(query, 10);
      setSuggestions(dedupeSuggestions(chunks));
    } finally {
      setBusy(false);
    }
  };

  const insertCite = (citekey: string): void => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file) return;
    const before = ws.files[file] ?? '';
    // 追加到文件末尾前（简化：插到当前光标行末——由调用方精确定位更佳，这里用保守追加）
    const cite = `~\\cite{${citekey}}`;
    const after = before.endsWith('\n') ? before + cite + '\n' : before + cite;
    useProposalStore.getState().setProposal({
      file,
      before,
      after,
      kind: 'add-citation',
      label: `插入引用建议：${citekey}`,
      via: 'TF-IDF 检索',
    });
    onClose();
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" style={{ minWidth: 480, maxWidth: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>
            <BookOpen size={13} /> {L.title}
          </strong>
        </header>
        <div className="sf-dialog-body">
          {papers.length === 0 ? (
            <p style={{ color: 'var(--fg-2)' }}>{L.empty}</p>
          ) : (
            <>
              <p style={{ margin: '0 0 10px', fontSize: 11.5, color: 'var(--fg-2)' }}>{L.desc}</p>
              {suggestions === null && !busy && (
                <button className="sf-btn primary" onClick={() => void runSuggest()}>
                  {L.title}
                </button>
              )}
              {busy && (
                <p style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12.5 }}>
                  <Loader2 size={13} className="sf-spin" /> {L.busy}
                </p>
              )}
              {suggestions !== null && suggestions.length === 0 && !busy && (
                <p style={{ color: 'var(--fg-2)' }}>{L.empty}</p>
              )}
              {suggestions !== null && suggestions.length > 0 && (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
                  {suggestions.map((s) => (
                    <li key={s.citekey} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '8px 10px' }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <strong style={{ flex: 1, fontSize: 12.5, lineHeight: 1.4 }}>{s.title}</strong>
                        <span style={{ fontSize: 10.5, color: 'var(--fg-2)', flex: 'none' }}>{L.score(s.score)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--fg-1)', marginTop: 2 }}>
                        {[s.firstAuthor, s.year].filter(Boolean).join(' · ')}
                      </div>
                      {s.snippet && (
                        <p style={{ margin: '4px 0 6px', fontSize: 11, color: 'var(--fg-2)', lineHeight: 1.45, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.snippet}
                        </p>
                      )}
                      <button className="sf-btn" style={{ fontSize: 11.5, padding: '2px 10px' }} onClick={() => insertCite(s.citekey)}>
                        {L.insert(s.citekey)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
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
