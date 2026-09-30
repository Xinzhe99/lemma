/**
 * 稿件行级批注面板（导师-学生协作改稿）：在 .tex 光标行挂批注、回复/解决/删除、
 * 点击条目头跳转源码行（editorJump）、三态过滤（全部/未解决/已解决）、底部导出审阅意见 .md。
 * 壳层契约：export function CommentsPanel()，无 props（LazyPanel 动态发现）。
 * 样式：复用全局 sf-btn / sf-chip / placeholder + 少量内联样式（不新增 css）。
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Check, CornerDownRight, FileDown, MessageSquarePlus, Trash2, X } from 'lucide-react';
import { jumpTo, lastCursor, subscribeCursor } from '../editorJump';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { commentsToMarkdown, useCommentsStore, type ManuscriptComment } from '../state/commentsStore';

// ---------------------------------------------------------------------------
// 双语文案
// ---------------------------------------------------------------------------

type Filter = 'all' | 'open' | 'resolved';

interface Dict {
  addAtCursor: string;
  needOpenTex: string;
  needTexFile: string;
  needCursorInFile: string;
  composerTitle: (file: string, line: number) => string;
  textPh: string;
  authorPh: string;
  defaultAuthor: string;
  defaultReplyAuthor: string;
  submit: string;
  cancel: string;
  emptyText: string;
  filterAll: string;
  filterOpen: string;
  filterResolved: string;
  empty: string;
  noMatch: string;
  lineLabel: string;
  resolvedChip: string;
  jumpHint: string;
  repliesLabel: (n: number) => string;
  reply: string;
  replySubmit: string;
  replyPh: string;
  markResolved: string;
  reopen: string;
  del: string;
  exportMd: string;
  addedMsg: (file: string, line: number) => string;
  repliedMsg: string;
  deletedMsg: string;
  exportedMsg: (n: number) => string;
}

const DICT: Record<Language, Dict> = {
  zh: {
    addAtCursor: '在当前行添加批注',
    needOpenTex: '请先打开一个 .tex 文件',
    needTexFile: '仅支持在 .tex 文件上添加批注',
    needCursorInFile: '光标不在当前文件：请先在编辑器中点击定位',
    composerTitle: (file, line) => `在 ${file} 行 ${line} 添加批注`,
    textPh: '批注内容…',
    authorPh: '署名',
    defaultAuthor: '导师',
    defaultReplyAuthor: '作者',
    submit: '添加',
    cancel: '取消',
    emptyText: '批注内容不能为空',
    filterAll: '全部',
    filterOpen: '未解决',
    filterResolved: '已解决',
    empty: '还没有批注。打开 .tex 文件后，用上方按钮在光标行添加第一条批注。',
    noMatch: '当前过滤器下没有批注',
    lineLabel: '行',
    resolvedChip: '已解决',
    jumpHint: '点击跳转到源码行',
    repliesLabel: (n) => `回复 ${n}`,
    reply: '回复',
    replySubmit: '提交回复',
    replyPh: '回复内容…',
    markResolved: '标为已解决',
    reopen: '重新打开',
    del: '删除',
    exportMd: '导出审阅意见 .md',
    addedMsg: (file, line) => `已添加批注：${file} ${line} 行`,
    repliedMsg: '回复已添加',
    deletedMsg: '批注已删除',
    exportedMsg: (n) => `已导出 ${n} 条批注为 .md`,
  },
  en: {
    addAtCursor: 'Add comment at cursor',
    needOpenTex: 'Open a .tex file first',
    needTexFile: 'Comments can only be added on .tex files',
    needCursorInFile: 'Cursor is not in the active file: click inside the editor first',
    composerTitle: (file, line) => `Add comment on ${file} line ${line}`,
    textPh: 'Comment text…',
    authorPh: 'Your name',
    defaultAuthor: 'Advisor',
    defaultReplyAuthor: 'Author',
    submit: 'Add',
    cancel: 'Cancel',
    emptyText: 'Comment text is required',
    filterAll: 'All',
    filterOpen: 'Open',
    filterResolved: 'Resolved',
    empty: 'No comments yet. Open a .tex file and add the first one at the cursor line.',
    noMatch: 'No comments under this filter',
    lineLabel: 'L',
    resolvedChip: 'Resolved',
    jumpHint: 'Click to jump to the source line',
    repliesLabel: (n) => `Replies ${n}`,
    reply: 'Reply',
    replySubmit: 'Submit reply',
    replyPh: 'Reply text…',
    markResolved: 'Resolve',
    reopen: 'Reopen',
    del: 'Delete',
    exportMd: 'Export review .md',
    addedMsg: (file, line) => `Comment added: ${file} line ${line}`,
    repliedMsg: 'Reply added',
    deletedMsg: 'Comment deleted',
    exportedMsg: (n) => `Exported ${n} comments as .md`,
  },
};

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 导出文件名日期戳（review-comments-YYYYMMDD.md） */
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** Blob 下载纯文本（审阅意见 .md 导出） */
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

// ---------------------------------------------------------------------------
// 面板
// ---------------------------------------------------------------------------

export function CommentsPanel() {
  const lang = useSettingsStore((s) => s.language);
  const t = DICT[lang];

  const comments = useCommentsStore((s) => s.comments);
  const addComment = useCommentsStore((s) => s.addComment);
  const addReply = useCommentsStore((s) => s.addReply);
  const toggleResolved = useCommentsStore((s) => s.toggleResolved);
  const removeComment = useCommentsStore((s) => s.removeComment);
  const activeTab = useWorkspaceStore((s) => s.activeTab);

  const [filter, setFilter] = useState<Filter>('open');
  const [composerOpen, setComposerOpen] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [draftAuthor, setDraftAuthor] = useState('');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyAuthor, setReplyAuthor] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(''), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  // 顶部「在当前行添加批注」可用性：activeTab 为 .tex 且编辑器光标在 activeTab 内。
  // 光标经 useSyncExternalStore(subscribeCursor, lastCursor) 响应式获取（D1 修复）：
  // 编辑器光标移动时 notifyCursor 通知订阅者，按钮可用性实时变化，无需等待面板重渲染。
  const cursor = useSyncExternalStore(subscribeCursor, lastCursor, lastCursor);
  const isTex = !!activeTab && activeTab.endsWith('.tex');
  const cursorInFile = isTex && cursor.file === activeTab;
  const addDisabledReason = !activeTab
    ? t.needOpenTex
    : !isTex
      ? t.needTexFile
      : !cursorInFile
        ? t.needCursorInFile
        : t.addAtCursor;

  const openComposer = () => {
    setDraftText('');
    setDraftAuthor(t.defaultAuthor);
    setComposerOpen(true);
  };

  const submitComment = () => {
    if (!activeTab) return;
    const created = addComment(activeTab, cursor.line, draftText, draftAuthor);
    if (!created) {
      setStatus(t.emptyText);
      return;
    }
    setComposerOpen(false);
    setStatus(t.addedMsg(created.file, created.line));
  };

  const openReply = (id: string) => {
    setReplyFor(id);
    setReplyText('');
    setReplyAuthor(t.defaultReplyAuthor);
  };

  const submitReply = (id: string) => {
    if (replyText.trim().length === 0) return;
    addReply(id, replyText, replyAuthor);
    setReplyFor(null);
    // 回复后自动展开该条，便于立即看到结果
    setExpandedIds((prev) => new Set(prev).add(id));
    setStatus(t.repliedMsg);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportMd = () => {
    if (comments.length === 0) return;
    const md = commentsToMarkdown(comments, lang);
    downloadText(`review-comments-${dateStamp()}.md`, md, 'text/markdown;charset=utf-8');
    setStatus(t.exportedMsg(comments.length));
  };

  const counts = useMemo(() => {
    const resolved = comments.filter((c) => c.resolved).length;
    return { all: comments.length, open: comments.length - resolved, resolved };
  }, [comments]);

  /** 过滤后按文件分组（文件名升序，组内行号升序） */
  const groups = useMemo(() => {
    const visible = comments.filter((c) =>
      filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved,
    );
    const byFile = new Map<string, ManuscriptComment[]>();
    for (const c of visible) {
      const list = byFile.get(c.file) ?? [];
      list.push(c);
      byFile.set(c.file, list);
    }
    return [...byFile.entries()]
      .map(([file, items]) => ({
        file,
        items: [...items].sort((a, b) => a.line - b.line || a.createdAt - b.createdAt),
      }))
      .sort((a, b) => a.file.localeCompare(b.file));
  }, [comments, filter]);

  const filterBtn = (key: Filter, label: string, count: number) => (
    <button
      key={key}
      type="button"
      data-filter={key}
      className={`sf-btn ${filter === key ? 'primary' : ''}`}
      aria-pressed={filter === key}
      style={{ fontSize: 11, padding: '2px 8px' }}
      onClick={() => setFilter(key)}
    >
      {label} {count}
    </button>
  );

  return (
    <div className="sf-comments" style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0 }}>
      {/* 顶部：在当前行添加批注 */}
      <button
        type="button"
        className="sf-btn primary"
        data-add-comment
        disabled={!cursorInFile}
        title={addDisabledReason}
        onClick={openComposer}
      >
        <MessageSquarePlus size={12} /> {t.addAtCursor}
      </button>

      {/* 内联添加区（textarea + 作者名） */}
      {composerOpen && activeTab && (
        <div
          className="sf-comments-compose"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 8,
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg-0)',
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>
            {t.composerTitle(activeTab, cursor.line)}
          </span>
          <textarea
            className="sf-comments-text"
            rows={3}
            value={draftText}
            placeholder={t.textPh}
            style={{ width: '100%', boxSizing: 'border-box' }}
            onChange={(e) => setDraftText(e.target.value)}
          />
          <input
            className="sf-comments-author"
            value={draftAuthor}
            placeholder={t.authorPh}
            style={{ width: '100%', boxSizing: 'border-box' }}
            onChange={(e) => setDraftAuthor(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="sf-btn primary"
              data-compose-submit
              disabled={draftText.trim().length === 0}
              onClick={submitComment}
            >
              {t.submit}
            </button>
            <button type="button" className="sf-btn" onClick={() => setComposerOpen(false)}>
              <X size={12} /> {t.cancel}
            </button>
          </div>
        </div>
      )}

      {status && (
        <p className="placeholder" role="status">
          {status}
        </p>
      )}

      {/* 三态过滤器（未解决为默认） */}
      <div role="toolbar" style={{ display: 'flex', gap: 6 }}>
        {filterBtn('all', t.filterAll, counts.all)}
        {filterBtn('open', t.filterOpen, counts.open)}
        {filterBtn('resolved', t.filterResolved, counts.resolved)}
      </div>

      {/* 列表（按文件分组，条目头点击跳源码行） */}
      {comments.length === 0 ? (
        <p className="placeholder">{t.empty}</p>
      ) : groups.length === 0 ? (
        <p className="placeholder">{t.noMatch}</p>
      ) : (
        groups.map((g) => (
          <section key={g.file} className="sf-comments-group">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: 'var(--fg-2)',
                marginBottom: 6,
              }}
            >
              <code>{g.file}</code>
              <span className="sf-chip dim">{g.items.length}</span>
            </div>
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {g.items.map((c) => (
                <li
                  key={c.id}
                  data-comment-id={c.id}
                  className="sf-comment"
                  style={{
                    padding: 8,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--bg-0)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    opacity: c.resolved ? 0.55 : 1,
                  }}
                >
                  {/* 条目头：点击跳转源码行 */}
                  <button
                    type="button"
                    className="sf-comment-head"
                    title={t.jumpHint}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                      border: 'none',
                      background: 'none',
                      padding: 0,
                      color: 'var(--fg-1)',
                      fontSize: 11,
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                    onClick={() => jumpTo({ file: c.file, line: c.line })}
                  >
                    <span>
                      {t.lineLabel} {c.line} · {c.author} · <time>{fmtTime(c.createdAt)}</time>
                    </span>
                    {c.resolved && (
                      <span className="sf-chip ok">
                        <Check size={9} /> {t.resolvedChip}
                      </span>
                    )}
                  </button>

                  <p style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{c.text}</p>

                  {/* 回复列表（可展开） */}
                  {c.replies.length > 0 && (
                    <>
                      <button
                        type="button"
                        className="sf-btn"
                        data-comment-replies-toggle
                        style={{ fontSize: 11, padding: '2px 8px', alignSelf: 'flex-start' }}
                        aria-expanded={expandedIds.has(c.id)}
                        onClick={() => toggleExpand(c.id)}
                      >
                        <CornerDownRight size={11} /> {t.repliesLabel(c.replies.length)}
                      </button>
                      {expandedIds.has(c.id) && (
                        <ul
                          className="sf-comment-replies"
                          style={{
                            listStyle: 'none',
                            margin: 0,
                            padding: '0 0 0 10px',
                            borderLeft: '2px solid var(--border)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 4,
                          }}
                        >
                          {c.replies.map((r, i) => (
                            <li key={`${r.createdAt}-${i}`} style={{ fontSize: 11 }}>
                              <span style={{ color: 'var(--fg-2)' }}>
                                {r.author} · {fmtTime(r.createdAt)}
                              </span>
                              <p style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{r.text}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {/* 回复内联输入 */}
                  {replyFor === c.id && (
                    <div
                      className="sf-comment-replybox"
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: 6,
                        border: '1px dashed var(--border)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      <textarea
                        data-reply-text
                        rows={2}
                        value={replyText}
                        placeholder={t.replyPh}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        onChange={(e) => setReplyText(e.target.value)}
                      />
                      <input
                        data-reply-author
                        value={replyAuthor}
                        placeholder={t.authorPh}
                        style={{ width: '100%', boxSizing: 'border-box' }}
                        onChange={(e) => setReplyAuthor(e.target.value)}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          type="button"
                          className="sf-btn primary"
                          data-reply-submit
                          disabled={replyText.trim().length === 0}
                          onClick={() => submitReply(c.id)}
                        >
                          {t.replySubmit}
                        </button>
                        <button type="button" className="sf-btn" onClick={() => setReplyFor(null)}>
                          <X size={12} /> {t.cancel}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 操作 */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {replyFor === c.id ? null : (
                      <button
                        type="button"
                        className="sf-btn"
                        data-comment-reply
                        onClick={() => openReply(c.id)}
                      >
                        <CornerDownRight size={11} /> {t.reply}
                      </button>
                    )}
                    <button
                      type="button"
                      className="sf-btn"
                      data-comment-resolve
                      onClick={() => toggleResolved(c.id)}
                    >
                      <Check size={11} /> {c.resolved ? t.reopen : t.markResolved}
                    </button>
                    <button
                      type="button"
                      className="sf-btn danger"
                      data-comment-del
                      onClick={() => {
                        removeComment(c.id);
                        setStatus(t.deletedMsg);
                      }}
                    >
                      <Trash2 size={11} /> {t.del}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      {/* 底部：导出审阅意见 */}
      <button
        type="button"
        className="sf-btn"
        data-export-md
        disabled={comments.length === 0}
        title={t.exportMd}
        style={{ alignSelf: 'flex-start' }}
        onClick={exportMd}
      >
        <FileDown size={12} /> {t.exportMd}
      </button>
    </div>
  );
}
