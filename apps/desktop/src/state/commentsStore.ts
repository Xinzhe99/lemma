/**
 * 稿件行级批注状态（导师-学生协作改稿工作流）：
 * 在 .tex 源码行上挂批注/回复/解决，localStorage（sf-comments）持久化，
 * 并提供审阅意见 Markdown 导出纯函数 commentsToMarkdown（面板底部导出按钮复用）。
 */

import { create } from 'zustand';
import { createId } from '@lemma/shared';

export interface CommentReply {
  author: string;
  text: string;
  createdAt: number;
}

export interface ManuscriptComment {
  id: string;
  file: string;
  line: number;
  author: string;
  text: string;
  resolved: boolean;
  createdAt: number;
  replies: CommentReply[];
}

export const COMMENTS_STORAGE_KEY = 'sf-comments';

// ---------------------------------------------------------------------------
// 持久化读入：逐条 shape 校验，坏数据（损坏 JSON / 非数组 / 非法条目 / replies 损坏）安全回退
// ---------------------------------------------------------------------------

function isReply(v: unknown): v is CommentReply {
  if (!v || typeof v !== 'object') return false;
  const r = v as Partial<CommentReply>;
  return (
    typeof r.author === 'string' &&
    typeof r.text === 'string' &&
    typeof r.createdAt === 'number'
  );
}

function isCommentShape(v: unknown): v is Omit<ManuscriptComment, 'replies'> {
  if (!v || typeof v !== 'object') return false;
  const c = v as Partial<ManuscriptComment>;
  return (
    typeof c.id === 'string' &&
    typeof c.file === 'string' &&
    typeof c.line === 'number' &&
    typeof c.author === 'string' &&
    typeof c.text === 'string' &&
    typeof c.resolved === 'boolean' &&
    typeof c.createdAt === 'number'
  );
}

/** 单条净化：非法条目丢弃（null）；replies 缺失/非数组/含非法回复 → 过滤后回退（无则 []） */
function sanitizeComment(v: unknown): ManuscriptComment | null {
  if (!isCommentShape(v)) return null;
  const raw = (v as { replies?: unknown }).replies;
  const replies = Array.isArray(raw) ? (raw.filter(isReply) as CommentReply[]) : [];
  return { ...(v as Omit<ManuscriptComment, 'replies'>), replies };
}

function readPersisted(): ManuscriptComment[] {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(COMMENTS_STORAGE_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .map(sanitizeComment)
      .filter((c): c is ManuscriptComment => c !== null);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 审阅意见 Markdown 导出（纯函数）：按文件分组 → 行号升序 → `- [行 N] 作者：文本（已解决）` + 缩进回复
// ---------------------------------------------------------------------------

/** 导出用语言（仅影响标签文案；zh 为缺省，en 由面板按当前界面语言传入） */
export function commentsToMarkdown(
  comments: ManuscriptComment[],
  lang: 'zh' | 'en' = 'zh',
): string {
  if (comments.length === 0) return '';
  const lineLabel = lang === 'en' ? 'L' : '行';
  const resolvedMark = lang === 'en' ? ' (resolved)' : '（已解决）';
  const colon = lang === 'en' ? ': ' : '：';
  const files = [...new Set(comments.map((c) => c.file))].sort();
  const blocks: string[] = [];
  for (const file of files) {
    const items = comments
      .filter((c) => c.file === file)
      .sort((a, b) => a.line - b.line || a.createdAt - b.createdAt);
    const lines: string[] = [];
    for (const c of items) {
      lines.push(`- [${lineLabel} ${c.line}] ${c.author}${colon}${c.text}${c.resolved ? resolvedMark : ''}`);
      for (const r of c.replies) {
        lines.push(`  - ${r.author}${colon}${r.text}`);
      }
    }
    blocks.push([`## ${file}`, ...lines].join('\n'));
  }
  return `${blocks.join('\n\n')}\n`;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

interface CommentsState {
  comments: ManuscriptComment[];
  /** 在 file 的第 line 行挂一条批注（空文本/空文件名不落库，返回 null） */
  addComment(
    file: string,
    line: number,
    text: string,
    author?: string,
  ): ManuscriptComment | null;
  addReply(id: string, text: string, author?: string): void;
  toggleResolved(id: string): void;
  removeComment(id: string): void;
  /** 指定文件的批注，按行号升序（同行按创建时间），返回副本 */
  commentsFor(file: string): ManuscriptComment[];
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: readPersisted(),

  addComment(file, line, text, author = '导师') {
    const body = text.trim();
    const who = author.trim();
    if (!file || body.length === 0) return null;
    const comment: ManuscriptComment = {
      id: createId(),
      file,
      line,
      author: who.length > 0 ? who : '导师',
      text: body,
      resolved: false,
      createdAt: Date.now(),
      replies: [],
    };
    set((s) => ({ comments: [...s.comments, comment] }));
    return comment;
  },

  addReply(id, text, author = '作者') {
    const body = text.trim();
    if (body.length === 0) return;
    const who = author.trim();
    const reply: CommentReply = {
      author: who.length > 0 ? who : '作者',
      text: body,
      createdAt: Date.now(),
    };
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, replies: [...c.replies, reply] } : c)),
    }));
  },

  toggleResolved(id) {
    set((s) => ({
      comments: s.comments.map((c) => (c.id === id ? { ...c, resolved: !c.resolved } : c)),
    }));
  },

  removeComment(id) {
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) }));
  },

  commentsFor(file) {
    return get()
      .comments.filter((c) => c.file === file)
      .sort((a, b) => a.line - b.line || a.createdAt - b.createdAt);
  },
}));

useCommentsStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(s.comments));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});
