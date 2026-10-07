/**
 * 多项目管理：把 workspaceStore 当前状态保存为命名项目记录（含完整工作区快照），
 * 支持打开 / 重命名 / 复制 / 删除。持久化到 localStorage（key: sf-projects），
 * 读入时逐条 shape 校验（坏数据安全跳过），正式记录上限 20 个（超出挤掉最旧）。
 * 记录可携带 dir（用户选择的本地文件夹绝对路径）：打开时绑定 workspace.projectDir，
 * 供物化与磁盘同步（state/projectDisk.ts）使用；旧记录无 dir 照常工作。
 *
 * P1 崩溃恢复：ProjectSwitcher 挂载时把当前工作区写入固定 id（__current__）的临时记录，
 * 列表置顶展示，可一键转正式保存；临时记录不计入上限、切换项目后自动清除。
 *
 * workspace.json 仍是「当前激活项目」的持久层，本 store 只管理多项目档案。
 */

import { create } from 'zustand';
import { createId } from '@lemma/shared';
import { useWorkspaceStore, type FileSnapshot } from './workspaceStore';

/** 项目快照：与 workspaceStore 现有持久化结构（workspace.json）一致 */
export interface ProjectSnapshot {
  projectName: string;
  entry: string;
  files: Record<string, string>;
  openTabs: string[];
  activeTab: string | null;
  snapshots: Record<string, FileSnapshot[]>;
}

export interface ProjectRecord {
  id: string;
  name: string;
  savedAt: number;
  snapshot: ProjectSnapshot;
  /** 用户选择的本地文件夹（绝对路径；旧记录/未选择为 undefined——向后兼容） */
  dir?: string;
}

export const PROJECTS_STORAGE_KEY = 'sf-projects';
/** 崩溃恢复临时记录的固定 id（不计入上限，不参与同名覆盖） */
export const CURRENT_PROJECT_ID = '__current__';
/** 正式记录上限，超出挤掉最旧（savedAt 最小） */
export const MAX_PROJECTS = 20;

const FALLBACK_NAME = '未命名项目';

interface ProjectsState {
  projects: ProjectRecord[];
  /** 保存当前工作区为项目记录（name 缺省用当前 projectName），同名覆盖；返回记录 id */
  saveCurrent(name?: string): string;
  /** 恢复项目到 workspaceStore（loadProject + 恢复页签/快照）；id 不存在返回 false */
  openProject(id: string): boolean;
  removeProject(id: string): void;
  /** 重命名（同时更新快照内 projectName，保证重开后的项目名一致）；空名不生效 */
  renameProject(id: string, name: string): void;
  /** 复制副本（新 id、名称追加「副本」）；返回新 id，id 不存在返回 null */
  duplicateProject(id: string): string | null;
  /** P1 崩溃恢复：以固定 id __current__ 写入当前工作区临时快照（幂等覆盖，置顶） */
  saveCurrentTemp(): void;
  /** P1：把临时记录转正式保存（沿用其名称与快照，同名覆盖规则同 saveCurrent）；返回新 id，无临时记录返回 null */
  promoteCurrent(): string | null;
}

// ---------------------------------------------------------------------------
// 快照构造与校验
// ---------------------------------------------------------------------------

type WorkspaceSnapshotLike = Pick<
  ReturnType<typeof useWorkspaceStore.getState>,
  'projectName' | 'entry' | 'files' | 'openTabs' | 'activeTab' | 'snapshots'
>;

function cloneSnapshot(s: ProjectSnapshot): ProjectSnapshot {
  const snapshots: Record<string, FileSnapshot[]> = {};
  for (const [path, list] of Object.entries(s.snapshots)) {
    if (!Array.isArray(list)) continue;
    snapshots[path] = list.map((f) => ({
      content: typeof f?.content === 'string' ? f.content : '',
      ts: typeof f?.ts === 'number' && Number.isFinite(f.ts) ? f.ts : 0,
      label: typeof f?.label === 'string' ? f.label : '',
    }));
  }
  return {
    projectName: s.projectName,
    entry: s.entry,
    files: { ...s.files },
    openTabs: [...s.openTabs],
    activeTab: s.activeTab,
    snapshots,
  };
}

/** 从 workspaceStore 现有状态构造快照（页签/活动页/快照按当前文件集过滤） */
function snapshotOf(ws: WorkspaceSnapshotLike): ProjectSnapshot {
  const files = { ...ws.files };
  const openTabs = ws.openTabs.filter((p) => p in files);
  const activeTab =
    ws.activeTab !== null && ws.activeTab in files ? ws.activeTab : (openTabs[0] ?? null);
  return cloneSnapshot({
    projectName: ws.projectName,
    entry: ws.entry,
    files,
    openTabs,
    activeTab,
    snapshots: ws.snapshots,
  });
}

/** 未知数据 → ProjectSnapshot；缺关键结构（files）返回 null（整条记录弃用） */
function sanitizeSnapshot(raw: unknown): ProjectSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (!v.files || typeof v.files !== 'object' || Array.isArray(v.files)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(v.files)) {
    if (typeof content === 'string') files[path] = content;
  }
  const openTabs = Array.isArray(v.openTabs)
    ? v.openTabs.filter((p): p is string => typeof p === 'string' && p in files)
    : [];
  const activeTab =
    typeof v.activeTab === 'string' && v.activeTab in files ? v.activeTab : null;
  const snapshots: Record<string, FileSnapshot[]> = {};
  if (v.snapshots && typeof v.snapshots === 'object' && !Array.isArray(v.snapshots)) {
    for (const [path, list] of Object.entries(v.snapshots)) {
      if (!Array.isArray(list) || !(path in files)) continue;
      snapshots[path] = list
        .filter(
          (f): f is FileSnapshot =>
            !!f && typeof f === 'object' && typeof (f as FileSnapshot).content === 'string',
        )
        .map((f) => ({
          content: f.content,
          ts: typeof f.ts === 'number' && Number.isFinite(f.ts) ? f.ts : 0,
          label: typeof f.label === 'string' ? f.label : '',
        }));
    }
  }
  return {
    projectName: typeof v.projectName === 'string' ? v.projectName : '',
    entry: typeof v.entry === 'string' ? v.entry : '',
    files,
    openTabs,
    activeTab,
    snapshots,
  };
}

/** 未知数据 → ProjectRecord；id/name/snapshot 缺失或非法返回 null（该条弃用，不影响其余） */
function sanitizeRecord(raw: unknown): ProjectRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) return null;
  if (typeof v.name !== 'string' || !v.name) return null;
  const snapshot = sanitizeSnapshot(v.snapshot);
  if (!snapshot) return null;
  const savedAt = typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) ? v.savedAt : 0;
  // dir 为可选新字段：旧记录缺失照常工作；非法值（非字符串/空串）静默丢弃
  const dir = typeof v.dir === 'string' && v.dir.trim() ? v.dir.trim() : undefined;
  return dir ? { id: v.id, name: v.name, savedAt, snapshot, dir } : { id: v.id, name: v.name, savedAt, snapshot };
}

// ---------------------------------------------------------------------------
// 持久化（localStorage sf-projects）
// ---------------------------------------------------------------------------

function readPersisted(): ProjectRecord[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeRecord).filter((p): p is ProjectRecord => p !== null);
  } catch {
    return [];
  }
}

function persist(records: ProjectRecord[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(records));
    }
  } catch {
    /* 持久化失败（如配额超限）不打断 UI */
  }
}

/** 正式记录超出上限时挤掉最旧（savedAt 最小；并列时取数组中更靠后者=更早入库）；__current__ 不参与 */
function evictToCap(records: ProjectRecord[]): ProjectRecord[] {
  let next = records;
  const formalCount = () => next.reduce((n, p) => (p.id === CURRENT_PROJECT_ID ? n : n + 1), 0);
  while (formalCount() > MAX_PROJECTS) {
    let oldest = -1;
    for (let i = 0; i < next.length; i++) {
      const p = next[i]!;
      if (p.id === CURRENT_PROJECT_ID) continue;
      if (oldest === -1 || p.savedAt <= next[oldest]!.savedAt) oldest = i;
    }
    if (oldest === -1) break;
    next = next.filter((_, i) => i !== oldest);
  }
  return next;
}

/** 保存/转正式共用的 upsert：同名（正式记录间）覆盖，否则新建置顶；返回记录 id。
 *  dir 取当前工作区的 projectDir（未绑定为 undefined）；同名覆盖时工作区未绑定目录则保留旧记录的绑定。 */
function upsertFormalIn(
  list: ProjectRecord[],
  name: string,
  snapshot: ProjectSnapshot,
  dir: string | undefined,
): { projects: ProjectRecord[]; id: string } {
  const trimmed = name.trim() || FALLBACK_NAME;
  const savedAt = Date.now();
  const formal = list.filter((p) => p.id !== CURRENT_PROJECT_ID);
  const existingIdx = formal.findIndex((p) => p.name === trimmed);
  let next: ProjectRecord[];
  let id: string;
  if (existingIdx >= 0) {
    const target = formal[existingIdx]!;
    id = target.id;
    const nextDir = dir ?? target.dir;
    next = formal.map((p, i) =>
      i === existingIdx ? { ...p, savedAt, snapshot: cloneSnapshot(snapshot), dir: nextDir } : p,
    );
  } else {
    id = createId();
    next = [{ id, name: trimmed, savedAt, snapshot: cloneSnapshot(snapshot), ...(dir ? { dir } : {}) }, ...formal];
  }
  return { projects: evictToCap(next), id };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProjectsStore = create<ProjectsState>()((set, get) => ({
  projects: readPersisted(),

  saveCurrent(name) {
    const ws = useWorkspaceStore.getState();
    const { projects, id } = upsertFormalIn(get().projects, name ?? ws.projectName, snapshotOf(ws), ws.projectDir ?? undefined);
    // 正式入库后保留崩溃恢复临时记录（仅 promoteCurrent 会消费它）
    const temp = get().projects.find((p) => p.id === CURRENT_PROJECT_ID);
    set({ projects: temp ? [temp, ...projects] : projects });
    return id;
  },

  openProject(id) {
    if (id === CURRENT_PROJECT_ID) return false;
    const rec = get().projects.find((p) => p.id === id);
    if (!rec) return false;
    const snap = cloneSnapshot(rec.snapshot);
    // loadProject 恢复文件集（含本地目录绑定）；随后补齐保存时的页签与文件快照（loadProject 自身会重置这两者）
    useWorkspaceStore.getState().loadProject(snap.projectName || rec.name, snap.entry, { ...snap.files }, rec.dir ?? null);
    useWorkspaceStore.setState({
      openTabs: snap.openTabs.filter((p) => p in snap.files),
      activeTab: snap.activeTab !== null && snap.activeTab in snap.files ? snap.activeTab : null,
      snapshots: snap.snapshots,
    });
    // 切换后临时快照已过期（当前工作区即被打开的项目，重新打开切换器时会再生成）
    set((s) =>
      s.projects.some((p) => p.id === CURRENT_PROJECT_ID)
        ? { projects: s.projects.filter((p) => p.id !== CURRENT_PROJECT_ID) }
        : s,
    );
    return true;
  },

  removeProject(id) {
    set((s) => ({ projects: s.projects.filter((p) => p.id !== id) }));
  },

  renameProject(id, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((s) => ({
      projects: s.projects.map((p) =>
        p.id === id ? { ...p, name: trimmed, snapshot: { ...p.snapshot, projectName: trimmed } } : p,
      ),
    }));
  },

  duplicateProject(id) {
    const src = get().projects.find((p) => p.id === id);
    if (!src) return null;
    const copy: ProjectRecord = {
      id: createId(),
      name: `${src.name} 副本`,
      savedAt: Date.now(),
      snapshot: cloneSnapshot(src.snapshot),
      ...(src.dir ? { dir: src.dir } : {}),
    };
    set({ projects: evictToCap([copy, ...get().projects]) });
    return copy.id;
  },

  saveCurrentTemp() {
    const ws = useWorkspaceStore.getState();
    const temp: ProjectRecord = {
      id: CURRENT_PROJECT_ID,
      name: ws.projectName.trim() || FALLBACK_NAME,
      savedAt: Date.now(),
      snapshot: snapshotOf(ws),
      ...(ws.projectDir ? { dir: ws.projectDir } : {}),
    };
    set((s) => ({ projects: [temp, ...s.projects.filter((p) => p.id !== CURRENT_PROJECT_ID)] }));
  },

  promoteCurrent() {
    const temp = get().projects.find((p) => p.id === CURRENT_PROJECT_ID);
    if (!temp) return null;
    const { projects, id } = upsertFormalIn(get().projects, temp.name, temp.snapshot, temp.dir);
    set({ projects });
    return id;
  },
}));

useProjectsStore.subscribe((s) => persist(s.projects));
