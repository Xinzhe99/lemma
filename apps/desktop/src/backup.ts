/**
 * 全量备份/恢复的纯函数层（WS-F 应用设施）：
 *  - buildBackup：各 store 快照 → 统一备份文件结构（schema/version/exportedAt/data）；
 *  - validateBackup：未知 JSON → 结构校验（schema、version、核心字段存在性），坏文件安全拒绝；
 *  - stripSecrets：设置快照脱敏——providers[].apiKey 一律置空串，API key 永不进备份。
 *
 * 全部纯函数、无副作用（浅拷贝输入，不改调用方数据），可独立测试。
 */

export const BACKUP_SCHEMA = 'lemma-backup';
export const BACKUP_VERSION = 1;

/** 工作区快照（workspaceStore 的持久化子集；snapshots 为文件历史快照表） */
export interface BackupWorkspace {
  projectName: string;
  entry: string;
  files: Record<string, string>;
  snapshots?: unknown;
}

/** 备份内保留的设置子集——注意：不含 providers（API key 永不进备份） */
export interface BackupSettings {
  embeddingModel?: string;
  theme?: string;
  language?: string;
}

export interface BackupData {
  library: { papers: unknown[] };
  knowledge: { notes: unknown[]; annotationsByFile: Record<string, unknown[]> };
  projects: unknown[];
  workspace: BackupWorkspace;
  settings: BackupSettings;
}

export interface BackupFile {
  schema: typeof BACKUP_SCHEMA;
  version: typeof BACKUP_VERSION;
  exportedAt: string;
  data: BackupData;
}

export interface BuildBackupInput {
  papers: unknown[];
  notes: unknown[];
  annotationsByFile: Record<string, unknown[]>;
  projects: unknown[];
  workspace: BackupWorkspace;
  embeddingModel?: string;
  theme?: string;
  language?: string;
}

/**
 * 组装备份文件。exportedAt 为 ISO 时间串；输入仅做浅拷贝，
 * 组装结果与传入数组/对象不共享顶层引用（导出后改动互不影响）。
 */
export function buildBackup(input: BuildBackupInput): BackupFile {
  return {
    schema: BACKUP_SCHEMA,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      library: { papers: [...input.papers] },
      knowledge: {
        notes: [...input.notes],
        annotationsByFile: { ...input.annotationsByFile },
      },
      projects: [...input.projects],
      workspace: {
        projectName: input.workspace.projectName,
        entry: input.workspace.entry,
        files: { ...input.workspace.files },
        ...(input.workspace.snapshots !== undefined
          ? { snapshots: input.workspace.snapshots }
          : {}),
      },
      settings: {
        embeddingModel: input.embeddingModel,
        theme: input.theme,
        language: input.language,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

export type ValidateBackupResult =
  | { ok: true; backup: BackupFile }
  | { ok: false; error: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 校验备份 JSON（已 parse 的值）：
 * 1) 顶层必须是对象且 schema === 'lemma-backup'；
 * 2) version 必须为 1（数字）；
 * 3) exportedAt 必须是字符串；
 * 4) 核心字段存在且形状正确：data.library.papers / data.knowledge.notes /
 *    data.knowledge.annotationsByFile / data.projects / data.workspace.{projectName,entry,files}。
 * settings 为可选节（存在时必须是对象），宽容旧/精简备份。
 */
export function validateBackup(json: unknown): ValidateBackupResult {
  if (!isPlainObject(json)) return { ok: false, error: '备份文件不是 JSON 对象' };
  if (json.schema !== BACKUP_SCHEMA) {
    return { ok: false, error: `schema 不符：期望 "${BACKUP_SCHEMA}"` };
  }
  if (json.version !== BACKUP_VERSION) {
    return { ok: false, error: `version 不符：期望 ${BACKUP_VERSION}，实际 ${String(json.version)}` };
  }
  if (typeof json.exportedAt !== 'string' || !json.exportedAt) {
    return { ok: false, error: 'exportedAt 缺失或不是字符串' };
  }
  const data = json.data;
  if (!isPlainObject(data)) return { ok: false, error: '缺少 data 对象' };

  const library = data.library;
  if (!isPlainObject(library) || !Array.isArray(library.papers)) {
    return { ok: false, error: '缺少核心字段：data.library.papers' };
  }
  const knowledge = data.knowledge;
  if (!isPlainObject(knowledge) || !Array.isArray(knowledge.notes)) {
    return { ok: false, error: '缺少核心字段：data.knowledge.notes' };
  }
  if (!isPlainObject(knowledge.annotationsByFile)) {
    return { ok: false, error: '缺少核心字段：data.knowledge.annotationsByFile' };
  }
  if (!Array.isArray(data.projects)) {
    return { ok: false, error: '缺少核心字段：data.projects' };
  }
  const workspace = data.workspace;
  if (!isPlainObject(workspace)) return { ok: false, error: '缺少核心字段：data.workspace' };
  if (typeof workspace.projectName !== 'string') {
    return { ok: false, error: '缺少核心字段：data.workspace.projectName' };
  }
  if (typeof workspace.entry !== 'string') {
    return { ok: false, error: '缺少核心字段：data.workspace.entry' };
  }
  if (!isPlainObject(workspace.files)) {
    return { ok: false, error: '缺少核心字段：data.workspace.files' };
  }
  if (data.settings !== undefined && !isPlainObject(data.settings)) {
    return { ok: false, error: 'data.settings 存在时必须是对象' };
  }

  return { ok: true, backup: json as unknown as BackupFile };
}

// ---------------------------------------------------------------------------
// 脱敏
// ---------------------------------------------------------------------------

/** stripSecrets 可接受的最小设置形状（真实入参为 settingsStore 快照的超集） */
export interface SecretfulSettings {
  providers?: Array<{ apiKey: string }>;
}

/**
 * 设置快照脱敏：返回同形状的新对象，providers[].apiKey → ''（空串）。
 * API key 永不进备份；无 providers 时原样（浅）拷贝返回。
 */
export function stripSecrets<T extends object>(settings: T): T {
  const providers = (settings as SecretfulSettings).providers;
  if (!Array.isArray(providers)) return { ...settings };
  return {
    ...settings,
    providers: providers.map((p) => ({ ...p, apiKey: '' })),
  } as T;
}
