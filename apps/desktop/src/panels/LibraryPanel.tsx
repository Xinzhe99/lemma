/**
 * 文献库面板：条目列表（智能过滤器查询语言 + 详情视图 + 多选批量操作 + 库内 PDF 关联）/
 * 全文知识检索 / 文献发现（arXiv+Crossref 聚合检索，一键入库）/ 导入。
 *
 * WF-4：
 * - L1 点击条目展开详情：全部作者、摘要全文、DOI/arXiv 外链、IEEE/APA/AMA 引用格式预览；
 * - L2 「打开 PDF」经 libraryStore.openPdf（uiStore.setPdfView）、「关联本地 PDF」走隐藏 file input（Ref 回调式）；
 * - L5 条目多选批量「标记已读 / 删除」，文案 zh/en 双语（useSettingsStore.language）。
 */

import { useRef, useState, type ChangeEvent } from 'react';
import { BookOpen, Paperclip, Trash2 } from 'lucide-react';
import {
  applyFilter,
  CITATION_STYLES,
  formatCitation,
  mergeSearchHits,
  parseCitationSegments,
  searchArxiv,
  searchCrossref,
  type CitationStyle,
  type PaperSearchHit,
} from '@scholarforge/library';
import type { Paper, ReadStatus } from '@scholarforge/shared';
import { useLibraryStore, type CitedRetrievedChunk } from '../state/libraryStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useUiStore, type LibraryMode } from '../state/uiStore';
import './library.css';

// ---------------------------------------------------------------------------
// 双语文案（自包含，不进全局 i18n 字典）
// ---------------------------------------------------------------------------

interface Copy {
  modeList: string;
  modeSearch: string;
  modeDiscover: string;
  filterPlaceholder: string;
  searchPlaceholder: string;
  discoverPlaceholder: string;
  searchButton: string;
  searching: string;
  searchHint: string;
  searchEmpty: string;
  searchIdle: string;
  discoverHint: string;
  discoverEmptyQuery: string;
  discoverNoResults: string;
  discoverIdle: string;
  discoverBothFailed: string;
  etAl: string;
  addToLibrary: string;
  inLibrary: string;
  imported: (citekey: string) => string;
  count: (shown: number, total: number, index: string) => string;
  indexBuilding: string;
  emptyList: string;
  statusLabel: Record<ReadStatus, string>;
  indexModeLabel: Record<'hash' | 'api' | 'api-fallback', string>;
  deleteTitle: string;
  deleteConfirm: (citekey: string) => string;
  batchSelected: (n: number) => string;
  markRead: string;
  batchDelete: string;
  clearSelection: string;
  detailAuthors: string;
  detailAbstract: string;
  noAbstract: string;
  detailCitation: string;
  openPdf: string;
  attachPdf: string;
  openPdfErrPaper: string;
  openPdfErrAttach: string;
  dialogClose: string;
  dialogImport: string;
  bibtexTitle: string;
  bibtexPlaceholder: string;
  importSummary: (added: number, notes: string) => string;
  importNotes: (n: number) => string;
  fetchTitle: string;
  fetchButton: string;
  fetching: string;
  fetchOk: (citekey: string) => string;
}

const COPY: Record<Language, Copy> = {
  zh: {
    modeList: '条目',
    modeSearch: '知识检索',
    modeDiscover: '发现',
    filterPlaceholder: '过滤：year:>2020 venue:NeurIPS status:reading 关键词',
    searchPlaceholder: '在文献全文/摘要中语义检索…',
    discoverPlaceholder: '关键词检索 arXiv + Crossref…',
    searchButton: '检索',
    searching: '检索中…',
    searchHint: '本地哈希嵌入 + BM25 混合检索（离线可用）',
    searchEmpty: '未检索到相关片段',
    searchIdle: '输入问题后回车，例如：attention 机制的优点',
    discoverHint: '结果在两个数据源间按 DOI/arXiv ID/标题去重合并',
    discoverEmptyQuery: '无检索结果，试试更短的关键词',
    discoverNoResults: '无检索结果',
    discoverIdle: '例如：vision language model、扩散模型 综述',
    discoverBothFailed: '两个数据源都失败了（浏览器直连可能受跨域限制，桌面形态无此问题）',
    etAl: ' 等',
    addToLibrary: '加入文献库',
    inLibrary: '已在库中',
    imported: (citekey) => `已入库：${citekey}`,
    count: (shown, total, index) => `${shown} / ${total} 条 · 知识索引 ${index}`,
    indexBuilding: '构建中…',
    emptyList: '无匹配条目',
    statusLabel: { 'to-read': '待读', reading: '在读', done: '已读' },
    indexModeLabel: { hash: '就绪（本地哈希）', api: '就绪（语义嵌入）', 'api-fallback': '已回退本地哈希' },
    deleteTitle: '删除',
    deleteConfirm: (citekey) => `删除「${citekey}」？`,
    batchSelected: (n) => `已选 ${n} 项`,
    markRead: '标记已读',
    batchDelete: '删除所选',
    clearSelection: '取消选择',
    detailAuthors: '全部作者',
    detailAbstract: '摘要',
    noAbstract: '（无摘要）',
    detailCitation: '引用格式',
    openPdf: '打开 PDF',
    attachPdf: '关联本地 PDF',
    openPdfErrPaper: '条目不存在，请刷新列表',
    openPdfErrAttach: '尚未关联 PDF，请先「关联本地 PDF」',
    dialogClose: '关闭',
    dialogImport: '导入',
    bibtexTitle: '导入 BibTeX',
    bibtexPlaceholder: '粘贴 BibTeX 条目…\n\n@article{...}',
    importSummary: (added, notes) => `导入 ${added} 条${notes}`,
    importNotes: (n) => `；${n} 条提示`,
    fetchTitle: '按 DOI / arXiv ID 抓取元数据',
    fetchButton: '抓取',
    fetching: '抓取中…',
    fetchOk: (citekey) => `已入库：${citekey}`,
  },
  en: {
    modeList: 'Items',
    modeSearch: 'Knowledge',
    modeDiscover: 'Discover',
    filterPlaceholder: 'Filter: year:>2020 venue:NeurIPS status:reading keywords',
    searchPlaceholder: 'Semantic search across full texts/abstracts…',
    discoverPlaceholder: 'Search arXiv + Crossref…',
    searchButton: 'Search',
    searching: 'Searching…',
    searchHint: 'Local hash embeddings + BM25 hybrid retrieval (offline)',
    searchEmpty: 'No matching chunks',
    searchIdle: 'Type a question and press Enter, e.g. advantages of attention',
    discoverHint: 'Hits deduped across sources by DOI/arXiv ID/title',
    discoverEmptyQuery: 'No results; try shorter keywords',
    discoverNoResults: 'No results',
    discoverIdle: 'e.g. vision language model, diffusion survey',
    discoverBothFailed: 'Both sources failed (browser CORS limits; fine in the desktop form)',
    etAl: ' et al.',
    addToLibrary: 'Add to library',
    inLibrary: 'In library',
    imported: (citekey) => `Added: ${citekey}`,
    count: (shown, total, index) => `${shown} / ${total} items · Knowledge index ${index}`,
    indexBuilding: 'building…',
    emptyList: 'No matching items',
    statusLabel: { 'to-read': 'To read', reading: 'Reading', done: 'Done' },
    indexModeLabel: { hash: 'ready (local hash)', api: 'ready (semantic)', 'api-fallback': 'fell back to local hash' },
    deleteTitle: 'Delete',
    deleteConfirm: (citekey) => `Delete "${citekey}"?`,
    batchSelected: (n) => `${n} selected`,
    markRead: 'Mark as read',
    batchDelete: 'Delete selected',
    clearSelection: 'Clear selection',
    detailAuthors: 'Authors',
    detailAbstract: 'Abstract',
    noAbstract: '(no abstract)',
    detailCitation: 'Citation',
    openPdf: 'Open PDF',
    attachPdf: 'Attach local PDF',
    openPdfErrPaper: 'Item not found; refresh the list',
    openPdfErrAttach: 'No PDF attached yet — use "Attach local PDF" first',
    dialogClose: 'Close',
    dialogImport: 'Import',
    bibtexTitle: 'Import BibTeX',
    bibtexPlaceholder: 'Paste BibTeX entries…\n\n@article{...}',
    importSummary: (added, notes) => `Imported ${added}${notes}`,
    importNotes: (n) => `; ${n} notes`,
    fetchTitle: 'Fetch metadata by DOI / arXiv ID',
    fetchButton: 'Fetch',
    fetching: 'Fetching…',
    fetchOk: (citekey) => `Added: ${citekey}`,
  },
};

const MODE_ORDER: LibraryMode[] = ['list', 'search', 'discover'];

export function LibraryPanel() {
  const language = useSettingsStore((s) => s.language);
  const c = COPY[language];

  const papers = useLibraryStore((s) => s.papers);
  const pdfAttachments = useLibraryStore((s) => s.pdfAttachments);
  const indexReady = useLibraryStore((s) => s.indexReady);
  const indexMode = useLibraryStore((s) => s.indexMode);
  const importBibtex = useLibraryStore((s) => s.importBibtex);
  const importHit = useLibraryStore((s) => s.importHit);
  const fetchMetadata = useLibraryStore((s) => s.fetchMetadata);
  const removePaper = useLibraryStore((s) => s.removePaper);
  const removePapers = useLibraryStore((s) => s.removePapers);
  const setReadStatus = useLibraryStore((s) => s.setReadStatus);
  const setReadStatusBulk = useLibraryStore((s) => s.setReadStatusBulk);
  const attachPdf = useLibraryStore((s) => s.attachPdf);
  const openPdf = useLibraryStore((s) => s.openPdf);
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

  // L1 详情展开 / L5 多选 / L2 打开反馈
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);

  // L2 关联本地 PDF：隐藏 file input，Ref 回调式记录挂载元素与目标条目
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const attachTargetRef = useRef<string | null>(null);

  const filtered =
    mode === 'list' && query.trim() ? applyFilter(papers, query) : papers;

  const modeLabel: Record<LibraryMode, string> = {
    list: c.modeList,
    search: c.modeSearch,
    discover: c.modeDiscover,
  };

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
        setDiscoverMsg(bothFailed ? c.discoverBothFailed : c.discoverEmptyQuery);
      }
    } catch (e) {
      setDiscoverState('error');
      setDiscoverMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const addToLibrary = (hit: PaperSearchHit) => {
    const paper = importHit(hit);
    setImportedKeys((keys) => [...keys, hitKey(hit)]);
    setDiscoverMsg(c.imported(paper.citekey));
  };

  const toggleSelect = (id: string): void => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenPdf = (id: string): void => {
    const r = openPdf(id);
    setPdfMsg(r.ok ? null : r.error === 'no-paper' ? c.openPdfErrPaper : c.openPdfErrAttach);
  };

  const handleAttachFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    const targetId = attachTargetRef.current;
    event.target.value = '';
    if (!file || !targetId) return;
    attachTargetRef.current = null;
    attachPdf(targetId, await file.arrayBuffer());
    setPdfMsg(null);
  };

  const batchMarkRead = (): void => {
    setReadStatusBulk([...selectedIds], 'done');
    setSelectedIds(new Set());
  };

  const batchRemove = (): void => {
    if (window.confirm(c.batchSelected(selectedIds.size))) {
      removePapers([...selectedIds]);
      setSelectedIds(new Set());
      if (expandedId && !papers.some((p) => p.id === expandedId)) setExpandedId(null);
    }
  };

  return (
    <div className="sf-lib">
      <div className="sf-lib-mode">
        {MODE_ORDER.map((m) => (
          <button key={m} className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>
            {modeLabel[m]}
          </button>
        ))}
      </div>

      {mode === 'list' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder={c.filterPlaceholder}
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
            {c.count(
              filtered.length,
              papers.length,
              indexReady ? c.indexModeLabel[indexMode] : c.indexBuilding,
            )}
          </p>
          {selectedIds.size > 0 && (
            <div className="sf-lib-batch" role="toolbar">
              <span className="sf-lib-batch-count">{c.batchSelected(selectedIds.size)}</span>
              <button className="sf-btn" onClick={batchMarkRead}>
                {c.markRead}
              </button>
              <button className="sf-btn sf-lib-batch-delete" onClick={batchRemove}>
                {c.batchDelete}
              </button>
              <button className="sf-link-btn" onClick={() => setSelectedIds(new Set())}>
                {c.clearSelection}
              </button>
            </div>
          )}
          {pdfMsg && <p className="sf-cites-msg">{pdfMsg}</p>}
          <ul className="sf-lib-list">
            {filtered.map((p) => {
              const expanded = expandedId === p.id;
              const hasAttachment = pdfAttachments[p.id] !== undefined;
              return (
                <li key={p.id} className={`sf-lib-row${expanded ? ' sf-lib-row--expanded' : ''}`}>
                  <div className="sf-lib-main">
                    <div
                      className="sf-lib-head"
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedId(expanded ? null : p.id);
                        }
                      }}
                    >
                      <input
                        type="checkbox"
                        className="sf-lib-check"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={p.citekey}
                      />
                      <code className="sf-lib-key">{p.citekey}</code>
                      <span className="sf-lib-title" title={p.title}>
                        {p.title}
                      </span>
                    </div>
                    <span className="sf-lib-meta">
                      {p.year ?? '—'} · {p.venue?.name ?? p.venue?.type ?? '—'}
                    </span>
                  </div>
                  <div className="sf-lib-actions" onClick={(e) => e.stopPropagation()}>
                    <select
                      className="sf-lib-status"
                      value={p.readStatus}
                      onChange={(e) => setReadStatus(p.id, e.target.value as ReadStatus)}
                    >
                      {(Object.keys(c.statusLabel) as ReadStatus[]).map((s) => (
                        <option key={s} value={s}>
                          {c.statusLabel[s]}
                        </option>
                      ))}
                    </select>
                    {hasAttachment ? (
                      <button className="sf-btn sf-lib-pdf-btn" onClick={() => handleOpenPdf(p.id)}>
                        <BookOpen size={13} /> {c.openPdf}
                      </button>
                    ) : (
                      <button
                        className="sf-btn sf-lib-pdf-btn"
                        onClick={() => {
                          attachTargetRef.current = p.id;
                          attachInputRef.current?.click();
                        }}
                      >
                        <Paperclip size={13} /> {c.attachPdf}
                      </button>
                    )}
                    <button
                      className="icon-btn"
                      title={c.deleteTitle}
                      onClick={() => {
                        if (window.confirm(c.deleteConfirm(p.citekey))) removePaper(p.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {expanded && <PaperDetail paper={p} language={language} copy={c} />}
                </li>
              );
            })}
            {filtered.length === 0 && <p className="placeholder">{c.emptyList}</p>}
          </ul>
          <input
            ref={(el) => {
              attachInputRef.current = el;
            }}
            type="file"
            accept="application/pdf"
            style={{ display: 'none' }}
            onChange={(e) => void handleAttachFile(e)}
          />
        </>
      )}

      {mode === 'search' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder={c.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
              }}
            />
            <button className="sf-btn" onClick={() => void runSearch()} disabled={searching}>
              {searching ? c.searching : c.searchButton}
            </button>
          </div>
          <p className="sf-lib-count">{c.searchHint}</p>
          <ul className="sf-lib-results">
            {(results ?? []).map((chunk) => (
              <li key={chunk.id} className="sf-lib-chunk">
                <div className="sf-lib-chunk-head">
                  <code>
                    [{chunk.citekey ?? chunk.paperId}
                    {chunk.page !== undefined ? ` p.${chunk.page}` : ''}]
                  </code>
                  {chunk.heading && <span>{chunk.heading}</span>}
                  <span className="sf-lib-score">{chunk.score.toFixed(3)}</span>
                </div>
                <p>{chunk.text.length > 220 ? `${chunk.text.slice(0, 220)}…` : chunk.text}</p>
              </li>
            ))}
            {results !== null && results.length === 0 && <p className="placeholder">{c.searchEmpty}</p>}
            {results === null && <p className="placeholder">{c.searchIdle}</p>}
          </ul>
        </>
      )}

      {mode === 'discover' && (
        <>
          <div className="sf-lib-toolbar">
            <input
              className="sf-input sf-lib-filter"
              placeholder={c.discoverPlaceholder}
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
              {discoverState === 'searching' ? c.searching : c.searchButton}
            </button>
          </div>
          {discoverMsg && <p className="sf-cites-msg">{discoverMsg}</p>}
          <p className="sf-lib-count">{c.discoverHint}</p>
          <ul className="sf-lib-results">
            {(hits ?? []).map((hit) => {
              const key = hitKey(hit);
              const imported = importedKeys.includes(key);
              return (
                <li key={key} className="sf-lib-chunk sf-lib-hit">
                  <div className="sf-lib-chunk-head">
                    <span className="sf-chip dim sf-lib-src">{hit.source}</span>
                    {hit.venue?.name && <span>{hit.venue.name}</span>}
                    {hit.year !== undefined && <span>{hit.year}</span>}
                  </div>
                  <p className="sf-lib-hit-title">{hit.title}</p>
                  <p className="sf-lib-hit-meta">
                    {hit.authors
                      .slice(0, 4)
                      .map((a) => (a.given ? `${a.family} ${a.given}` : a.family))
                      .join(', ')}
                    {hit.authors.length > 4 ? c.etAl : ''}
                  </p>
                  {hit.abstract && (
                    <p className="sf-lib-hit-abs">
                      {hit.abstract.length > 160 ? `${hit.abstract.slice(0, 160)}…` : hit.abstract}
                    </p>
                  )}
                  <div className="sf-lib-hit-actions">
                    <button className="sf-btn" disabled={imported} onClick={() => addToLibrary(hit)}>
                      {imported ? c.inLibrary : c.addToLibrary}
                    </button>
                  </div>
                </li>
              );
            })}
            {hits !== null && hits.length === 0 && discoverState === 'done' && (
              <p className="placeholder">{c.discoverNoResults}</p>
            )}
            {hits === null && <p className="placeholder">{c.discoverIdle}</p>}
          </ul>
        </>
      )}

      {dialog === 'bibtex' && (
        <div className="sf-dialog-overlay" onMouseDown={() => setDialog(null)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.bibtexTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              <textarea
                className="sf-input sf-lib-textarea"
                placeholder={c.bibtexPlaceholder}
                value={bibtexText}
                onChange={(e) => setBibtexText(e.target.value)}
              />
              {importResult && <p className="sf-cites-msg">{importResult}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setDialog(null)}>
                  {c.dialogClose}
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={() => {
                    const r = importBibtex(bibtexText);
                    setImportResult(
                      c.importSummary(
                        r.added,
                        r.errors.length > 0
                          ? `${c.importNotes(r.errors.length)}：${r.errors.slice(0, 3).join('；')}`
                          : '',
                      ),
                    );
                    if (r.added > 0) setBibtexText('');
                  }}
                  disabled={!bibtexText.trim()}
                >
                  {c.dialogImport}
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
              <strong>{c.fetchTitle}</strong>
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
                  {c.dialogClose}
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={async () => {
                    setFetchMsg(c.fetching);
                    const r = await fetchMetadata(fetchKind, fetchId);
                    if (r.ok) {
                      setFetchMsg(c.fetchOk(r.paper.citekey));
                      setFetchId('');
                    } else {
                      setFetchMsg(r.error);
                    }
                  }}
                  disabled={!fetchId.trim()}
                >
                  {c.fetchButton}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// L1 条目详情视图
// ---------------------------------------------------------------------------

function PaperDetail({ paper, language, copy }: { paper: Paper; language: Language; copy: Copy }) {
  const [citeStyle, setCiteStyle] = useState<CitationStyle>('IEEE');
  const citation = formatCitation(paper, citeStyle);
  const authors = paper.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')).join('; ');

  return (
    <div className="sf-lib-detail" onClick={(e) => e.stopPropagation()}>
      <dl className="sf-lib-detail-grid">
        <dt>{copy.detailAuthors}</dt>
        <dd>{authors || '—'}</dd>
        <dt>{copy.detailAbstract}</dt>
        <dd>{paper.abstract || copy.noAbstract}</dd>
        {(paper.doi || paper.arxivId) && (
          <>
            <dt>DOI / arXiv</dt>
            <dd className="sf-lib-links">
              {paper.doi && (
                <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noreferrer">
                  https://doi.org/{paper.doi}
                </a>
              )}
              {paper.arxivId && (
                <a href={`https://arxiv.org/abs/${paper.arxivId}`} target="_blank" rel="noreferrer">
                  arXiv:{paper.arxivId}
                </a>
              )}
            </dd>
          </>
        )}
        <dt>{copy.detailCitation}</dt>
        <dd>
          <div className="sf-lib-cite-tabs" role="tablist">
            {CITATION_STYLES.map((style) => (
              <button
                key={style}
                role="tab"
                aria-selected={citeStyle === style}
                className={citeStyle === style ? 'active' : ''}
                onClick={() => setCiteStyle(style)}
              >
                {style}
              </button>
            ))}
          </div>
          <p className="sf-lib-cite-preview" lang={language === 'zh' ? 'zh-CN' : 'en'}>
            {parseCitationSegments(citation).map((seg, i) =>
              seg.italic ? <em key={i}>{seg.text}</em> : <span key={i}>{seg.text}</span>,
            )}
          </p>
        </dd>
      </dl>
    </div>
  );
}

function hitKey(hit: PaperSearchHit): string {
  return hit.doi ?? hit.arxivId ?? hit.title.toLowerCase();
}
