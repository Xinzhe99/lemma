/**
 * 自定义提示词库（v1.2.0 ③）：研究者把高频指令沉淀为可复用资产。
 *  - 场景：反复手打「请检查全文时态一致性并给出修改建议」这类指令；
 *  - 挂载：斜杠菜单注入（ChatPanel SlashMenuItem.insertText 全文填入输入框，可改后发送）；
 *  - 管理：AgentPanel「提示词库」按钮 → PromptLibraryDialog（增改删）；
 *  - 持久化：localStorage（sf-user-prompts，小数据量；失败静默不打断 UI）。
 */

import { create } from 'zustand';
import { createId } from '@lemma/shared';

export interface UserPrompt {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export const PROMPTS_STORAGE_KEY = 'sf-user-prompts';
/** 标题上限（列表展示宽度） */
export const PROMPT_TITLE_MAX = 40;
/** 正文上限（防误贴整篇文章；提示词是短指令资产） */
export const PROMPT_BODY_MAX = 4000;
/** 数量上限（新的在前；超出淘汰最旧） */
export const PROMPTS_LIMIT = 60;

interface PromptState {
  prompts: UserPrompt[];
  /** 新增（返回 id）；标题/正文裁剪到上限 */
  addPrompt(title: string, body: string): string;
  updatePrompt(id: string, patch: { title?: string; body?: string }): void;
  deletePrompt(id: string): void;
  /** v7.7.0：批量导入（追加、同名去重）。返回 { added, skipped } 供界面反馈 */
  importPrompts(items: Array<{ title: string; text: string }>): { added: number; skipped: number };
}

/** 单条宽容校验：字段类型不符返回 null（不整体拒绝持久化数据） */
function coercePrompt(v: unknown): UserPrompt | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.title !== 'string' || typeof o.body !== 'string') return null;
  const createdAt = typeof o.createdAt === 'number' ? o.createdAt : Date.now();
  const updatedAt = typeof o.updatedAt === 'number' ? o.updatedAt : createdAt;
  return { id: o.id, title: o.title.slice(0, PROMPT_TITLE_MAX), body: o.body.slice(0, PROMPT_BODY_MAX), createdAt, updatedAt };
}

/** 从 localStorage 安全恢复（坏 JSON / 非数组 / 坏记录丢弃，截断到上限，新的在前） */
export function loadPersistedPrompts(): UserPrompt[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PROMPTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coercePrompt)
      .filter((p): p is UserPrompt => p != null)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, PROMPTS_LIMIT);
  } catch {
    return [];
  }
}

function persist(prompts: UserPrompt[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROMPTS_STORAGE_KEY, JSON.stringify(prompts));
    }
  } catch {
    /* 配额满/隐私模式：内存态仍可用，不打断 UI */
  }
}

export const usePromptStore = create<PromptState>((set, get) => ({
  prompts: loadPersistedPrompts(),

  addPrompt: (title, body) => {
    const id = createId();
    set((state) => {
      const next = [
        { id, title: title.trim().slice(0, PROMPT_TITLE_MAX), body: body.slice(0, PROMPT_BODY_MAX), createdAt: Date.now(), updatedAt: Date.now() },
        ...state.prompts,
      ].slice(0, PROMPTS_LIMIT);
      persist(next);
      return { prompts: next };
    });
    return id;
  },

  updatePrompt: (id, patch) =>
    set((state) => {
      const next = state.prompts
        .map((p) =>
          p.id === id
            ? {
                ...p,
                title: patch.title != null ? (patch.title.trim() || p.title).slice(0, PROMPT_TITLE_MAX) : p.title,
                body: patch.body != null ? patch.body.slice(0, PROMPT_BODY_MAX) : p.body,
                updatedAt: Date.now(),
              }
            : p,
        )
        .sort((a, b) => b.updatedAt - a.updatedAt);
      persist(next);
      return { prompts: next };
    }),

  deletePrompt: (id) =>
    set((state) => {
      const next = state.prompts.filter((p) => p.id !== id);
      persist(next);
      return { prompts: next };
    }),

  importPrompts: (items) => {
    const existing = get().prompts;
    const seen = new Set(existing.map((p) => p.title));
    const fresh: UserPrompt[] = [];
    let skipped = 0;
    for (const item of items) {
      const title = item.title.trim().slice(0, PROMPT_TITLE_MAX);
      const text = item.text.trim().slice(0, PROMPT_BODY_MAX);
      // 空标题/空内容丢弃；与既有库或同批内同名的跳过并计数
      if (!title || !text || seen.has(title)) {
        skipped += 1;
        continue;
      }
      seen.add(title);
      fresh.push({ id: createId(), title, body: text, createdAt: Date.now(), updatedAt: Date.now() });
    }
    if (fresh.length > 0) {
      const next = [...fresh.reverse(), ...existing].slice(0, PROMPTS_LIMIT); // 新的在前
      persist(next);
      set({ prompts: next });
    }
    return { added: fresh.length, skipped };
  },
}));

/** 斜杠菜单注入形态（宿主映射；title 无斜杠前缀时补「/」） */
export function promptsToSlashItems(prompts: UserPrompt[]): {
  id: string;
  label: string;
  hint?: string;
  insertText: string;
}[] {
  return prompts.map((p) => ({
    id: `up:${p.id}`,
    label: p.title.startsWith('/') ? p.title : `/${p.title}`,
    hint: p.body.length > 40 ? `${p.body.slice(0, 40)}…` : p.body,
    insertText: p.body,
  }));
}

// ---------------------------------------------------------------------------
// v7.7.0 提示词导入 / 导出：纯解析与格式化（UI 在 PromptLibraryDialog）。
// 支持两种格式（自动识别）：
//  1. JSON 数组 [{"title":"...","text":"..."}]（text 缺失时兼容 body 字段）；
//  2. 行格式「标题｜内容」——全角｜或半角 | 分隔，后续不含分隔符的行并入上一条
//     内容（多行提示词），直到下一个标题行。
// ---------------------------------------------------------------------------

/** 解析导入文本为 {title, text} 列表：坏记录丢弃，全不识别返回 [] */
export function parsePromptImport(raw: string): Array<{ title: string; text: string }> {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  // 1) JSON 数组自动识别（解析失败落回行格式）
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const out: Array<{ title: string; text: string }> = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const o = item as Record<string, unknown>;
          const title = typeof o.title === 'string' ? o.title.trim() : '';
          const text =
            typeof o.text === 'string' ? o.text : typeof o.body === 'string' ? o.body : '';
          if (title && text.trim()) out.push({ title, text: text.trim() });
        }
        return out;
      }
    } catch {
      /* 非 JSON → 按行格式解析 */
    }
  }
  // 2) 行格式：「标题｜内容」；不含分隔符的非空行并入上一条内容
  const out: Array<{ title: string; text: string }> = [];
  let current: { title: string; text: string } | null = null;
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^([^｜|]+)[｜|](.*)$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = { title: m[1].trim(), text: m[2].trim() };
    } else if (current && line.trim()) {
      current.text = current.text ? `${current.text}\n${line.trim()}` : line.trim();
    }
  }
  if (current) out.push(current);
  return out.filter((p) => p.title && p.text);
}

/** 导出格式化：与导入同口径的 JSON（title + text 字段，稳定可读） */
export function formatPromptsForExport(prompts: Array<Pick<UserPrompt, 'title' | 'body'>>): string {
  return JSON.stringify(
    prompts.map((p) => ({ title: p.title, text: p.body })),
    null,
    2,
  );
}

/** 测试隔离：重置内存态并清空持久化副本 */
export function __resetPromptStoreForTests(): void {
  usePromptStore.setState({ prompts: [] });
  persist([]);
}
