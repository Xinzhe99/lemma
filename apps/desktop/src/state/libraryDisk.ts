/**
 * 本地文献库磁盘镜像（v7.6.0）：
 * PDF 附件此前只存 IndexedDB，用户在磁盘上找不到「本地文献库」。本模块把附件
 * 镜像为应用数据目录下的普通文件（默认 library/papers/<citekey>.pdf），目录名
 * 可在设置中修改（相对应用数据目录），修改时自动迁移已有文件；启动时把历史
 * 附件（仅 IndexedDB 的旧数据）补写上盘，重启后经磁盘回填内存——软件始终知道
 * 自己的文献库位置并能重新关联。
 * 浏览器形态无磁盘，全部操作静默跳过（IndexedDB 仍是那边的持久层）。
 */
import { getPlatform } from '../platform/types';
import { tauriReadBase64, tauriWriteFileBase64 } from '../platform/tauri';
import { useSettingsStore } from './settingsStore';

export const DEFAULT_LIBRARY_DIR = 'library';

/** 当前文献库目录（相对应用数据目录；取设置值，空值回落默认） */
export function currentLibraryDir(): string {
  const dir = useSettingsStore.getState().libraryDir?.trim();
  return dir && dir.length > 0 ? dir.replace(/^\/+|\/+$/g, '') : DEFAULT_LIBRARY_DIR;
}

/** 附件在磁盘上的路径（<libraryDir>/papers/<name>） */
export function paperPdfDiskPath(name: string, dir = currentLibraryDir()): string {
  return `${dir}/papers/${name}`;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  const arr = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function isDesktop(): boolean {
  return getPlatform().kind === 'tauri';
}

/** 把附件字节写入磁盘镜像（fire-and-forget 的调用方包裹告警） */
export async function mirrorPdfToDisk(name: string, bytes: ArrayBuffer, dir = currentLibraryDir()): Promise<void> {
  if (!isDesktop()) return;
  await tauriWriteFileBase64(paperPdfDiskPath(name, dir), bytesToBase64(bytes));
}

/** 从磁盘镜像读回附件字节；无文件/非桌面返回 null */
export async function readPdfFromDisk(name: string, dir = currentLibraryDir()): Promise<ArrayBuffer | null> {
  if (!isDesktop()) return null;
  try {
    const bytes = await tauriReadBase64(paperPdfDiskPath(name, dir));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function diskFileExists(path: string): Promise<boolean> {
  try {
    const all = await getPlatform().fs.list();
    return all.includes(path);
  } catch {
    return false;
  }
}

/**
 * 启动补写：把「有附件但磁盘还没有文件」的旧数据（历史 IndexedDB-only 附件）
 * 一次性镜像上盘。源优先内存，其次 IndexedDB（由调用方传入取数函数避免循环依赖）。
 */
export async function sweepAttachmentsToDisk(
  papers: Array<{ id: string; citekey: string; pdfPath?: string }>,
  getBytes: (paperId: string) => Promise<ArrayBuffer | null>,
): Promise<number> {
  if (!isDesktop()) return 0;
  let written = 0;
  for (const paper of papers) {
    if (!paper.pdfPath) continue;
    const name = paper.citekey || paper.id;
    const path = paperPdfDiskPath(`${name}.pdf`);
    if (await diskFileExists(path)) continue;
    const bytes = await getBytes(paper.id);
    if (!bytes) continue;
    try {
      await mirrorPdfToDisk(`${name}.pdf`, bytes);
      written++;
    } catch (e) {
      console.warn('[library] 附件上盘失败：', name, e);
    }
  }
  return written;
}

export interface RelocateResult {
  moved: number;
  failed: number;
  error?: string;
}

/** 迁移文献库到新目录：逐附件从旧位置读出写入新位置，成功后删旧文件。 */
export async function relocateLibrary(newDirRaw: string, papers: Array<{ id: string; citekey: string; pdfPath?: string }>, getBytes: (paperId: string) => Promise<ArrayBuffer | null>): Promise<RelocateResult> {
  if (!isDesktop()) return { moved: 0, failed: 0, error: '浏览器形态无本地磁盘' };
  const newDir = newDirRaw.trim().replace(/^\/+|\/+$/g, '');
  if (!newDir || /[\/:*?"<>|]/.test(newDir)) {
    return { moved: 0, failed: 0, error: '目录名不能为空且不能包含 \ / : * ? " < > | 等字符' };
  }
  const oldDir = currentLibraryDir();
  if (newDir === oldDir) return { moved: 0, failed: 0 };
  let moved = 0;
  let failed = 0;
  for (const paper of papers) {
    if (!paper.pdfPath) continue;
    const name = `${paper.citekey || paper.id}.pdf`;
    try {
      let bytes = await readPdfFromDisk(name, oldDir);
      if (!bytes) bytes = await getBytes(paper.id);
      if (!bytes) {
        failed++;
        continue;
      }
      await mirrorPdfToDisk(name, bytes, newDir);
      await getPlatform().fs.deleteFile(paperPdfDiskPath(name, oldDir)).catch(() => undefined);
      moved++;
    } catch {
      failed++;
    }
  }
  return { moved, failed };
}
