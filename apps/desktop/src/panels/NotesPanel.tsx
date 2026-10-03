/**
 * 卡片笔记面板（设计 4.7 知识底座）：双链卡片 CRUD、PDF 标注转卡片、反向链接、卡片入稿。
 * 壳层契约：export function NotesPanel()，无 props（LazyPanel 动态发现）。
 * 文案自包含 zh/en 双语；样式见 ./knowledge.css（不动全局 styles.css）。
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Copy,
  CopyPlus,
  FileCode2,
  FileDown,
  Link2,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { Annotation, Note, Paper } from '@lemma/shared';
import { annotationsToMarkdown } from '@lemma/library';
import { buildBacklinkIndex, type PaperRef } from '@lemma/knowledge';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useNotesStore } from '../state/notesStore';
import { useAnnotationStore } from '../state/annotationStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { jumpTo } from '../editorJump';
import { buildReviewPackage } from '../reviewPackage';
import { downloadAnnotationReport } from '../components/AnnotationReport';
import './knowledge.css';

// ---------------------------------------------------------------------------
// 双语文案
// ---------------------------------------------------------------------------

interface Dict {
  newCard: string;
  titlePh: string;
  bodyPh: string;
  wikilinkHint: string;
  create: string;
  annotations: string;
  noAnnotations: string;
  toCard: string;
  converted: string;
  page: string;
  fromPdf: string;
  cards: string;
  noCards: string;
  backlinks: string;
  noBacklinks: string;
  copyMd: string;
  insertTex: string;
  edit: string;
  save: string;
  cancel: string;
  del: string;
  missingTarget: string;
  copied: string;
  copyFailed: string;
  noTexFile: string;
  exportMd: string;
  exportedMd: (n: number) => string;
  exportHtmlReport: string;
  exportedHtmlReport: (n: number) => string;
  convertAll: string;
  convertAllDone: (n: number) => string;
  inserted: (file: string) => string;
  convertedMsg: (title: string) => string;
  createdMsg: (title: string) => string;
  deletedMsg: string;
}

const DICT: Record<Language, Dict> = {
  zh: {
    newCard: '新建卡片',
    titlePh: '卡片标题…',
    bodyPh: '正文（Markdown，可用 [[目标|别名]] 建立双链）…',
    wikilinkHint: '[[双链]] 会生成可点 chip，反向链接自动汇总',
    create: '创建卡片',
    annotations: 'PDF 标注',
    noAnnotations: '暂无标注。在阅读器中打开 PDF 高亮或批注后，可在此一键转卡片。',
    toCard: '转卡片',
    converted: '已转卡片',
    page: '页',
    fromPdf: '来自标注',
    cards: '卡片',
    noCards: '还没有卡片。用上方表单新建，或把 PDF 标注转为卡片。',
    backlinks: '反向链接',
    noBacklinks: '暂无反向链接',
    copyMd: '复制 Markdown',
    insertTex: '插入 .tex 末尾',
    edit: '编辑',
    save: '保存',
    cancel: '取消',
    del: '删除',
    missingTarget: '未找到同名卡片（新建一张同名卡片即可链接）',
    copied: '已复制到剪贴板',
    copyFailed: '复制失败',
    noTexFile: '项目中没有 .tex 文件，无法插入',
    exportMd: '导出全部标注 .md',
    exportedMd: (n) => `已导出 ${n} 条标注为 .md`,
    exportHtmlReport: '导出标注报告',
    exportedHtmlReport: (n) => `已导出标注报告（${n} 条标注）`,
    convertAll: '全部转卡片',
    convertAllDone: (n) => `已将 ${n} 条标注转为卡片`,
    inserted: (file) => `已插入 ${file} 末尾（快照 +1）`,
    convertedMsg: (title) => `已生成卡片：${title}`,
    createdMsg: (title) => `已创建卡片：${title}`,
    deletedMsg: '卡片已删除',
  },
  en: {
    newCard: 'New card',
    titlePh: 'Card title…',
    bodyPh: 'Body (Markdown, use [[Target|alias]] for links)…',
    wikilinkHint: '[[wikilinks]] render as clickable chips; backlinks are collected automatically',
    create: 'Create card',
    annotations: 'PDF annotations',
    noAnnotations: 'No annotations yet. Highlight or annotate a PDF in the reader, then convert it here.',
    toCard: 'To card',
    converted: 'Converted',
    page: 'p.',
    fromPdf: 'From annotation',
    cards: 'Cards',
    noCards: 'No cards yet. Create one above, or convert a PDF annotation.',
    backlinks: 'Backlinks',
    noBacklinks: 'No backlinks',
    copyMd: 'Copy Markdown',
    insertTex: 'Insert into .tex',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    del: 'Delete',
    missingTarget: 'No card with this title yet (create one to link)',
    copied: 'Copied to clipboard',
    copyFailed: 'Copy failed',
    noTexFile: 'No .tex file in the project',
    exportMd: 'Export all annotations as .md',
    exportedMd: (n) => `Exported ${n} annotations as .md`,
    exportHtmlReport: 'Export annotation report',
    exportedHtmlReport: (n) => `Annotation report exported (${n} annotations)`,
    convertAll: 'Convert all to cards',
    convertAllDone: (n) => `Converted ${n} annotations to cards`,
    inserted: (file) => `Appended to ${file} (snapshot +1)`,
    convertedMsg: (title) => `Card created: ${title}`,
    createdMsg: (title) => `Card created: ${title}`,
    deletedMsg: 'Card deleted',
  },
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 与 @lemma/knowledge parseWikilinks 同构的 token 正则（渲染用） */
const WIKILINK_TOKEN_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

const SEM_CLASS: Record<NonNullable<Annotation['semantic']>, string> = {
  method: 'method',
  finding: 'finding',
  question: 'question',
  citation: 'citation',
};

/** 标注文件键（pdf:foo.pdf）→ 文献库条目（只读匹配 pdfPath），找不到返回 undefined */
function paperRefFor(fileKey: string, papers: Paper[]): PaperRef | undefined {
  const name = fileKey.replace(/^pdf:/, '');
  const hit = papers.find((p) => {
    const path = p.pdfPath?.replace(/\\/g, '/');
    if (!path) return false;
    return path === name || path === fileKey || path.endsWith(`/${name}`);
  });
  return hit ? { title: hit.title, citekey: hit.citekey } : undefined;
}

function markdownOf(note: Note): string {
  return `${note.title}\n\n${note.bodyMd}`;
}

/** 卡片入稿的 LaTeX 注释块：% --- note: 标题 --- + 逐行注释的正文 */
export function noteTexBlock(note: Note, lang: Language = 'zh'): string {
  const source = lang === 'zh' ? '% 来自 Lemma 卡片笔记' : '% from a Lemma note card';
  const body = note.bodyMd.split('\n').map((line) => `% ${line}`.trimEnd());
  return [`% --- note: ${note.title} ---`, source, ...body].join('\n');
}

/** 剪贴板：优先 navigator.clipboard，非安全上下文回退 execCommand */
function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      if (document.execCommand('copy')) resolve();
      else reject(new Error('execCommand copy failed'));
    } finally {
      ta.remove();
    }
  });
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 导出文件名时间戳（20260930-1416） */
function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Blob 下载纯文本（面板内复用：标注 .md 导出） */
function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** 标注文件键（pdf:foo.pdf / paper:{id}）→ 文献条目标题（仅用于导出标题，找不到返回 undefined） */
function paperTitleFor(fileKey: string, papers: Paper[]): string | undefined {
  if (fileKey.startsWith('paper:')) {
    return papers.find((p) => p.id === fileKey.slice('paper:'.length))?.title;
  }
  const name = fileKey.replace(/^pdf:/, '');
  const hit = papers.find((p) => {
    const path = p.pdfPath?.replace(/\\/g, '/');
    return path !== undefined && (path === name || path.endsWith(`/${name}`));
  });
  return hit?.title;
}

// ---------------------------------------------------------------------------
// 双链正文渲染
// ---------------------------------------------------------------------------

function renderCardBody(
  body: string,
  resolve: (target: string) => Note | undefined,
  onJump: (target: string) => void,
  t: Dict,
): ReactNode[] {
  const out: ReactNode[] = [];
  let key = 0;
  let last = 0;
  for (const m of body.matchAll(WIKILINK_TOKEN_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(<span key={key++}>{body.slice(last, idx)}</span>);
    const target = (m[1] ?? '').trim();
    const alias = (m[2] ?? '').trim();
    const note = resolve(target);
    out.push(
      <button
        key={key++}
        type="button"
        className={`sf-wikilink ${note ? '' : 'sf-wikilink--missing'}`}
        title={note ? note.title : t.missingTarget}
        onClick={() => onJump(target)}
      >
        {alias.length > 0 ? alias : target}
      </button>,
    );
    last = idx + m[0].length;
  }
  if (last < body.length) out.push(<span key={key++}>{body.slice(last)}</span>);
  return out;
}

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function NotesPanel() {
  const lang = useSettingsStore((s) => s.language);
  const t = DICT[lang];

  const notes = useNotesStore((s) => s.notes);
  const addNote = useNotesStore((s) => s.addNote);
  const addNoteFromAnnotation = useNotesStore((s) => s.addNoteFromAnnotation);
  const updateNote = useNotesStore((s) => s.updateNote);
  const removeNote = useNotesStore((s) => s.removeNote);

  const byFile = useAnnotationStore((s) => s.byFile);
  const papers = useLibraryStore((s) => s.papers);
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const texFiles = useMemo(
    () => Object.keys(files).filter((f) => f.endsWith('.tex')).sort(),
    [files],
  );

  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const listRef = useRef<HTMLDivElement>(null);

  // 状态条 3s 自动消退
  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  const noteByTitle = useMemo(() => {
    const map = new Map<string, Note>();
    for (const n of notes) if (!map.has(n.title.trim().toLowerCase())) map.set(n.title.trim().toLowerCase(), n);
    return map;
  }, [notes]);
  const noteById = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes]);

  const backlinkIndex = useMemo(() => buildBacklinkIndex(notes), [notes]);

  const annotationRows = useMemo(
    () =>
      Object.entries(byFile).flatMap(([fileKey, list]) =>
        (list ?? []).map((a) => ({ fileKey, annotation: a })),
      ),
    [byFile],
  );
  const convertedIds = useMemo(
    () => new Set(notes.flatMap((n) => (n.originAnnotationId ? [n.originAnnotationId] : []))),
    [notes],
  );
  /** 尚未转卡片的标注数（「全部转卡片」按钮态） */
  const pendingConvertCount = useMemo(
    () => annotationRows.filter(({ annotation }) => !convertedIds.has(annotation.id)).length,
    [annotationRows, convertedIds],
  );

  /** 双链/反向链接点击 → 选中同名卡片并滚动定位 */
  const jumpToNote = (target: string) => {
    const note = noteByTitle.get(target.trim().toLowerCase());
    if (!note) return;
    setSelectedId(note.id);
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-note-id="${note.id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  const createCard = () => {
    if (draftTitle.trim().length === 0 && draftBody.trim().length === 0) return;
    const note = addNote({ title: draftTitle, bodyMd: draftBody });
    setDraftTitle('');
    setDraftBody('');
    setSelectedId(note.id);
    setStatus(t.createdMsg(note.title));
  };

  const convertAnnotation = (fileKey: string, annotation: Annotation) => {
    const note = addNoteFromAnnotation(annotation, paperRefFor(fileKey, papers));
    setSelectedId(note.id);
    setStatus(t.convertedMsg(note.title));
    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-note-id="${note.id}"]`);
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  };

  /** 全部标注 → Markdown 文件下载（按页分组；单一文件来源时带文献标题） */
  const exportAnnotationsMd = () => {
    if (annotationRows.length === 0) return;
    const fileKeys = [...new Set(annotationRows.map((row) => row.fileKey))];
    const title = fileKeys.length === 1 ? paperTitleFor(fileKeys[0]!, papers) : undefined;
    const md = annotationsToMarkdown(
      annotationRows.map((row) => row.annotation),
      title,
    );
    downloadText(`pdf-annotations-${stamp()}.md`, md, 'text/markdown;charset=utf-8');
    setStatus(t.exportedMd(annotationRows.length));
  };

  /** 全部标注 → 自包含 HTML 标注报告（sf-annotations-{项目名}-{日期}.html，浏览器打开 / Ctrl+P 打印为 PDF） */
  const exportAnnotationReportHtml = () => {
    if (annotationRows.length === 0) return;
    const pkg = buildReviewPackage({ projectName, comments: [], annotations: byFile });
    downloadAnnotationReport(pkg, { prefix: 'sf-annotations' });
    setStatus(t.exportedHtmlReport(annotationRows.length));
  };

  /** 未转卡片的新标注全部走 addNoteFromAnnotation 通路转卡片 */
  const convertAllAnnotations = () => {
    const pending = annotationRows.filter(({ annotation }) => !convertedIds.has(annotation.id));
    if (pending.length === 0) return;
    let last: Note | undefined;
    for (const { fileKey, annotation } of pending) {
      last = addNoteFromAnnotation(annotation, paperRefFor(fileKey, papers));
    }
    if (last) {
      setSelectedId(last.id);
      requestAnimationFrame(() => {
        const el = listRef.current?.querySelector(`[data-note-id="${last!.id}"]`);
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    }
    setStatus(t.convertAllDone(pending.length));
  };

  const startEdit = (note: Note) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditBody(note.bodyMd);
  };

  const saveEdit = (id: string) => {
    updateNote(id, { title: editTitle, bodyMd: editBody });
    setEditingId(null);
  };

  const copyCard = (note: Note) => {
    void writeClipboard(markdownOf(note))
      .then(() => setStatus(t.copied))
      .catch(() => setStatus(t.copyFailed));
  };

  /** N3：快照后追加为注释块到当前 .tex（无当前 .tex 时取排序首个），并跳到插入处 */
  const insertCard = (note: Note) => {
    const ws = useWorkspaceStore.getState();
    const target =
      activeTab && activeTab.endsWith('.tex') && activeTab in ws.files ? activeTab : texFiles[0];
    if (!target) {
      setStatus(t.noTexFile);
      return;
    }
    const prev = ws.files[target] ?? '';
    const base = prev.length === 0 || prev.endsWith('\n') ? prev : `${prev}\n`;
    const startLine = (base.match(/\n/g)?.length ?? 0) + 1;
    ws.snapshotFile(target, lang === 'zh' ? `插入卡片：${note.title}` : `Insert note: ${note.title}`);
    ws.updateFile(target, `${base}${noteTexBlock(note, lang)}\n`);
    jumpTo({ file: target, line: startLine });
    setStatus(t.inserted(target));
  };

  return (
    <div className="sf-knowledge sf-notes">
      {/* 新建卡片 */}
      <div className="sf-notes-new">
        <div className="sf-notes-new-title">{t.newCard}</div>
        <input
          className="sf-notes-input"
          value={draftTitle}
          placeholder={t.titlePh}
          onChange={(e) => setDraftTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') createCard();
          }}
        />
        <textarea
          className="sf-notes-input sf-notes-textarea"
          value={draftBody}
          placeholder={t.bodyPh}
          rows={4}
          onChange={(e) => setDraftBody(e.target.value)}
        />
        <div className="sf-notes-new-actions">
          <span className="sf-notes-hint">{t.wikilinkHint}</span>
          <button type="button" className="sf-btn primary" onClick={createCard}>
            <Plus size={12} /> {t.create}
          </button>
        </div>
      </div>

      {status && (
        <p className="sf-notes-status" role="status">
          {status}
        </p>
      )}

      {/* PDF 标注 → 卡片（含批量导出 / 批量转卡片） */}
      <section className="sf-notes-section">
        <div className="sf-knowledge-title sf-export-annot-head">
          {t.annotations} <span className="sf-knowledge-count">{annotationRows.length}</span>
          <span className="sf-export-annot-actions">
            <button
              type="button"
              className="sf-btn sf-export-annot-md"
              disabled={annotationRows.length === 0}
              title={t.exportMd}
              onClick={exportAnnotationsMd}
            >
              <FileDown size={12} /> {t.exportMd}
            </button>
            <button
              type="button"
              className="sf-btn sf-export-annot-html"
              disabled={annotationRows.length === 0}
              title={t.exportHtmlReport}
              onClick={exportAnnotationReportHtml}
            >
              <FileCode2 size={12} /> {t.exportHtmlReport}
            </button>
            <button
              type="button"
              className="sf-btn sf-export-annot-cards"
              disabled={pendingConvertCount === 0}
              title={t.convertAll}
              onClick={convertAllAnnotations}
            >
              <CopyPlus size={12} /> {t.convertAll}
            </button>
          </span>
        </div>
        {annotationRows.length === 0 ? (
          <p className="placeholder">{t.noAnnotations}</p>
        ) : (
          <ul className="sf-notes-annots">
            {annotationRows.map(({ fileKey, annotation }) => {
              const done = convertedIds.has(annotation.id);
              return (
                <li key={annotation.id} className="sf-notes-annot">
                  <span
                    className={`sf-sem-dot sf-sem-dot--${SEM_CLASS[annotation.semantic ?? 'method']}`}
                    aria-hidden
                  />
                  <div className="sf-notes-annot-main">
                    <div className="sf-notes-annot-meta">
                      <code className="sf-notes-file">{fileKey.replace(/^pdf:/, '')}</code>
                      <span className="sf-notes-page">
                        {t.page} {annotation.page}
                      </span>
                    </div>
                    {(annotation.quotedText ?? annotation.text ?? '').trim().length > 0 && (
                      <p className="sf-notes-annot-quote">
                        {(annotation.quotedText ?? annotation.text ?? '').split('\n')[0]}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className={`sf-btn ${done ? 'sf-notes-annot-done' : ''}`}
                    disabled={done}
                    title={done ? t.converted : t.toCard}
                    onClick={() => convertAnnotation(fileKey, annotation)}
                  >
                    {done ? t.converted : t.toCard}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* 卡片列表 */}
      <section className="sf-notes-section" ref={listRef}>
        <div className="sf-knowledge-title">
          {t.cards} <span className="sf-knowledge-count">{notes.length}</span>
        </div>
        {notes.length === 0 ? (
          <p className="placeholder">{t.noCards}</p>
        ) : (
          <ul className="sf-notes-list">
            {notes.map((note) => {
              const backlinks = (backlinkIndex.get(note.title.trim()) ?? [])
                .map((id) => noteById.get(id))
                .filter((n): n is Note => n !== undefined);
              const editing = editingId === note.id;
              return (
                <li
                  key={note.id}
                  data-note-id={note.id}
                  className={`sf-note-card ${selectedId === note.id ? 'sf-note-card--selected' : ''}`}
                >
                  <div className="sf-note-card-head">
                    <span className="sf-note-card-title">{note.title}</span>
                    <span className="sf-note-card-meta">
                      {note.originAnnotationId && (
                        <span className="sf-chip dim" title={t.fromPdf}>
                          <Link2 size={10} />
                        </span>
                      )}
                      <time>{fmtTime(note.updatedAt)}</time>
                    </span>
                  </div>

                  {editing ? (
                    <div className="sf-note-edit">
                      <input
                        className="sf-notes-input"
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <textarea
                        className="sf-notes-input sf-notes-textarea"
                        value={editBody}
                        rows={6}
                        onChange={(e) => setEditBody(e.target.value)}
                      />
                      <div className="sf-note-edit-actions">
                        <button type="button" className="sf-btn primary" onClick={() => saveEdit(note.id)}>
                          {t.save}
                        </button>
                        <button type="button" className="sf-btn" onClick={() => setEditingId(null)}>
                          <X size={12} /> {t.cancel}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="sf-note-card-body">
                        {renderCardBody(note.bodyMd, (target) => noteByTitle.get(target.toLowerCase()), jumpToNote, t)}
                      </div>
                      <div className="sf-note-backlinks">
                        <span className="sf-note-backlinks-label">
                          {t.backlinks} · {backlinks.length}
                        </span>
                        {backlinks.length === 0 ? (
                          <span className="sf-note-backlinks-empty">{t.noBacklinks}</span>
                        ) : (
                          backlinks.map((src) => (
                            <button
                              key={src.id}
                              type="button"
                              className="sf-backlink-chip"
                              title={src.title}
                              onClick={() => {
                                setSelectedId(src.id);
                                requestAnimationFrame(() => {
                                  const el = listRef.current?.querySelector(`[data-note-id="${src.id}"]`);
                                  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                                });
                              }}
                            >
                              {src.title}
                            </button>
                          ))
                        )}
                      </div>
                    </>
                  )}

                  <div className="sf-note-card-actions">
                    <button type="button" className="sf-btn" onClick={() => copyCard(note)} title={t.copyMd}>
                      <Copy size={12} /> {t.copyMd}
                    </button>
                    <button type="button" className="sf-btn" onClick={() => insertCard(note)} title={t.insertTex}>
                      <ArrowDownToLine size={12} /> {t.insertTex}
                    </button>
                    {editing ? null : (
                      <button type="button" className="sf-btn" onClick={() => startEdit(note)} title={t.edit}>
                        <Pencil size={12} /> {t.edit}
                      </button>
                    )}
                    <button
                      type="button"
                      className="sf-btn sf-note-card-del"
                      onClick={() => {
                        removeNote(note.id);
                        setStatus(t.deletedMsg);
                      }}
                      title={t.del}
                    >
                      <Trash2 size={12} /> {t.del}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
