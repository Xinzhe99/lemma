/**
 * 真实审稿意见导入对话框（命令 reviews.import）：
 * - 三合一输入：粘贴文本（默认）/ 拖入·选择文件（.txt/.md 直读、.docx 走最小
 *   提取器、.pdf 走 library 的 loadPdfText 拼接分页文本）；多文件依次解析合并，
 *   文件名含 reviewer 数字时用于分段命名；
 * - 解析后预览：按审稿人分栏卡片，逐条就地编辑 / 删除 / 手动加条，
 *   头部显示「N 位审稿人 · M 条意见」；
 * - 「保存为笔记」写入 notesStore；（v7.9.6：W7 启动按钮随工作流功能下线移除）
 * - zh/en 字典；不新增 CSS（sf-dialog 家族 + 内联样式）。
 */

import { useEffect, useRef, useState } from 'react';
import { loadPdfText } from '@lemma/library/reader';
import {
  extractDocxText,
  parseReviewsFiles,
  parseReviewsText,
  reviewsToWorkflowInput,
  type ParsedReview,
  type ReviewItem,
  type ReviewItemType,
} from '../reviewsImport';
import { useSettingsStore } from '../state/settingsStore';
import { useNotesStore } from '../state/notesStore';

const STRINGS = {
  zh: {
    title: '导入审稿意见',
    tabPaste: '粘贴文本',
    tabFile: '文件导入',
    pasteLabel: '审稿意见原文（任意格式：Reviewer 分栏 / 编号 / 中英混排均可）',
    pastePlaceholder: '把审稿意见全文粘贴到这里…（支持 Reviewer 1 / 审稿人1 / R1: 等分栏）',
    parse: '解析预览',
    dropHint: '拖入 .txt / .md / .docx / .pdf（可多选，一人一文件时文件名含 reviewer 数字用于命名）',
    chooseFiles: '选择文件',
    parsing: '解析中…',
    unsupported: '不支持的格式（仅 .txt / .md / .docx / .pdf）',
    noItems: '未识别到审稿意见条目，请检查内容或手动在预览区添加',
    previewLabel: '拆条预览',
    summaryReviewers: '位审稿人',
    summaryItems: '条意见',
    addItem: '+ 添加一条',
    deleteItem: '删除',
    typeWeakness: '缺点',
    typeQuestion: '问题',
    typeComment: '意见',
    typeMinor: '小修',
    saveNote: '仅保存为笔记',
    noteSaved: '已保存到笔记',
    close: '关闭',
  },
  en: {
    title: 'Import reviews',
    tabPaste: 'Paste text',
    tabFile: 'Import files',
    pasteLabel: 'Raw review text (any layout: reviewer sections / numbering / mixed languages)',
    pastePlaceholder: 'Paste the full reviews here… (Reviewer 1 / 审稿人1 / R1: sections all work)',
    parse: 'Parse & preview',
    dropHint: 'Drop .txt / .md / .docx / .pdf (multi-select; a filename containing a reviewer number names that reviewer)',
    chooseFiles: 'Choose files',
    parsing: 'Parsing…',
    unsupported: 'Unsupported format (.txt / .md / .docx / .pdf only)',
    noItems: 'No review items recognized; check the content or add items manually',
    previewLabel: 'Parsed preview',
    summaryReviewers: 'reviewers',
    summaryItems: 'items',
    addItem: '+ Add item',
    deleteItem: 'Delete',
    typeWeakness: 'Weakness',
    typeQuestion: 'Question',
    typeComment: 'Comment',
    typeMinor: 'Minor',
    saveNote: 'Save as note only',
    noteSaved: 'Saved to notes',
    close: 'Close',
  },
} as const;

type Language = keyof typeof STRINGS;

function typeLabel(L: (typeof STRINGS)[Language], type?: ReviewItemType): string {
  switch (type) {
    case 'weakness':
      return L.typeWeakness;
    case 'question':
      return L.typeQuestion;
    case 'minor':
      return L.typeMinor;
    default:
      return L.typeComment;
  }
}

/** 审稿人名末尾的编号（"Reviewer 2" → 2；无数字回落 1） */
function reviewerNumber(name: string): number {
  const m = /(\d+)\s*$/.exec(name.trim());
  return m ? Number(m[1]) : 1;
}

export function ReviewsImportDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language) === 'en' ? 'en' : 'zh';
  const L = STRINGS[language];

  const [tab, setTab] = useState<'paste' | 'file'>('paste');
  const [pasteText, setPasteText] = useState('');
  const [reviews, setReviews] = useState<ParsedReview[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [noteSaved, setNoteSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const totalItems = reviews.reduce((n, r) => n + r.items.length, 0);

  const handleParsePaste = (): void => {
    const parsed = parseReviewsText(pasteText);
    setReviews(parsed);
    setNoteSaved(false);
    setError(parsed.length === 0 ? L.noItems : '');
  };

  const readFileText = async (file: File): Promise<string> => {
    const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
    if (ext === 'pdf') {
      const result = await loadPdfText(await file.arrayBuffer());
      return result.pages.map((p) => p.text).join('\n\n');
    }
    if (ext === 'docx') return extractDocxText(await file.arrayBuffer());
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
      return new TextDecoder('utf-8').decode(await file.arrayBuffer());
    }
    throw new Error(L.unsupported);
  };

  const handleFiles = async (list: FileList | File[]): Promise<void> => {
    const files = Array.from(list);
    if (files.length === 0) return;
    setBusy(true);
    setError('');
    try {
      const parsed: Array<{ name: string; text: string }> = [];
      const errors: string[] = [];
      for (const file of files) {
        try {
          parsed.push({ name: file.name, text: await readFileText(file) });
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e);
          errors.push(`${file.name}：${reason}`);
        }
      }
      if (parsed.length > 0) {
        setReviews(parseReviewsFiles(parsed));
        setNoteSaved(false);
      }
      setError(errors.length > 0 ? errors.join('\n') : '');
    } finally {
      setBusy(false);
    }
  };

  const updateItem = (ri: number, ii: number, text: string): void => {
    setReviews((prev) =>
      prev.map((r, i) =>
        i !== ri ? r : { ...r, items: r.items.map((it, j) => (j !== ii ? it : { ...it, text })) },
      ),
    );
  };

  const deleteItem = (ri: number, ii: number): void => {
    setReviews((prev) =>
      prev.map((r, i) => (i !== ri ? r : { ...r, items: r.items.filter((_, j) => j !== ii) })),
    );
  };

  const addItem = (ri: number): void => {
    setReviews((prev) =>
      prev.map((r, i) => {
        if (i !== ri) return r;
        const num = reviewerNumber(r.reviewer);
        const used = new Set(r.items.map((it) => it.id));
        let seq = r.items.length + 1;
        while (used.has(`R${num}.${seq}`)) seq++;
        const item: ReviewItem = { id: `R${num}.${seq}`, text: '', type: 'comment' };
        return { ...r, items: [...r.items, item] };
      }),
    );
  };

  const handleSaveNote = (): void => {
    if (totalItems === 0) return;
    const date = new Date().toISOString().slice(0, 10);
    useNotesStore.getState().addNote({
      title: `${language === 'en' ? 'Reviews' : '审稿意见'} ${date}`,
      bodyMd: reviewsToWorkflowInput(reviews),
    });
    setNoteSaved(true);
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog"
        style={{ width: 780, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
        </header>
        <nav className="sf-dialog-tabs">
          <button
            type="button"
            className={tab === 'paste' ? 'active' : undefined}
            onClick={() => setTab('paste')}
          >
            {L.tabPaste}
          </button>
          <button
            type="button"
            className={tab === 'file' ? 'active' : undefined}
            onClick={() => setTab('file')}
          >
            {L.tabFile}
          </button>
        </nav>
        <div className="sf-dialog-body">
          {tab === 'paste' ? (
            <div className="sf-reviews-paste" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <textarea
                className="sf-input"
                aria-label={L.pasteLabel}
                placeholder={L.pastePlaceholder}
                rows={10}
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
              />
              <div>
                <button
                  className="sf-btn"
                  onClick={handleParsePaste}
                  disabled={!pasteText.trim() || busy}
                >
                  {L.parse}
                </button>
              </div>
            </div>
          ) : (
            <div
              className="sf-reviews-drop"
              role="region"
              aria-label={L.tabFile}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fs = e.dataTransfer?.files;
                if (fs && fs.length > 0) void handleFiles(fs);
              }}
              style={{
                border: '1px dashed var(--border-strong)',
                borderRadius: 8,
                padding: 20,
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>{L.dropHint}</span>
              <button className="sf-btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                {L.chooseFiles}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".txt,.md,.docx,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const fs = e.target.files;
                  if (fs && fs.length > 0) void handleFiles(fs);
                  e.target.value = ''; // 同一批文件可重复选择
                }}
              />
              {busy && (
                <span role="status" style={{ color: 'var(--fg-2)' }}>
                  {L.parsing}
                </span>
              )}
            </div>
          )}

          {error && (
            <p role="alert" style={{ whiteSpace: 'pre-line', color: 'var(--danger, #c0392b)', margin: '8px 0 0' }}>
              {error}
            </p>
          )}

          {reviews.length > 0 && (
            <section
              aria-label={L.previewLabel}
              style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div className="sf-reviews-summary" style={{ fontWeight: 600 }}>
                {reviews.length} {L.summaryReviewers} · {totalItems} {L.summaryItems}
              </div>
              {reviews.map((review, ri) => (
                <div
                  key={`${review.reviewer}-${ri}`}
                  className="sf-reviews-card"
                  style={{
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '8px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <header
                    className="sf-reviews-card-header"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <strong>{review.reviewer}</strong>
                    <button className="sf-btn" onClick={() => addItem(ri)}>
                      {L.addItem}
                    </button>
                  </header>
                  {review.items.map((it, ii) => (
                    <div
                      key={`${it.id}-${ii}`}
                      className="sf-reviews-item"
                      style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}
                    >
                      <span
                        className="sf-reviews-item-id"
                        style={{ minWidth: 40, paddingTop: 6, color: 'var(--fg-2)', fontSize: 12 }}
                      >
                        {it.id}
                      </span>
                      <span
                        className="sf-reviews-item-type"
                        style={{ paddingTop: 6, fontSize: 12, color: 'var(--fg-2)' }}
                      >
                        [{typeLabel(L, it.type)}]
                      </span>
                      <textarea
                        className="sf-input"
                        aria-label={it.id}
                        rows={2}
                        value={it.text}
                        onChange={(e) => updateItem(ri, ii, e.target.value)}
                        style={{ flex: 1, resize: 'vertical', fontFamily: 'inherit' }}
                      />
                      <button
                        className="sf-btn"
                        aria-label={`${L.deleteItem} ${it.id}`}
                        title={`${L.deleteItem} ${it.id}`}
                        onClick={() => deleteItem(ri, ii)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </section>
          )}

          <div
            className="sf-lib-dialog-actions"
            style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}
          >
            {noteSaved && (
              <span role="status" style={{ marginRight: 'auto', color: 'var(--fg-2)', fontSize: 12 }}>
                {L.noteSaved}
              </span>
            )}
            <button className="sf-btn" onClick={onClose}>
              {L.close}
            </button>
            <button className="sf-btn primary" disabled={totalItems === 0 || busy} onClick={handleSaveNote}>
              {L.saveNote}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
