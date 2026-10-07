/**
 * 文献库面板：条目列表（智能过滤器查询语言 + 详情视图 + 多选批量操作 + 库内 PDF 关联）/
 * 全文知识检索 / 文献发现（arXiv+Crossref 聚合检索，一键入库）/ 导入。
 *
 * v7.6.0 条目工具栏重构：tab 内只留高频操作——整行搜索框 + [筛选下拉 | 导入文献]；
 * 其余入口（BibTeX / RIS / Zotero JSON / DOI/arXiv / PDF 目录 / Zotero 同步 / 清理 Bib /
 * 导出全库 .bib）全部收进「导入文献」对话框（sf-lib-import，四分组：粘贴导入 / 在线获取 /
 * 批量关联 / 导出与维护）。各分组按钮只做入口，打开既有对话框 / 触发既有逻辑。
 *
 * WF-4：
 * - L1 点击条目展开详情：全部作者、摘要全文、DOI/arXiv 外链、IEEE/APA/AMA 引用格式预览；
 * - L2 「打开 PDF」经 libraryStore.openPdf（uiStore.setPdfView）、「关联本地 PDF」走隐藏 file input（Ref 回调式）；
 * - L5 条目多选批量「标记已读 / 删除」，文案 zh/en 双语（useSettingsStore.language）。
 *
 * Zotero 生态迁移（纯函数层见 ../zotero.ts）：
 * - 「Zotero JSON」对话框：粘贴 Better BibTeX JSON → parseZoteroJson → doi/arxivId/title
 *   查重 → importHit 入库；集合归属以 `zotero:<集合名>` 形式追加进 tags（tag: 过滤器天然可用）；
 * - 「PDF 目录」对话框：webkitdirectory 多选文件夹 → matchPdfToPaper 预览（置信度/无匹配）
 *   →「关联全部」逐个读 ArrayBuffer → attachPdf（v0.8.0 起附件持久化 IndexedDB）。
 *
 * Bib 清理向导（纯函数层见 ../bibCleaner.ts）：
 * - 「清理 Bib」按钮 → 对话框分组展示 refs.bib 的重复（error）/ 缺字段 / 不一致（warning）issue；
 * - 唯一可执行动作「自动去重（保留更全条目）」→ applyBibFixes 预览（删行统计 + 前 3 组
 *   被删 key）→ 应用内 confirm → snapshotFile 后 updateFile 写回项目 .bib；
 *   缺失 / 不一致类仅提示不改（诚实边界）；文献库条目（libraryStore）不受影响。
 */

import { useRef, useState, type ChangeEvent, type InputHTMLAttributes , useMemo} from 'react';
import { BookOpen, Download, Paperclip, Plus, Trash2 } from 'lucide-react';
import { RefreshCw } from 'lucide-react';
import { probeZotero, syncZotero } from '../zoteroSync';
import {
  applyFilter,
  CITATION_STYLES,
  disambiguateCitekey,
  formatCitation,
  generateCitekey,
  mergeSearchHits,
  papersToBibtex,
  parseCitationSegments,
  parseRis,
  searchArxiv,
  searchCrossref,
  type CitationStyle,
  type PaperSearchHit,
} from '@lemma/library';
import type { Paper, ReadStatus } from '@lemma/shared';
import { analyzeBib, applyBibFixes, diffLineStats, type BibIssue } from '../bibCleaner';
import { confirmDialog } from '../dialogs';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore, type CitedRetrievedChunk } from '../state/libraryStore';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useUiStore, type LibraryMode } from '../state/uiStore';
import {
  collectionNamesFor,
  matchPdfToPaper,
  paperIdentity,
  parseZoteroJson,
  readFileArrayBuffer,
  ZOTERO_TAG_PREFIX,
  type PdfMatchResult,
} from '../zotero';
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
  /** 批量删除的应用内确认标题（L5 删除确认走 uiStore.openTextDialog） */
  batchDeleteConfirm: (n: number) => string;
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
  // —— v7.6.0「导入文献」对话框（工具栏只留搜索 + 筛选 + 本入口，低频操作全部收进来） ——
  importButton: string;
  importTitle: string;
  secPaste: string;
  secPasteDesc: string;
  secOnline: string;
  secOnlineDesc: string;
  secBulk: string;
  secBulkDesc: string;
  secMaintain: string;
  secMaintainDesc: string;
  /** 在线获取区入口按钮（打开既有 fetch 对话框） */
  fetchEntry: string;
  /** Zotero 同步区本地状态说明（替代旧「未检测到本地 Zotero」chip） */
  zoteroStatusOff: string;
  zoteroStatusOk: string;
  zoteroStatusBusy: string;
  zoteroSyncDone: (added: number, errors: number) => string;
  /** 搜索框 title 提示：智能过滤器查询语法（placeholder 已简化） */
  filterSyntaxHint: string;
  bibtexTitle: string;
  bibtexPlaceholder: string;
  importSummary: (added: number, notes: string) => string;
  importNotes: (n: number) => string;
  risTitle: string;
  risPlaceholder: string;
  risImportSummary: (added: number, errors: number) => string;
  zoteroButton: string;
  zoteroTitle: string;
  /** v7.5.0：一键同步按钮（此前硬编码中文） */
  zoteroSyncButton: string;
  zoteroSyncTitle: string;
  zoteroPlaceholder: string;
  /** Zotero JSON 导入结果：导入 N / 跳过重复 M / 解析错误 K */
  zoteroImportSummary: (added: number, dupes: number, errors: number) => string;
  pdfDirButton: string;
  pdfDirTitle: string;
  pdfDirHint: string;
  pdfDirPick: string;
  pdfDirEmpty: string;
  pdfDirCount: (matched: number, total: number) => string;
  pdfNoMatch: string;
  pdfConfidence: (score: number) => string;
  pdfAttachAll: string;
  pdfAttaching: string;
  pdfAttachDone: (ok: number, fail: number) => string;
  fetchTitle: string;
  fetchButton: string;
  fetching: string;
  fetchOk: (citekey: string) => string;
  exportBib: string;
  exportBibEmpty: string;
  exportBibDone: (n: number) => string;
  // —— Bib 清理向导 ——
  cleanButton: string;
  cleanTitle: string;
  /** 对话框内的目标文件说明 + 诚实边界提示（缺失/不一致仅提示不自动改） */
  cleanTarget: (path: string) => string;
  cleanErrors: (n: number) => string;
  cleanWarnings: (n: number) => string;
  cleanSuggestionLabel: string;
  cleanNoBib: string;
  cleanNoIssues: string;
  cleanDedupe: string;
  cleanPreviewStats: (entries: number, lines: number) => string;
  cleanPreviewGroups: string;
  cleanConfirm: string;
  cleanConfirmDialog: (n: number) => string;
  cleanDone: (path: string, n: number) => string;
  cleanCancelled: string;
}

const COPY: Record<Language, Copy> = {
  zh: {
    modeList: '条目',
    modeSearch: '知识检索',
    modeDiscover: '发现',
    filterPlaceholder: '搜索标题/作者/citekey…',
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
    indexModeLabel: { hash: '就绪（本地 TF-IDF）', api: '就绪（语义嵌入）', 'api-fallback': '已回退本地 TF-IDF' },
    deleteTitle: '删除',
    deleteConfirm: (citekey) => `删除「${citekey}」？`,
    batchSelected: (n) => `已选 ${n} 项`,
    batchDeleteConfirm: (n) => `删除所选 ${n} 条文献？`,
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
    importButton: '导入文献',
    importTitle: '导入文献',
    secPaste: '粘贴导入',
    secPasteDesc: '粘贴 BibTeX / RIS / Zotero 导出的文本，一键入库',
    secOnline: '在线获取',
    secOnlineDesc: '按 DOI / arXiv ID 抓取元数据并入库',
    secBulk: '批量关联',
    secBulkDesc: '把本地 PDF 批量关联到条目，或从本机 Zotero 同步',
    secMaintain: '导出与维护',
    secMaintainDesc: '导出全库 .bib，或清理项目 .bib 中的重复条目',
    fetchEntry: 'DOI / arXiv 抓取',
    zoteroStatusOff: '未检测到本机 Zotero（需安装 Zotero 并运行 Better BibTeX）',
    zoteroStatusOk: '已连接本机 Zotero',
    zoteroStatusBusy: '正在连接本机 Zotero…',
    zoteroSyncDone: (added, errors) =>
      `同步完成：新增 ${added} 条${errors > 0 ? ` / 解析错误 ${errors} 条` : ''}`,
    filterSyntaxHint: '支持过滤语法：year:>2020 venue:NeurIPS status:reading 关键词',
    bibtexTitle: '导入 BibTeX',
    bibtexPlaceholder: '粘贴 BibTeX 条目…\n\n@article{...}',
    importSummary: (added, notes) => `导入 ${added} 条${notes}`,
    importNotes: (n) => `；${n} 条提示`,
    risTitle: '导入 RIS',
    risPlaceholder: '粘贴 RIS 条目…\n\nTY  - JOUR\nTI  - …\nER  - ',
    risImportSummary: (added, errors) => `导入 ${added} 条 / 错误 ${errors} 条`,
    zoteroButton: 'Zotero JSON',
    zoteroTitle: '导入 Zotero JSON',
    zoteroSyncButton: 'Zotero 同步',
    zoteroSyncTitle: '连接本地 Zotero（Better BibTeX）一键同步文献——增量去重',
    zoteroPlaceholder:
      'Zotero 中右键集合 → Export → Better BibTeX JSON，粘贴到此…\n\n[{"itemType": "journalArticle", "title": "…"}]',
    zoteroImportSummary: (added, dupes, errors) =>
      `导入 ${added} 条 / 跳过重复 ${dupes} / 错误 ${errors}`,
    pdfDirButton: 'PDF 目录',
    pdfDirTitle: '批量关联 PDF 文件夹',
    pdfDirHint: '选择本地 PDF 文件夹（如 Zotero 存储目录），按文件名与标题/citekey 匹配，预览确认后一键关联',
    pdfDirPick: '选择 PDF 文件夹',
    pdfDirEmpty: '所选文件夹中没有 PDF 文件',
    pdfDirCount: (matched, total) => `匹配 ${matched} / 共 ${total} 个 PDF`,
    pdfNoMatch: '无匹配',
    pdfConfidence: (score) => `置信度 ${Math.round(score * 100)}%`,
    pdfAttachAll: '关联全部',
    pdfAttaching: '关联中…',
    pdfAttachDone: (ok, fail) => (fail > 0 ? `关联成功 ${ok} 个 / 失败 ${fail} 个` : `关联成功 ${ok} 个`),
    fetchTitle: '按 DOI / arXiv ID 抓取元数据',
    fetchButton: '抓取',
    fetching: '抓取中…',
    fetchOk: (citekey) => `已入库：${citekey}`,
    exportBib: '导出全库 .bib',
    exportBibEmpty: '文献库为空，没有可导出的条目',
    exportBibDone: (n) => `已导出 ${n} 条文献到 .bib`,
    cleanButton: '清理 Bib',
    cleanTitle: '清理 Bib：重复 / 缺字段 / 不一致',
    cleanTarget: (path) =>
      `目标文件：${path} · 缺失 / 不一致类问题仅提示，不做自动修改；重复条目可一键去重`,
    cleanErrors: (n) => `错误（重复条目，${n} 组）`,
    cleanWarnings: (n) => `警告（缺字段 / 不一致，${n} 条）`,
    cleanSuggestionLabel: '建议：',
    cleanNoBib: '项目中没有 .bib 文件（先导入 BibTeX 或在文件树新建 refs.bib）',
    cleanNoIssues: '未发现问题：这个 .bib 看起来很干净',
    cleanDedupe: '自动去重（保留更全条目）',
    cleanPreviewStats: (entries, lines) => `将删除 ${entries} 条重复条目（约 ${lines} 行）`,
    cleanPreviewGroups: '涉及重复组（前 3 组）：',
    cleanConfirm: '确认写入',
    cleanConfirmDialog: (n) =>
      `确认写入 .bib：删除 ${n} 条重复条目？写入前会自动创建快照，文献库条目不受影响。`,
    cleanDone: (path, n) => `已更新 ${path}：删除 ${n} 条重复条目（文献库条目不受影响）`,
    cleanCancelled: '已取消：.bib 未修改',
  },
  en: {
    modeList: 'Items',
    modeSearch: 'Knowledge',
    modeDiscover: 'Discover',
    filterPlaceholder: 'Search title/author/citekey…',
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
    indexModeLabel: { hash: 'ready (local TF-IDF)', api: 'ready (semantic)', 'api-fallback': 'fell back to local TF-IDF' },
    deleteTitle: 'Delete',
    deleteConfirm: (citekey) => `Delete "${citekey}"?`,
    batchSelected: (n) => `${n} selected`,
    batchDeleteConfirm: (n) => `Delete ${n} selected items?`,
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
    importButton: 'Import papers',
    importTitle: 'Import papers',
    secPaste: 'Paste import',
    secPasteDesc: 'Paste BibTeX / RIS / Zotero export text to import in one click',
    secOnline: 'Fetch online',
    secOnlineDesc: 'Fetch metadata by DOI / arXiv ID into the library',
    secBulk: 'Bulk attach',
    secBulkDesc: 'Attach local PDFs in bulk, or sync from local Zotero',
    secMaintain: 'Export & maintenance',
    secMaintainDesc: 'Export the library as .bib, or clean duplicates from the project .bib',
    fetchEntry: 'DOI / arXiv fetch',
    zoteroStatusOff: 'Local Zotero not detected (install Zotero and run it with Better BibTeX)',
    zoteroStatusOk: 'Connected to local Zotero',
    zoteroStatusBusy: 'Connecting to local Zotero…',
    zoteroSyncDone: (added, errors) =>
      `Sync done: ${added} added${errors > 0 ? ` / ${errors} parse errors` : ''}`,
    filterSyntaxHint: 'Filter syntax supported: year:>2020 venue:NeurIPS status:reading keywords',
    bibtexTitle: 'Import BibTeX',
    bibtexPlaceholder: 'Paste BibTeX entries…\n\n@article{...}',
    importSummary: (added, notes) => `Imported ${added}${notes}`,
    importNotes: (n) => `; ${n} notes`,
    risTitle: 'Import RIS',
    risPlaceholder: 'Paste RIS records…\n\nTY  - JOUR\nTI  - …\nER  - ',
    risImportSummary: (added, errors) => `Imported ${added} / ${errors} errors`,
    zoteroButton: 'Zotero JSON',
    zoteroTitle: 'Import Zotero JSON',
    zoteroSyncButton: 'Zotero sync',
    zoteroSyncTitle: 'One-click sync with local Zotero (Better BibTeX) — dedupes incrementally',
    zoteroPlaceholder:
      'In Zotero: right-click a collection → Export → Better BibTeX JSON, then paste here…\n\n[{"itemType": "journalArticle", "title": "…"}]',
    zoteroImportSummary: (added, dupes, errors) =>
      `Imported ${added} / skipped ${dupes} duplicates / ${errors} errors`,
    pdfDirButton: 'PDF folder',
    pdfDirTitle: 'Bulk-attach a PDF folder',
    pdfDirHint:
      'Pick a local PDF folder (e.g. your Zotero storage); files are matched against titles/citekeys, previewed, then attached in one click',
    pdfDirPick: 'Choose PDF folder',
    pdfDirEmpty: 'No PDF files found in the chosen folder',
    pdfDirCount: (matched, total) => `${matched} matched / ${total} PDFs`,
    pdfNoMatch: 'No match',
    pdfConfidence: (score) => `confidence ${Math.round(score * 100)}%`,
    pdfAttachAll: 'Attach all',
    pdfAttaching: 'Attaching…',
    pdfAttachDone: (ok, fail) => (fail > 0 ? `Attached ${ok} / failed ${fail}` : `Attached ${ok}`),
    fetchTitle: 'Fetch metadata by DOI / arXiv ID',
    fetchButton: 'Fetch',
    fetching: 'Fetching…',
    fetchOk: (citekey) => `Added: ${citekey}`,
    exportBib: 'Export library .bib',
    exportBibEmpty: 'Library is empty — nothing to export',
    exportBibDone: (n) => `Exported ${n} papers to .bib`,
    cleanButton: 'Clean Bib',
    cleanTitle: 'Clean Bib: duplicates / missing fields / inconsistencies',
    cleanTarget: (path) =>
      `Target file: ${path} · missing-field and inconsistency findings are informational only; duplicates can be merged in one click`,
    cleanErrors: (n) => `Errors (duplicate groups: ${n})`,
    cleanWarnings: (n) => `Warnings (missing fields / inconsistencies: ${n})`,
    cleanSuggestionLabel: 'Suggestion: ',
    cleanNoBib: 'No .bib file in this project (import BibTeX or create refs.bib first)',
    cleanNoIssues: 'No issues found — this .bib looks clean',
    cleanDedupe: 'Auto-dedupe (keep the fuller entry)',
    cleanPreviewStats: (entries, lines) => `Will remove ${entries} duplicate entries (~${lines} lines)`,
    cleanPreviewGroups: 'Affected duplicate groups (first 3):',
    cleanConfirm: 'Write changes',
    cleanConfirmDialog: (n) =>
      `Update the .bib file and remove ${n} duplicate entries? A snapshot is taken first; library items are unaffected.`,
    cleanDone: (path, n) => `Updated ${path}: removed ${n} duplicates (library items unaffected)`,
    cleanCancelled: 'Cancelled — .bib unchanged',
  },
};

const MODE_ORDER: LibraryMode[] = ['list', 'search', 'discover'];

/** PDF 目录批量关联的预览行：文件（含相对路径）→ 匹配结果（null = 无匹配）。 */
interface PdfCandidate {
  file: File;
  /** 相对路径（webkitRelativePath），缺省退回文件名 */
  path: string;
  match: PdfMatchResult | null;
}

/** 导出文件名时间戳（20260930-1416） */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 项目 .bib 定位：优先 refs.bib（演示项目与模板脚手架的约定名），否则取排序后首个 .bib */
function findBibPath(files: Record<string, string>): string | null {
  if ('refs.bib' in files) return 'refs.bib';
  const bibs = Object.keys(files).filter((f) => f.toLowerCase().endsWith('.bib')).sort();
  return bibs[0] ?? null;
}

/** 去重预览数据：新文本 / 被删 citekey / 行级统计 / 前 3 组重复（每组含全部 keys） */
interface CleanPreview {
  text: string;
  removed: string[];
  linesRemoved: number;
  groups: string[][];
}

export function LibraryPanel() {
  const language = useSettingsStore((s) => s.language);
  const c = COPY[language];

  const papers = useLibraryStore((s) => s.papers);

  // 稿件引用计数（v2.5.0 ③：每篇文献在当前项目 .tex 中被 \cite 了几次）
  const files = useWorkspaceStore((s) => s.files);
  const citedCountMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const [path, content] of Object.entries(files)) {
      if (!path.toLowerCase().endsWith('.tex')) continue;
      for (const m of content.matchAll(/\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
        for (const key of (m[1] ?? '').split(',')) {
          const k = key.trim();
          if (k) map.set(k, (map.get(k) ?? 0) + 1);
        }
      }
    }
    return map;
  }, [files]);
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

  const [smartFilter, setSmartFilter] = useState<'all' | 'recent' | 'cited' | 'unread'>('all');  const [results, setResults] = useState<CitedRetrievedChunk[] | null>(null);
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

  // RIS 导入对话框（组件内部 state——不占用 uiStore.libraryDialog，该类型归集成者所有）
  const [risOpen, setRisOpen] = useState(false);
  const [risText, setRisText] = useState('');
  const [risResult, setRisResult] = useState<string | null>(null);

  // v7.6.0「导入文献」对话框：低频入口的统一容器（粘贴导入 / 在线获取 / 批量关联 / 导出与维护）
  const [importOpen, setImportOpen] = useState(false);

  // Zotero JSON 导入对话框（同 RIS：组件内部 state，集合结构经 zotero:<名> tag 保留）

  const runZoteroSync = async () => {
    if (zoteroSyncState === 'busy' || zoteroSyncState === 'probing') return;
    setZoteroSyncState('probing');
    setZoteroSyncNote('');
    if (!(await probeZotero())) {
      // 探测失败：状态行回落为「未检测到本机 Zotero（需安装…）」明确说明（v7.6.0 起不再依赖含糊 chip）
      setZoteroSyncState('off');
      return;
    }
    setZoteroSyncState('busy');
    const r = await syncZotero();
    if (r.ok) {
      setZoteroSyncState('ok');
      setZoteroSyncNote(c.zoteroSyncDone(r.added, r.errors.length));
    } else {
      setZoteroSyncState('off');
      setZoteroSyncNote(r.reason);
    }
  };

  const [zoteroOpen, setZoteroOpen] = useState(false);
  const [zoteroText, setZoteroText] = useState('');
  const [zoteroResult, setZoteroResult] = useState<string | null>(null);

  /** v5.9.0 Zotero 本地同步状态 */
  const [zoteroSyncState, setZoteroSyncState] = useState<'idle' | 'probing' | 'busy' | 'ok' | 'off'>('idle');
  const [zoteroSyncNote, setZoteroSyncNote] = useState('');

  // PDF 目录批量关联：预览候选（文件 → 匹配文献 + 置信度 / 无匹配）
  const [pdfDirOpen, setPdfDirOpen] = useState(false);
  const [pdfCandidates, setPdfCandidates] = useState<PdfCandidate[]>([]);
  const [pdfDirMsg, setPdfDirMsg] = useState<string | null>(null);
  const [pdfAttaching, setPdfAttaching] = useState(false);
  const pdfDirInputRef = useRef<HTMLInputElement | null>(null);

  // Bib 清理向导（同 RIS/Zotero：组件内部 state，不占 uiStore.libraryDialog）。
  // 打开时从 workspaceStore 抓取 .bib 快照分析；写入走 getState 直调（一次性动作，
  // 无需把工作区文件订阅进本面板的渲染路径）
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanBibPath, setCleanBibPath] = useState<string | null>(null);
  const [cleanIssues, setCleanIssues] = useState<BibIssue[]>([]);
  const [cleanPreview, setCleanPreview] = useState<CleanPreview | null>(null);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);

  // L1 详情展开 / L5 多选 / L2 打开反馈
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pdfMsg, setPdfMsg] = useState<string | null>(null);

  // L2 关联本地 PDF：隐藏 file input，Ref 回调式记录挂载元素与目标条目
  const attachInputRef = useRef<HTMLInputElement | null>(null);
  const attachTargetRef = useRef<string | null>(null);

  // 智能筛选（v3.4.0 B）：全部 / 最近添加 / 被稿件引用 / 未读
  const smartFiltered = useMemo(() => {
    if (smartFilter === 'recent') return [...papers].sort((a, b) => b.addedAt - a.addedAt).slice(0, 20);
    if (smartFilter === 'cited') return papers.filter((p) => (citedCountMap.get(p.citekey) ?? 0) > 0);
    if (smartFilter === 'unread') return papers.filter((p) => p.readStatus === 'to-read');
    return papers;
  }, [papers, smartFilter, citedCountMap]);

  const filtered =
    mode === 'list' && query.trim() ? applyFilter(smartFiltered, query) : smartFiltered;

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

  /** 批量删除：应用内确认（Tauri WKWebView 下原生 confirm 静默失效） */
  const batchRemove = async (): Promise<void> => {
    if (!(await confirmDialog(c.batchDeleteConfirm(selectedIds.size), c.batchDelete))) return;
    removePapers([...selectedIds]);
    setSelectedIds(new Set());
    if (expandedId && !papers.some((p) => p.id === expandedId)) setExpandedId(null);
  };

  /** 单条删除：应用内确认（同上） */
  const removeOne = async (paper: Paper): Promise<void> => {
    if (await confirmDialog(c.deleteConfirm(paper.citekey), c.deleteTitle)) removePaper(paper.id);
  };

  /** 全库导出 .bib：papersToBibtex 生成 + Blob 下载（反馈走 list 模式的 pdfMsg 状态行） */
  const exportLibraryBib = (): void => {
    if (papers.length === 0) {
      setPdfMsg(c.exportBibEmpty);
      return;
    }
    const blob = new Blob([papersToBibtex(papers)], { type: 'application/x-bibtex;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lemma-library-${stamp()}.bib`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setPdfMsg(c.exportBibDone(papers.length));
  };

  /**
   * RIS 导入：parseRis 解析后经 papersToBibtex → importBibtex 组合入库。
   * parseRis 产物的 citekey 可能为空串——先按 importBibtex 同款流程补 key
   * （generateCitekey + disambiguateCitekey，对库内既有 citekey 消歧），再转 BibTeX。
   */
  const importRis = (): void => {
    const parsed = parseRis(risText);
    const errors = [...parsed.errors];
    let added = 0;
    if (parsed.papers.length > 0) {
      const existing = new Set(papers.map((p) => p.citekey));
      const prepared = parsed.papers.map((p) => {
        if (p.citekey) return p;
        const key = disambiguateCitekey(generateCitekey(p), existing);
        existing.add(key);
        return { ...p, citekey: key };
      });
      const r = importBibtex(papersToBibtex(prepared));
      added = r.added;
      errors.push(...r.errors);
    }
    setRisResult(c.risImportSummary(added, errors.length));
    if (added > 0) setRisText('');
  };

  /**
   * Zotero JSON 导入：parseZoteroJson → 逐条查重（doi/arxivId/title 与库内及本批次
   * 比对，重复跳过计 dupes）→ importHit 入库（citekey 由 store 生成消歧）。
   * 集合归属无 schema 可存：以 `zotero:<集合名>`（含祖先链名称）追加进 tags，
   * 过滤器 tag: 前缀天然可用。
   */
  const importZotero = (): void => {
    const parsed = parseZoteroJson(zoteroText);
    let added = 0;
    let dupes = 0;
    // 查重键 = 库内既有条目 + 本批次已导入条目（importHit 连续 set 后闭包 papers 已过期）
    const seen = new Set(papers.map(paperIdentity));
    for (const zp of parsed.papers) {
      const identity = paperIdentity(zp);
      if (seen.has(identity)) {
        dupes += 1;
        continue;
      }
      seen.add(identity);
      const collectionTags = collectionNamesFor(zp.collectionKeys, parsed.collections).map(
        (name) => `${ZOTERO_TAG_PREFIX}${name}`,
      );
      importHit({
        // importHit 不读 source；PaperSearchHit.source 类型仅限 'arxiv' | 'crossref'
        source: 'crossref',
        title: zp.title,
        authors: zp.authors,
        year: zp.year,
        venue: zp.venue,
        abstract: zp.abstract,
        doi: zp.doi,
        arxivId: zp.arxivId,
        tags: [...new Set([...zp.tags, ...collectionTags])],
      });
      added += 1;
    }
    setZoteroResult(c.zoteroImportSummary(added, dupes, parsed.errors.length));
    if (added > 0) setZoteroText('');
  };

  /** PDF 目录选择（webkitdirectory multiple）：收集全部 .pdf → 逐个匹配 → 预览列表。 */
  const handlePdfDirPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? []).filter((f) => /\.pdf$/i.test(f.name));
    event.target.value = '';
    if (files.length === 0) {
      setPdfCandidates([]);
      setPdfDirMsg(c.pdfDirEmpty);
      return;
    }
    const candidates = files.map<PdfCandidate>((file) => ({
      file,
      path: file.webkitRelativePath || file.name,
      match: matchPdfToPaper(file.name, papers),
    }));
    setPdfCandidates(candidates);
    setPdfDirMsg(c.pdfDirCount(candidates.filter((cand) => cand.match !== null).length, candidates.length));
  };

  /** 「关联全部」：逐个读取 ArrayBuffer（readFileArrayBuffer）→ attachPdf 入库持久化。 */
  const attachAllPdfs = async (): Promise<void> => {
    setPdfAttaching(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const cand of pdfCandidates) {
        if (!cand.match) continue;
        try {
          const bytes = await readFileArrayBuffer(cand.file);
          if (attachPdf(cand.match.paperId, bytes)) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
    } finally {
      setPdfAttaching(false);
    }
    setPdfDirMsg(c.pdfAttachDone(ok, fail));
  };

  // —— Bib 清理向导 ——

  /** 打开向导：定位项目 .bib 并就地分析（无 .bib 时也开对话框，显示指引信息） */
  const openBibCleaner = (): void => {
    const files = useWorkspaceStore.getState().files;
    const path = findBibPath(files);
    setCleanBibPath(path);
    setCleanIssues(path ? analyzeBib(files[path] ?? '') : []);
    setCleanPreview(null);
    setCleanMsg(null);
    setCleanOpen(true);
  };

  /** 生成去重预览：applyBibFixes + 行级删行统计 + 前 3 组重复的 keys */
  const previewDedupe = (): void => {
    if (!cleanBibPath) return;
    const bibText = useWorkspaceStore.getState().files[cleanBibPath] ?? '';
    const { text, removed } = applyBibFixes(bibText, 'dedupe-keep-fuller');
    const stats = diffLineStats(bibText, text);
    setCleanPreview({
      text,
      removed,
      linesRemoved: stats.removed,
      groups: analyzeBib(bibText)
        .filter((i) => i.kind === 'duplicate')
        .slice(0, 3)
        .map((i) => i.keys),
    });
    setCleanMsg(null);
  };

  /** 确认写入：应用内 confirm → snapshotFile 先建快照 → updateFile 写回 .bib。
   *  文献库（libraryStore）不动——.bib 与库是两份数据，清理只作用于项目文件。 */
  const confirmDedupe = async (): Promise<void> => {
    if (!cleanBibPath || !cleanPreview) return;
    const ok = await confirmDialog(
      c.cleanConfirmDialog(cleanPreview.removed.length),
      c.cleanConfirm,
    );
    if (!ok) {
      setCleanMsg(c.cleanCancelled);
      return;
    }
    const ws = useWorkspaceStore.getState();
    ws.snapshotFile(cleanBibPath, `清理 Bib：自动去重（删 ${cleanPreview.removed.length} 条）`);
    ws.updateFile(cleanBibPath, cleanPreview.text);
    setCleanMsg(c.cleanDone(cleanBibPath, cleanPreview.removed.length));
    setCleanIssues(analyzeBib(cleanPreview.text)); // 列表刷新为写入后的分析结果
    setCleanPreview(null);
  };

  /** Zotero 同步区状态行：优先显示最近一次同步结果，否则按探测状态给出明确说明 */
  const zoteroStatusLine = zoteroSyncNote
    ? zoteroSyncNote
    : zoteroSyncState === 'probing' || zoteroSyncState === 'busy'
      ? c.zoteroStatusBusy
      : zoteroSyncState === 'ok'
        ? c.zoteroStatusOk
        : c.zoteroStatusOff;

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
          {/* v7.6.0 工具栏重构：搜索框独占一行 + [筛选 | 导入文献] 一行，低频入口收进导入对话框 */}
          <div className="sf-lib-toolbar sf-lib-toolbar--stack">
            <input
              className="sf-input sf-lib-filter"
              placeholder={c.filterPlaceholder}
              title={c.filterSyntaxHint}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="sf-lib-toolbar-row">
              {/* 智能筛选（v3.4.0 B）：最近添加 / 被引用 / 未读 */}
              <select
                className="sf-input"
                value={smartFilter}
                onChange={(e) => setSmartFilter(e.target.value as typeof smartFilter)}
              >
                <option value="all">{language === 'zh' ? '全部文献' : 'All papers'}</option>
                <option value="recent">{language === 'zh' ? '最近添加' : 'Recently added'}</option>
                <option value="cited">{language === 'zh' ? '被稿件引用' : 'Cited in ms'}</option>
                <option value="unread">{language === 'zh' ? '未读' : 'Unread'}</option>
              </select>
              <button
                className="sf-btn sf-btn--primary sf-lib-import-btn"
                onClick={() => setImportOpen(true)}
              >
                <Plus size={13} /> {c.importButton}
              </button>
            </div>
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
              <button className="sf-btn sf-lib-batch-delete" onClick={() => void batchRemove()}>
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
                      {citedCountMap.get(p.citekey) !== undefined && (
                        <span
                          className="sf-chip dim"
                          style={{ fontSize: 9.5, flex: 'none', padding: '0 5px' }}
                          title={`在稿件中被引用 ${citedCountMap.get(p.citekey)} 次`}
                        >
                          ×{citedCountMap.get(p.citekey)}
                        </span>
                      )}
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
                      onClick={() => void removeOne(p)}
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

      {/* v7.6.0「导入文献」对话框：四分组（粘贴导入 / 在线获取 / 批量关联 / 导出与维护）。
          各分组按钮仅负责打开既有对话框 / 触发既有逻辑（本对话框随即关闭），导入逻辑零改动。 */}
      {importOpen && (
        <div className="sf-dialog-overlay" onMouseDown={() => setImportOpen(false)}>
          <div className="sf-dialog sf-lib-dialog sf-lib-import" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.importTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              <section className="sf-lib-import-sec">
                <h4>{c.secPaste}</h4>
                <p className="sf-lib-import-desc">{c.secPasteDesc}</p>
                <div className="sf-lib-import-actions">
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      setDialog('bibtex');
                    }}
                  >
                    BibTeX
                  </button>
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      setRisOpen(true);
                    }}
                  >
                    RIS
                  </button>
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      setZoteroResult(null);
                      setZoteroOpen(true);
                    }}
                  >
                    {c.zoteroButton}
                  </button>
                </div>
              </section>
              <section className="sf-lib-import-sec">
                <h4>{c.secOnline}</h4>
                <p className="sf-lib-import-desc">{c.secOnlineDesc}</p>
                <div className="sf-lib-import-actions">
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      setDialog('fetch');
                    }}
                  >
                    {c.fetchEntry}
                  </button>
                </div>
              </section>
              <section className="sf-lib-import-sec">
                <h4>{c.secBulk}</h4>
                <p className="sf-lib-import-desc">{c.secBulkDesc}</p>
                <div className="sf-lib-import-actions">
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      setPdfCandidates([]);
                      setPdfDirMsg(null);
                      setPdfDirOpen(true);
                    }}
                  >
                    {c.pdfDirButton}
                  </button>
                  {/* Zotero 同步：状态就地显示在本分组（探测/结果说明见 zoteroStatusLine） */}
                  <button
                    className="sf-btn"
                    title={c.zoteroSyncTitle}
                    disabled={zoteroSyncState === 'busy' || zoteroSyncState === 'probing'}
                    onClick={() => void runZoteroSync()}
                  >
                    <RefreshCw size={12} style={{ verticalAlign: -1 }} /> {c.zoteroSyncButton}
                  </button>
                </div>
                <p
                  className={
                    zoteroSyncState === 'ok'
                      ? 'sf-lib-import-status sf-lib-import-status--ok'
                      : 'sf-lib-import-status'
                  }
                >
                  {zoteroStatusLine}
                </p>
              </section>
              <section className="sf-lib-import-sec">
                <h4>{c.secMaintain}</h4>
                <p className="sf-lib-import-desc">{c.secMaintainDesc}</p>
                <div className="sf-lib-import-actions">
                  <button
                    className="sf-btn"
                    onClick={() => {
                      setImportOpen(false);
                      openBibCleaner();
                    }}
                  >
                    {c.cleanButton}
                  </button>
                  {/* 导出反馈走列表模式的状态行（pdfMsg），先关对话框再导出才能看到结果 */}
                  <button
                    className="sf-btn sf-export-bib"
                    onClick={() => {
                      setImportOpen(false);
                      exportLibraryBib();
                    }}
                    disabled={papers.length === 0}
                    title={c.exportBib}
                  >
                    <Download size={13} /> {c.exportBib}
                  </button>
                </div>
              </section>
            </div>
          </div>
        </div>
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

      {risOpen && (
        <div className="sf-dialog-overlay" onMouseDown={() => setRisOpen(false)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.risTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              <textarea
                className="sf-input sf-lib-textarea"
                placeholder={c.risPlaceholder}
                value={risText}
                onChange={(e) => setRisText(e.target.value)}
              />
              {risResult && <p className="sf-cites-msg">{risResult}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setRisOpen(false)}>
                  {c.dialogClose}
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={importRis}
                  disabled={!risText.trim()}
                >
                  {c.dialogImport}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {zoteroOpen && (
        <div className="sf-dialog-overlay" onMouseDown={() => setZoteroOpen(false)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.zoteroTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              <textarea
                className="sf-input sf-lib-textarea"
                placeholder={c.zoteroPlaceholder}
                value={zoteroText}
                onChange={(e) => setZoteroText(e.target.value)}
              />
              {zoteroResult && <p className="sf-cites-msg">{zoteroResult}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setZoteroOpen(false)}>
                  {c.dialogClose}
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={importZotero}
                  disabled={!zoteroText.trim()}
                >
                  {c.dialogImport}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pdfDirOpen && (
        <div className="sf-dialog-overlay" onMouseDown={() => setPdfDirOpen(false)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.pdfDirTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              <p className="sf-lib-count">{c.pdfDirHint}</p>
              <input
                ref={(el) => {
                  pdfDirInputRef.current = el;
                }}
                type="file"
                multiple
                accept="application/pdf"
                style={{ display: 'none' }}
                onChange={handlePdfDirPick}
                {...({ webkitdirectory: '', directory: '' } as InputHTMLAttributes<HTMLInputElement>)}
              />
              {pdfDirMsg && <p className="sf-cites-msg">{pdfDirMsg}</p>}
              <div className="sf-lib-dialog-actions">
                <button className="sf-btn" onClick={() => setPdfDirOpen(false)}>
                  {c.dialogClose}
                </button>
                <button className="sf-btn" onClick={() => pdfDirInputRef.current?.click()}>
                  {c.pdfDirPick}
                </button>
                <button
                  className="sf-btn sf-btn--primary"
                  onClick={() => void attachAllPdfs()}
                  disabled={pdfAttaching || pdfCandidates.every((cand) => cand.match === null)}
                >
                  {pdfAttaching ? c.pdfAttaching : c.pdfAttachAll}
                </button>
              </div>
              {pdfCandidates.length > 0 && (
                <ul className="sf-lib-results sf-lib-pdfdir">
                  {pdfCandidates.map((cand, index) => {
                    const paper = cand.match
                      ? papers.find((p) => p.id === cand.match!.paperId)
                      : undefined;
                    return (
                      <li key={`${index}:${cand.path}`} className="sf-lib-chunk">
                        <div className="sf-lib-chunk-head">
                          <code>{cand.path}</code>
                        </div>
                        {cand.match && paper ? (
                          <p className="sf-lib-pdfdir-match">
                            <span className="sf-lib-hit-title">{paper.title}</span>
                            <span className="sf-lib-score">{c.pdfConfidence(cand.match.score)}</span>
                          </p>
                        ) : (
                          <p className="sf-lib-pdfdir-match placeholder">{c.pdfNoMatch}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {cleanOpen && (
        <div className="sf-dialog-overlay" onMouseDown={() => setCleanOpen(false)}>
          <div className="sf-dialog sf-lib-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <header className="sf-dialog-header">
              <strong>{c.cleanTitle}</strong>
            </header>
            <div className="sf-dialog-body">
              {cleanBibPath ? (
                <>
                  <p className="sf-lib-count">{c.cleanTarget(cleanBibPath)}</p>
                  {cleanIssues.length === 0 && <p className="placeholder">{c.cleanNoIssues}</p>}
                  {cleanIssues.some((i) => i.severity === 'error') && (
                    <section>
                      <p className="sf-lib-count">
                        {c.cleanErrors(cleanIssues.filter((i) => i.severity === 'error').length)}
                      </p>
                      <ul className="sf-lib-results sf-lib-clean-list">
                        {cleanIssues
                          .filter((i) => i.severity === 'error')
                          .map((issue, idx) => (
                            <BibIssueItem key={`e${idx}`} issue={issue} copy={c} />
                          ))}
                      </ul>
                    </section>
                  )}
                  {cleanIssues.some((i) => i.severity === 'warning') && (
                    <section>
                      <p className="sf-lib-count">
                        {c.cleanWarnings(cleanIssues.filter((i) => i.severity === 'warning').length)}
                      </p>
                      <ul className="sf-lib-results sf-lib-clean-list">
                        {cleanIssues
                          .filter((i) => i.severity === 'warning')
                          .map((issue, idx) => (
                            <BibIssueItem key={`w${idx}`} issue={issue} copy={c} />
                          ))}
                      </ul>
                    </section>
                  )}
                  {cleanPreview ? (
                    <div className="sf-lib-batch" role="toolbar">
                      <div>
                        <span className="sf-lib-batch-count">
                          {c.cleanPreviewStats(cleanPreview.removed.length, cleanPreview.linesRemoved)}
                        </span>
                        <p className="sf-lib-hit-meta">
                          {c.cleanPreviewGroups}{' '}
                          {cleanPreview.groups.map((keys) => keys.join(' / ')).join('；')}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  {cleanMsg && <p className="sf-cites-msg">{cleanMsg}</p>}
                  <div className="sf-lib-dialog-actions">
                    <button className="sf-btn" onClick={() => setCleanOpen(false)}>
                      {c.dialogClose}
                    </button>
                    {cleanPreview ? (
                      <button
                        className="sf-btn sf-btn--primary"
                        onClick={() => void confirmDedupe()}
                      >
                        {c.cleanConfirm}
                      </button>
                    ) : (
                      <button
                        className="sf-btn sf-btn--primary"
                        onClick={previewDedupe}
                        disabled={!cleanIssues.some((i) => i.kind === 'duplicate')}
                      >
                        {c.cleanDedupe}
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="placeholder">{c.cleanNoBib}</p>
                  <div className="sf-lib-dialog-actions">
                    <button className="sf-btn" onClick={() => setCleanOpen(false)}>
                      {c.dialogClose}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bib 清理向导：单条 issue 展示（keys / message / suggestion）
// ---------------------------------------------------------------------------

function BibIssueItem({ issue, copy }: { issue: BibIssue; copy: Copy }) {
  return (
    <li className="sf-lib-chunk">
      <div className="sf-lib-chunk-head">
        {issue.keys.map((key) => (
          <code key={key}>{key}</code>
        ))}
      </div>
      <p className="sf-lib-hit-title">{issue.message}</p>
      {issue.suggestion && (
        <p className="sf-lib-hit-meta">
          {copy.cleanSuggestionLabel}
          {issue.suggestion}
        </p>
      )}
    </li>
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
