/**
 * 自定义模板（图表导航器 + 自定义模板）：把当前工作区保存为可复用模板，
 * 模板向导选中后直接以其 entry + files 调 loadProject 载入（不走 scaffoldProject）。
 * 持久化到 localStorage（key: sf-user-templates）：读入逐条 shape 校验（坏数据安全跳过），
 * 上限 20 条、超出淘汰最旧（savedAt 最小）。保存约束：名称非空且文件数 1–50，否则拒绝。
 */

import { create } from 'zustand';
import { createId } from '@scholarforge/shared';
import { useWorkspaceStore } from './workspaceStore';
import { resolveEntry } from '../projectDoc';

export interface UserTemplate {
  id: string;
  name: string;
  description: string;
  /** 编译入口（相对项目根） */
  entry: string;
  files: Record<string, string>;
  savedAt: number;
}

export const TEMPLATES_STORAGE_KEY = 'sf-user-templates';
/** 模板上限，超出淘汰最旧（savedAt 最小） */
export const MAX_USER_TEMPLATES = 20;
/** 单个模板的文件数合法区间（之外保存返回 false） */
export const MIN_TEMPLATE_FILES = 1;
export const MAX_TEMPLATE_FILES = 50;

interface TemplatesState {
  templates: UserTemplate[];
  /**
   * 把 workspaceStore 当前项目保存为模板：名称 trim 后非空、文件数 1–50 才入库；
   * 同名（trim 后）覆盖（保留原 id、更新内容与 savedAt）。失败返回 false 且不入库。
   */
  saveFromWorkspace(name: string, description?: string): boolean;
  removeUserTemplate(id: string): void;
  /** 模板清单（浅拷贝 + files 拷贝，防调用方篡改 store 数据） */
  listUserTemplates(): UserTemplate[];
}

// ---------------------------------------------------------------------------
// 持久化（localStorage sf-user-templates）
// ---------------------------------------------------------------------------

/** 未知数据 → UserTemplate；id/name/files 缺失或非法返回 null（该条弃用，不影响其余） */
function sanitizeTemplate(raw: unknown): UserTemplate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (typeof v.name !== 'string' || !v.name.trim()) return null;
  if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(v.files)) {
    if (typeof content === 'string') files[path] = content;
  }
  if (Object.keys(files).length === 0) return null; // 空文件模板没有意义，弃用
  return {
    id: v.id,
    name: v.name,
    description: typeof v.description === 'string' ? v.description : '',
    entry: typeof v.entry === 'string' ? v.entry : '',
    files,
    savedAt: typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0,
  };
}

function readPersisted(): UserTemplate[] {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeTemplate).filter((t): t is UserTemplate => t !== null);
  } catch {
    return []; // 坏数据（非法 JSON 等）整体回退为空
  }
}

function persist(templates: UserTemplate[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(TEMPLATES_STORAGE_KEY, JSON.stringify(templates));
    }
  } catch {
    /* 持久化失败（如配额超限）不打断 UI */
  }
}

/** 超出上限时淘汰最旧（savedAt 最小；并列时取数组中更靠后者=更早入库） */
function evictToCap(templates: UserTemplate[]): UserTemplate[] {
  let next = templates;
  while (next.length > MAX_USER_TEMPLATES) {
    let oldest = -1;
    for (let i = 0; i < next.length; i++) {
      if (oldest === -1 || next[i]!.savedAt <= next[oldest]!.savedAt) oldest = i;
    }
    if (oldest === -1) break;
    next = next.filter((_, i) => i !== oldest);
  }
  return next;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useTemplatesStore = create<TemplatesState>()((set, get) => ({
  templates: readPersisted(),

  saveFromWorkspace(name, description) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) return false; // 空名拒绝
    const ws = useWorkspaceStore.getState();
    const count = Object.keys(ws.files).length;
    if (count < MIN_TEMPLATE_FILES || count > MAX_TEMPLATE_FILES) return false; // 文件数越界拒绝
    const files = { ...ws.files };
    const entry = ws.entry || resolveEntry(files);
    const savedAt = Date.now();
    const desc = typeof description === 'string' ? description.trim() : '';
    set((s) => {
      const idx = s.templates.findIndex((t) => t.name === trimmed);
      if (idx >= 0) {
        // 同名覆盖：保留原 id，更新描述/入口/文件/时间
        return {
          templates: evictToCap(
            s.templates.map((t, i) => (i === idx ? { ...t, description: desc, entry, files, savedAt } : t)),
          ),
        };
      }
      return {
        templates: evictToCap([
          { id: createId(), name: trimmed, description: desc, entry, files, savedAt },
          ...s.templates,
        ]),
      };
    });
    return true;
  },

  removeUserTemplate(id) {
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }));
  },

  listUserTemplates() {
    return get().templates.map((t) => ({ ...t, files: { ...t.files } }));
  },
}));

useTemplatesStore.subscribe((s) => persist(s.templates));
