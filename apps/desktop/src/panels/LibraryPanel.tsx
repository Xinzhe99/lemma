/**
 * 文献库面板：条目列表（智能过滤器查询语言）/ 全文知识检索 / 文献发现（arXiv+Crossref 聚合检索，一键入库）/ 导入。
 */

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  applyFilter,
  mergeSearchHits,
  searchArxiv,
  searchCrossref,
  type PaperSearchHit,
} from '@scholarforge/library';
import type { ReadStatus } from '@scholarforge/shared';
import { useLibraryStore, type CitedRetrievedChunk } from '../state/libraryStore';
import { useUiStore, type LibraryMode } from '../state/uiStore';

const STATUS_LABEL: Record<ReadStatus, string> = {
  'to-read': '待读',
  reading: '在读',
  done: '已读',
};

const MODE_LABEL: Record<LibraryMode, string> = {
  list: '条目',
  search: '知识检索',
  discover: '发现',
};

const INDEX_MODE_LABEL: Record<'hash' | 'api' | 'api-fallback', string> = {
  hash: '就绪（本地哈希）',
  api: '就绪（语义嵌入）',
  'api-fallback': '已回退本地哈希',
};

export function LibraryPanel() {
  const papers = useLibraryStore((s) => s.papers);
  const indexReady = useLibraryStore((s) => s.indexReady);
  const indexMode = useLibraryStore((s) => s.indexMode);
  const importBibtex = useLibraryStore((s) => s.importBibtex);
  const importHit = useLibraryStore((s) => s.importHit);
  const fetchMetadata = useLibraryStore((s) => s.fetchMetadata);
  const removePaper = useLibraryStore((s) => s.removePaper);
  const setReadStatus = useLibraryStore((s) => s.setReadStatus);
  const searchKnowledge = useLibraryStore((s) => s.searchKnowledge);

  const mode = useUiStore((s) => s.libraryMode);
  const setMode = useUiStore((s) => s.setLibraryMode);
  const dialog = useUiStore((s) => s.libraryDialog);
  const setDialog = useUiStore((s) => s.setLibraryDialog);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CitedRetrievedChunk[] | null>(null);
  const [searching, setSearching] = useState(false);

  const [discoverQuery, setDiscoverQuery] = useState('');
  const [hits, setHits] = useState<PaperSearchHit[] | null>(null);
  const [discoverState, setDiscoverState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');
  const [discoverMsg, setDiscoverMsg] = useState<string | null>(null);
  const [importedKeys, setImportedKeys] = useState<string[]>([]);

  const [bibtexText, setBibtexText] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [fetchKind, setFetchKind] = useState<'doi' | 'arxiv'>('doi');
  const [fetchId, setFetchId] = useState('');
  const [fetchMsg, setFetchMsg] = useState<string | null>(null);

  const filtered =
    mode === 'list' && query.trim() ? applyFilter(papers, query) : papers;

  const runSearch = async () => {
    setSearching(true);
    try {
      setResults(await searchKnowledge(query, 8));
    } finally {
      setSearching(false);
    }
  };

  const runDiscover = async () => {
    const q = discoverQuery.trim();
    if (!q) return;
    setDiscoverState('searching');
    setDiscoverMsg(null);
    try {
      const [arxiv, crossref] = await Promise.allSettled([
        searchArxiv(q, { fetch: (url, init) => fetch(url, init) }, 8),
        searchCrossref(q, { fetch: (url, init) => fetch(url, init) }, 8),
      ]);
      const merged = mergeSearchHits([
        ...(arxiv.status === 'fulfilled' ? arxiv.value : []),
        ...(crossref.status === 'fulfilled' ? crossref.value : []),
      ]);
      setHits(merged);
      setDiscoverState('done');
      if (merged.length === 0) {
        const bothFailed = arxiv.status === 'rejected' && crossref.status === 'rejected';
        setDiscoverMsg(
          bothFailed
            ? '两个数据源都失败了（浏览器直连可能受跨域限制，桌面形态无此问题）'
            : '无检索结果，试试更短的关键词',
        );
      }
    } catch (e) {
      setDiscoverState('error');
      setDiscoverMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const addToLibrary = (hit: PaperSearchHit) => {
    const paper = importHit(hit);
    setImportedKeys((keys) => [...keys, hitKey(hit)]);
    setDiscoverMsg(`已入库：${paper.citekey}`);
  };

  return (
    <div className="sf-lib">
      <div className="sf-lib-mode">
        {(Object.keys(MODE_LABEL) as LibraryMode[]).map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'list' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder="过滤：year:>2020 venue:NeurIPS status:reading 关键词"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button className="sf-btn" onClick={() => setDialog('bibtex')}>
              BibTeX
            </button>
            <button className="sf-btn" onClick={() => setDialog('fetch')}>
              DOI/arXiv
            </button>
          </div>
          <p className="sf-lib-count">
            {filtered.length} / {papers.length} 条 · 知识索引{' '}
            {indexReady ? INDEX_MODE_LABEL[indexMode] : '构建中…'}
          </p>
          <ul className="sf-lib-list">
            {filtered.map((p) => (
              <li key={p.id} className="sf-lib-row">
                <div className="sf-lib-main">
                  <code className="sf-lib-key">{p.citekey}</code>
                  <span className="sf-lib-title" title={p.title}>
                    {p.title}
                  </span>
                  <span className="sf-lib-meta">
                    {p.year ?? '—'} · {p.venue?.name ?? p.venue?.type ?? '—'}
                  </span>
                </div>
                <div className="sf-lib-actions">
                  <select
                    className="sf-lib-status"
                    value={p.readStatus}
                    onChange={(e) => setReadStatus(p.id, e.target.value as ReadStatus)}
                  >
                    {(Object.keys(STATUS_LABEL) as ReadStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="icon-btn"
                    title="删除"
                    onClick={() => {
                      if (window.confirm(`删除「${p.citekey}」？`)) removePaper(p.id);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
            {filtered.length === 0 && <p className="placeholder">无匹配条目</p>}
          </ul>
        </>
      )}

      {mode === 'search' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder="在文献全文/摘要中语义检索…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
            />
            <button className="sf-btn" onClick={() => void runSearch()} disabled={searching}>
              {searching ? '检索中…' : '检索'}
            </button>
          </div>
          <p className="sf-lib-count">本地哈希嵌入 + BM25 混合检索（离线可用）</p>
          <ul className="sf-lib-results">
            {(results ?? []).map((c) => (
              <li key={c.id} className="sf-lib-chunk">
                <div className="sf-lib-chunk-head">
                  <code>
                    [{c.citekey ?? c.paperId}
                    {c.page !== undefined ? ` p.${c.page}` : ''}]
                  </code>
                  {c.heading && <span>{c.heading}</span>}
                  <span className="sf-lib-score">{c.score.toFixed(3)}</span>
                </div>
                <p>{c.text.length > 220 ? `${c.text.slice(0, 220)}…` : c.text}</p>
              </li>
            ))}
            {results !== null && results.length === 0 && <p className="placeholder">未检索到相关片段</p>}
            {results === null && (
              <p className="placeholder">输入问题后回车，例如：attention 机制的优点</p>
            )}
          </ul>
        </>
      )}

      {mode === 'discover' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder="关键词检索 arXiv + Crossref…"
              value={discoverQuery}
              onChange={(e) => setDiscoverQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runDiscover();
              }}
            />
            <button
              className="sf-btn"
              onClick={() => void runDiscover()}
              disabled={discoverState === 'searching' || !discoverQuery.trim()}
            >
              {discoverState === 'searching' ? '检索中…' : '检索'}
            </button>
          </div>
          {discoverMsg && <p className="sf-cites-msg">{discoverMsg}</p>}
          <p className="sf-lib-count">结果在两个数据源间按 DOI/arXiv ID/标题去重合并</p>
          <ul className="sf-lib-results">
            {(hits ?? []).map((hit) => {
              const key = hitKey(hit);
              const imported = importedKeys.includes(key);
              return (
                <li key={key} className="sf-lib-chunk sf-lib-hit">
                  <div className="sf-lib-chunk-head">
                    <span className={`sf-chip dim sf-lib-src`}>{hit.source}</span>
                    {hit.venue?.name && <span>{hit.venue.name}</span>}
                    {hit.year !== undefined && <span>{hit.year}</span>}
                  </div>
                  <p className="sf-lib-hit-title">{hit.title}</p>
                  <p className="sf-lib-hit-meta">
                    {hit.authors
                      .slice(0, 4)
                      .map((a) => (a.given ? `${a.family} ${a.given}` : a.family))
                      .join(', ')}
                    {hit.authors.length > 4 ? ' 等' : ''}
                  </p>
                  {hit.abstract && (
                    <p className="sf-lib-hit-abs">
                      {hit.abstract.length > 160 ? `${hit.abstract.slice(0, 160)}…` : hit.abstract}
                    </p>
                  )}
                  <div className="sf-lib-hit-actions">
                    <button
                      className="sf-btn"
                      disabled={imported}
                      onClick={() => addToLibrary(hit)}
                    >
                      {imported ? '已在库中' : '加入文献库'}
                    </button>
                  </div>
                </li>
              );
            })}
            {hits !== null && hits.length === 0 && discoverState === 'done' && (
              <p className="placeholder">无检索结果</p>
            )}
            {hits === null && (
              <p className="placeholder">例如：vision language model、扩散模型 综述</p>
            )}
          </ul>
        </>
      )}

      {dialog === 'bibtex' && (
        <div className="sf-dialog-overlay" onMouseDown={() => setDialog(null)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>导入 BibTeX</strong>
            </header>
            <div className="sf-dialog-body">
              <textarea
                className="sf-input sf-lib-textarea"
                placeholder={'粘贴 BibTeX 条目…\n\n@article{...}'}
                value={bibtexText}
                onChange={(e) => setBibtexText(e.target.value)}
              />
              {importResult && <p className="sf-cites-msg">{importResult}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setDialog(null)}>
                  关闭
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={() => {
                    const r = importBibtex(bibtexText);
                    setImportResult(
                      `导入 ${r.added} 条${r.errors.length ? `；${r.errors.length} 条提示：${r.errors.slice(0, 3).join('；')}` : ''}`,
                    );
                    if (r.added > 0) setBibtexText('');
                  }}
                  disabled={!bibtexText.trim()}
                >
                  导入
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {dialog === 'fetch' && (
        <div className="sf-dialog-overlay" onMouseDown={() => setDialog(null)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>按 DOI / arXiv ID 抓取元数据</strong>
            </header>
            <div className="sf-dialog-body">
              <div className="sf-lib-toolbar">
                <select
                  className="sf-lib-status"
                  value={fetchKind}
                  onChange={(e) => setFetchKind(e.target.value as 'doi' | 'arxiv')}
                >
                  <option value="doi">DOI</option>
                  <option value="arxiv">arXiv</option>
                </select>
                <input
                  className="sf-input sf-lib-filter"
                  placeholder={fetchKind === 'doi' ? '10.5555/12345678' : '2303.08774'}
                  value={fetchId}
                  onChange={(e) => setFetchId(e.target.value)}
                />
              </div>
              {fetchMsg && <p className="sf-cites-msg">{fetchMsg}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setDialog(null)}>
                  关闭
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={async () => {
                    setFetchMsg('抓取中…');
                    const r = await fetchMetadata(fetchKind, fetchId);
                    if (r.ok) {
                      setFetchMsg(`已入库：${r.paper.citekey}`);
                      setFetchId('');
                    } else {
                      setFetchMsg(r.error);
                    }
                  }}
                  disabled={!fetchId.trim()}
                >
                  抓取
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function hitKey(hit: PaperSearchHit): string {
  return hit.doi ?? hit.arxivId ?? hit.title.toLowerCase();
}
