/**
 * 可视化表格编辑器对话框（Overleaf 级标配）：input 网格编辑 → 实时生成 LaTeX tabular 代码
 * → 插入编辑器光标处（editorInsert 桥，失败保持打开并提示）或复制到剪贴板。
 * 另支持 CSV/Excel 导入：「导入 CSV/Excel」按钮 + 隐藏 file input（.csv/.tsv/.txt/.xlsx，
 * 按扩展名分流 parseCsv / parseXlsx）→ 确认预览（N 行 × M 列摘要 + 前 5 行 + 「首行为表头」
 * 开关）→「替换网格」载入 rows、按数据列数生成 |c|c|…| 列规格并联动既有表头开关；
 * 解析错误走 role=alert 中文提示。
 * 模态结构复用 sf-dialog/sf-dialog-overlay/sf-dialog-header/sf-dialog-body；
 * 新增样式位使用 sf-table-* 语义类名（不新增 CSS，由既有 token/类承载基础外观）。
 */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { gridToTabular, parseCsv, parseXlsx } from '@scholarforge/editor';
import { useSettingsStore } from '../state/settingsStore';
import { insertAtCursor } from '../editorInsert';

const INITIAL_ROWS = 3;
const INITIAL_COLS = 3;
const COPIED_MS = 2000;
const IMPORT_PREVIEW_ROWS = 5;

const STRINGS = {
  zh: {
    title: '表格编辑器',
    addRow: '加行',
    delRow: '删行',
    addCol: '加列',
    delCol: '删列',
    importCsv: '导入 CSV/Excel',
    importTitle: '从 CSV/TSV/TXT 或 XLSX 文件导入表格数据',
    importEmpty: '未从该文件解析到任何表格数据',
    importReadFailed: '读取文件失败，请重试',
    importSummary: '解析自 {file}：共 {rows} 行 × {cols} 列（预览前 5 行）',
    firstRowHeader: '首行为表头',
    replaceGrid: '替换网格',
    cancelImport: '取消导入',
    colspec: '列规格',
    colspecTitle: 'tabular 列规格，如 |c|c|c| 或 lcc',
    headerRow: '首行为表头（首行数据后插入 \\hline）',
    col: '列',
    preview: 'LaTeX 预览',
    insert: '插入到光标处',
    insertTitle: '插入到当前打开文件的编辑器光标处',
    copy: '复制代码',
    copied: '已复制',
    cancel: '取消',
    noEditor: '未找到可用的编辑器：请先打开一个 .tex 文件再插入',
    copyFailed: '复制失败，请手动从预览区选择代码复制',
  },
  en: {
    title: 'Table editor',
    addRow: 'Add row',
    delRow: 'Delete row',
    addCol: 'Add column',
    delCol: 'Delete column',
    importCsv: 'Import CSV/Excel',
    importTitle: 'Import table data from a CSV/TSV/TXT or XLSX file',
    importEmpty: 'No table data was parsed from this file',
    importReadFailed: 'Failed to read the file, please retry',
    importSummary: 'Parsed from {file}: {rows} rows × {cols} cols (first 5 shown)',
    firstRowHeader: 'First row is a header',
    replaceGrid: 'Replace grid',
    cancelImport: 'Cancel import',
    colspec: 'Column spec',
    colspecTitle: 'tabular column spec, e.g. |c|c|c| or lcc',
    headerRow: 'First row is a header (insert \\hline after it)',
    col: 'Col',
    preview: 'LaTeX preview',
    insert: 'Insert at cursor',
    insertTitle: 'Insert into the open file at the editor cursor',
    copy: 'Copy code',
    copied: 'Copied',
    cancel: 'Cancel',
    noEditor: 'No active editor found: open a .tex file before inserting',
    copyFailed: 'Copy failed — please select the code in the preview manually',
  },
} as const;

/** 导入确认预览态：解析出的网格 + 来源文件名 + 「首行为表头」开关（替换网格时联动 hasHeader） */
interface ImportPreview {
  rows: string[][];
  fileName: string;
  firstRowHeader: boolean;
}

/** 组装预览代码：gridToTabular 产物 + 表头开关语义由调用方处理（首行数据后补一条 \hline） */
function buildPreview(colspec: string, rows: string[][], hasHeader: boolean): string {
  const base = gridToTabular(colspec, rows);
  if (!hasHeader || rows.length < 2) return base;
  const lines = base.split('\n');
  // 结构：[\begin{tabular}{…}, \hline, 首行, …, \hline, \end{tabular}] → 在首行后插入
  lines.splice(3, 0, '\\hline');
  return lines.join('\n');
}

/** 剪贴板写入：优先 async Clipboard API，失败回退隐藏 textarea + execCommand */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function TableEditor({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];

  const [colspec, setColspec] = useState('|c|c|c|');
  const [hasHeader, setHasHeader] = useState(false);
  const [rows, setRows] = useState<string[][]>(() =>
    Array.from({ length: INITIAL_ROWS }, () => Array.from({ length: INITIAL_COLS }, () => '')),
  );
  const [hint, setHint] = useState('');
  const [copied, setCopied] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const code = useMemo(() => buildPreview(colspec, rows, hasHeader), [colspec, rows, hasHeader]);
  const cols = rows[0]?.length ?? 0;

  const setCell = (r: number, c: number, v: string) =>
    setRows((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? v : cell)) : row)));
  const addRow = () => setRows((prev) => [...prev, Array.from({ length: cols }, () => '')]);
  const delRow = () => setRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  const addCol = () => setRows((prev) => prev.map((row) => [...row, '']));
  const delCol = () => setRows((prev) => (cols > 1 ? prev.map((row) => row.slice(0, -1)) : prev));

  /** 文件选择：按扩展名分流（.xlsx → parseXlsx；csv/tsv/txt → parseCsv 文本读）→ 确认预览 */
  const onImportFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = ''; // 复位选择器：同一文件可重复选择
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const parsed = /\.xlsx$/i.test(file.name)
        ? parseXlsx(buf)
        : parseCsv(new TextDecoder('utf-8').decode(buf));
      if (parsed.length === 0 || parsed[0]!.length === 0) {
        setImportPreview(null);
        setHint(L.importEmpty);
        return;
      }
      setHint('');
      // 「首行为表头」初值联动既有表头开关
      setImportPreview({ rows: parsed, fileName: file.name, firstRowHeader: hasHeader });
    } catch (err) {
      setImportPreview(null);
      setHint(err instanceof Error ? err.message : L.importReadFailed);
    }
  };

  /** 确认导入：载入 rows、按数据列数生成 |c|c|…| 列规格、表头开关联动 */
  const applyImport = () => {
    if (!importPreview) return;
    const dataCols = importPreview.rows.reduce((m, r) => Math.max(m, r.length), 0);
    setRows(importPreview.rows);
    setColspec('|' + 'c|'.repeat(dataCols));
    setHasHeader(importPreview.firstRowHeader);
    setImportPreview(null);
    setHint('');
  };

  const insert = () => {
    if (insertAtCursor(code)) {
      onClose();
      return;
    }
    setHint(L.noEditor); // 插入失败：保持打开并提示
  };

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setHint('');
      window.setTimeout(() => setCopied(false), COPIED_MS);
    } else {
      setHint(L.copyFailed);
    }
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog sf-table-dialog"
        role="dialog"
        aria-label={L.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <div className="sf-dialog-body">
          <div className="sf-table-toolbar">
            <button className="sf-btn" onClick={addRow}>
              {L.addRow}
            </button>
            <button className="sf-btn" onClick={delRow} disabled={rows.length <= 1}>
              {L.delRow}
            </button>
            <button className="sf-btn" onClick={addCol}>
              {L.addCol}
            </button>
            <button className="sf-btn" onClick={delCol} disabled={cols <= 1}>
              {L.delCol}
            </button>
            <button className="sf-btn sf-table-import-btn" title={L.importTitle} onClick={() => fileInputRef.current?.click()}>
              {L.importCsv}
            </button>
            {/* 隐藏文件选择器：按扩展名分流 CSV/TSV/TXT 与 XLSX */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx"
              hidden
              onChange={(e) => void onImportFile(e)}
            />
            <label className="sf-table-header-toggle" title={L.headerRow}>
              <input
                type="checkbox"
                checked={hasHeader}
                onChange={(e) => setHasHeader(e.target.checked)}
              />
              {L.headerRow}
            </label>
          </div>

          <label className="sf-table-colspec-row">
            <span className="sf-table-colspec-label">{L.colspec}</span>
            <input
              className="sf-table-colspec"
              value={colspec}
              title={L.colspecTitle}
              onChange={(e) => setColspec(e.target.value)}
            />
          </label>

          <div className="sf-table-grid-wrap">
            <table className="sf-table-grid">
              <thead>
                <tr>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c}>{`${L.col} ${c + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((cell, c) => (
                      <td key={c}>
                        <input
                          className="sf-table-cell"
                          value={cell}
                          aria-label={`r${r + 1}c${c + 1}`}
                          onChange={(e) => setCell(r, c, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {importPreview && (
            <div className="sf-table-import" role="region" aria-label={L.importCsv}>
              <div className="sf-table-import-summary">
                {L.importSummary.replace('{file}', importPreview.fileName)
                  .replace('{rows}', String(importPreview.rows.length))
                  .replace('{cols}', String(importPreview.rows.reduce((m, r) => Math.max(m, r.length), 0)))}
              </div>
              <div className="sf-table-grid-wrap">
                <table className="sf-table-grid sf-table-import-grid">
                  <tbody>
                    {importPreview.rows.slice(0, IMPORT_PREVIEW_ROWS).map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="sf-table-toolbar">
                <label className="sf-table-header-toggle" title={L.headerRow}>
                  <input
                    type="checkbox"
                    checked={importPreview.firstRowHeader}
                    onChange={(e) =>
                      setImportPreview((p) => (p ? { ...p, firstRowHeader: e.target.checked } : p))
                    }
                  />
                  {L.firstRowHeader}
                </label>
                <button className="sf-btn sf-table-import-apply" onClick={applyImport}>
                  {L.replaceGrid}
                </button>
                <button className="sf-btn" onClick={() => setImportPreview(null)}>
                  {L.cancelImport}
                </button>
              </div>
            </div>
          )}

          {hint && (
            <p className="sf-table-hint" role="alert">
              {hint}
            </p>
          )}

          <div className="sf-table-preview-label">{L.preview}</div>
          <pre className="sf-table-preview">{code}</pre>

          <div className="sf-table-actions">
            <button className="sf-btn sf-table-insert" title={L.insertTitle} onClick={insert}>
              {L.insert}
            </button>
            <button className="sf-btn" onClick={() => void copy()}>
              {copied ? L.copied : L.copy}
            </button>
            <button className="sf-btn" onClick={onClose}>
              {L.cancel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
