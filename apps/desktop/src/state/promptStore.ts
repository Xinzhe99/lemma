/**
 * 自定义提示词库（v1.2.0 ③）：研究者把高频指令沉淀为可复用资产。
 *  - 场景：反复手打「请检查全文时态一致性并给出修改建议」这类指令；
 *  - 挂载：斜杠菜单注入（ChatPanel SlashMenuItem.insert 填入输入框，可改后发送）；
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

export const usePromptStore = create<PromptState>((set) => ({
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
}));

/** 斜杠菜单注入形态（宿主映射；title 无斜杠前缀时补「/」） */
export function promptsToSlashItems(prompts: UserPrompt[]): { id: string; label: string; hint?: string; insert: string }[] {
  return prompts.map((p) => ({
    id: `up:${p.id}`,
    label: p.title.startsWith('/') ? p.title : `/${p.title}`,
    hint: p.body.length > 40 ? `${p.body.slice(0, 40)}…` : p.body,
    insert: p.body,
  }));
}

/** 测试隔离：重置内存态并清空持久化副本 */
export function __resetPromptStoreForTests(): void {
  usePromptStore.setState({ prompts: [] });
  persist([]);
}
