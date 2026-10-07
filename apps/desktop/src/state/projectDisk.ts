/**
 * 项目 ↔ 本地磁盘目录的桥（「新建项目选择本地路径」）：
 * - materializeProjectToDisk：把 files map 物化到用户选择的目录（复用编译物化的
 *   逐文件写入方式，但走显式的 fs_write_absolute 绝对路径命令——相对路径命令族的
 *   safe_rel 拒绝绝对路径，见 lib.rs）；
 * - probeDirWritable：写探针文件再删，验证目录可写（文件夹选择器不可用时的手输路径校验）；
 * - openProjectWithDiskSync：打开项目后与磁盘增量合并——磁盘有而记录无的文件并入、
 *   磁盘比记录新（mtime > savedAt）的文件以磁盘为准；返回合并/更新清单供 UI 提示。
 *
 * 仅桌面形态（platform kind === 'tauri'）实际访问磁盘；浏览器形态跳过并如实返回。
 * figures/ 空串占位（initWorkspace 的二进制图片标记）不参与文本物化，避免覆盖真实图片。
 */

import type { ProjectRecord } from './projectsStore';
import { useProjectsStore } from './projectsStore';
import { useWorkspaceStore } from './workspaceStore';
import { getPlatform } from '../platform/types';
import {
  tauriDeleteProjectFile,
  tauriReadProjectFile,
  tauriScanProjectDir,
  tauriWriteProjectFile,
} from '../platform/tauri';

/** 参与文本合并/物化的扩展名白名单（与编辑器 TEXT 语义一致；二进制不读写） */
const TEXT_EXT = /\.(tex|bib|md|txt|sty|cls|bst)$/i;
/** 写探针文件名（验证目录可写后立即删除） */
const PROBE_FILE = '.lemma-write-probe.tmp';

export function isDesktopKind(): boolean {
  return getPlatform().kind === 'tauri';
}

/**
 * 物化项目文本文件到本地目录；返回写入文件数。
 * 跳过非字符串值与 figures/ 空串占位（真实图片在数据目录，写空串会覆盖）。
 */
export async function materializeProjectToDisk(
  dir: string,
  files: Record<string, string>,
): Promise<number> {
  let count = 0;
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue; // 二进制文件不参与文本物化
    if (content === '' && path.startsWith('figures/')) continue; // 图片占位不落盘
    await tauriWriteProjectFile(dir, path, content);
    count++;
  }
  return count;
}

/** 目录可写探针：写一个隐藏探针文件再删除；不可写（权限/盘符无效）时抛错 */
export async function probeDirWritable(dir: string): Promise<void> {
  await tauriWriteProjectFile(dir, PROBE_FILE, 'probe');
  try {
    await tauriDeleteProjectFile(dir, PROBE_FILE);
  } catch {
    /* 探针清理失败不判死：目录本身可写 */
  }
}

/** 磁盘同步结果：merged = 磁盘有而记录无（并入）；updated = 磁盘比记录新（以磁盘为准） */
export interface DiskSyncResult {
  merged: string[];
  updated: string[];
}

/**
 * 与磁盘增量合并：扫描 dir，对文本文件做两路比对后并入当前工作区（不改页签）。
 * dir 为空 / 非桌面形态 / 扫描失败（目录被删等）→ 返回 null（调用方静默跳过提示）。
 */
export async function syncProjectFromDisk(
  dir: string | null | undefined,
  savedAt: number,
): Promise<DiskSyncResult | null> {
  if (!dir || !isDesktopKind()) return null;
  let entries: { path: string; mtimeMs: number }[];
  try {
    entries = await tauriScanProjectDir(dir);
  } catch {
    return null; // 目录不存在/不可读：不阻塞打开项目
  }
  const ws = useWorkspaceStore.getState();
  const merged: string[] = [];
  const updated: string[] = [];
  const filesPatch: Record<string, string> = {};
  for (const entry of entries) {
    if (!TEXT_EXT.test(entry.path)) continue;
    if (!(entry.path in ws.files)) {
      try {
        filesPatch[entry.path] = await tauriReadProjectFile(dir, entry.path);
        merged.push(entry.path);
      } catch {
        /* 单文件读取失败跳过 */
      }
    } else if (entry.mtimeMs > savedAt) {
      try {
        filesPatch[entry.path] = await tauriReadProjectFile(dir, entry.path);
        updated.push(entry.path);
      } catch {
        /* 单文件读取失败跳过 */
      }
    }
  }
  if (merged.length === 0 && updated.length === 0) return { merged, updated };
  useWorkspaceStore.setState((s) => ({ files: { ...s.files, ...filesPatch } }));
  return { merged, updated };
}

/**
 * 打开项目（projectsStore.openProject）并在其绑定目录上做磁盘同步合并。
 * 返回 false = 打开失败（id 不存在）；成功时返回合并摘要（可能为空清单，null = 无目录/非桌面）。
 */
export async function openProjectWithDiskSync(
  id: string,
): Promise<{ opened: true; sync: DiskSyncResult | null } | { opened: false }> {
  const rec = useProjectsStore.getState().projects.find((p) => p.id === id);
  const ok = useProjectsStore.getState().openProject(id);
  if (!ok) return { opened: false };
  // openProject 后当前工作区即该项目：dir 与 savedAt 以记录为准
  const record = useProjectsStore.getState().projects.find((p) => p.id === id) ?? rec;
  const sync = await syncProjectFromDisk(record?.dir, rec?.savedAt ?? Date.now());
  return { opened: true, sync };
}
