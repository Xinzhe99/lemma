/**
 * 可视化表格编辑器对话框（Overleaf 级标配）：input 网格编辑 → 实时生成 LaTeX tabular 代码
 * → 插入编辑器光标处（editorInsert 桥，失败保持打开并提示）或复制到剪贴板。
 * 模态结构复用 sf-dialog/sf-dialog-overlay/sf-dialog-header/sf-dialog-body；
 * 新增样式位使用 sf-table-* 语义类名（不新增 CSS，由既有 token/类承载基础外观）。
 */

import { useEffect, useMemo, useState } from 'react';
import { gridToTabular } from '@scholarforge/editor';
import { useSettingsStore } from '../state/settingsStore';
import { insertAtCursor } from '../editorInsert';

const INITIAL_ROWS = 3;
const INITIAL_COLS = 3;
const COPIED_MS = 2000;

const STRINGS = {
  zh: {
    title: '表格编辑器',
    addRow: '加行',
    delRow: '删行',
    addCol: '加列',
    delCol: '删列',
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
