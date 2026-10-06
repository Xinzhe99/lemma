/**
 * PDF 标注持久化：按文件为键存 localStorage（sf-pdf-annotations）。
 * 同一 PDF 重新打开时恢复标注。
 *
 * 两种键控规则（WF-4 L2）：
 * - 自由打开的 PDF（App 层文件选择器）：`pdf:{文件名}`（既有规则，保持兼容）；
 * - 库内条目关联的 PDF：`paper:{paperId}`——同一文献无论重开多少次，键不变，标注稳定恢复。
 *
 * 集成契约（App 层接线）：
 * 1. libraryStore.openPdf(paperId) 打开时自动调用 bindPdfName(`${citekey}.pdf`, paperId)；
 * 2. App 渲染 PdfReader 时，读标注与 onCreateAnnotation/onDeleteAnnotation 落库
 *    统一用 resolveKey(pdfView.name) 取键（已绑定 → `paper:{paperId}`，否则 `pdf:{name}`）；
 * 3. 已绑定文献的 PDF，标注的 paperId 字段建议写真实 paperId（resolveKey 已暴露 paperIdOf）。
 */

import { create } from 'zustand';
import type { Annotation } from '@lemma/shared';

const STORAGE_KEY = 'sf-pdf-annotations';

type AnnotationMap = Record<string, Annotation[]>;

/** 库内条目 PDF 的标注键。 */
export function paperAnnotationKey(paperId: string): string {
  return `paper:${paperId}`;
}

/** 自由打开 PDF 的标注键（与 App 既有 pdfFileKey 规则一致）。 */
export function pdfFileNameKey(pdfName: string): string {
  return `pdf:${pdfName}`;
}

function readPersisted(): AnnotationMap {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const v = JSON.parse(raw) as AnnotationMap;
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

interface AnnotationState {
  byFile: AnnotationMap;
  /** PDF 文件名 → 已绑定文献 id（内存态；重启后由库内再次打开重建）。 */
  boundPaperId: Record<string, string>;
  /** 库内 PDF 打开时登记文件名 → paperId 绑定。 */
  bindPdfName(pdfName: string, paperId: string): void;
  /** 解除绑定（删除文献/附件时调用）。 */
  unbindPdfName(pdfName: string): void;
  /** 集成契约：取某 PDF 的标注键（已绑定文献用 paper:{id}，否则沿用 pdf:{name}）。 */
  resolveKey(pdfName: string): string;
  /** 集成契约：取某 PDF 绑定的 paperId（未绑定返回 undefined）。 */
  paperIdOf(pdfName: string): string | undefined;
  /** 按 paperId 读取标注（按页码、创建时间升序，供标注侧栏用）。 */
  annotationsForPaper(paperId: string): Annotation[];
  add(fileKey: string, annotation: Annotation): void;
  remove(fileKey: string, id: string): void;
  /** v5.7.0 审阅往返：勾销/恢复一条批注（幂等） */
  setResolved(fileKey: string, id: string, resolved: boolean): void;
  clear(fileKey: string): void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
  byFile: readPersisted(),
  boundPaperId: {},

  bindPdfName(pdfName, paperId) {
    set((s) => ({ boundPaperId: { ...s.boundPaperId, [pdfName]: paperId } }));
  },

  unbindPdfName(pdfName) {
    set((s) => {
      if (!(pdfName in s.boundPaperId)) return s;
      const boundPaperId = { ...s.boundPaperId };
      delete boundPaperId[pdfName];
      return { boundPaperId };
    });
  },

  resolveKey(pdfName) {
    const paperId = get().boundPaperId[pdfName];
    return paperId !== undefined ? paperAnnotationKey(paperId) : pdfFileNameKey(pdfName);
  },

  paperIdOf(pdfName) {
    return get().boundPaperId[pdfName];
  },

  annotationsForPaper(paperId) {
    return [...(get().byFile[paperAnnotationKey(paperId)] ?? [])].sort(
      (a, b) => a.page - b.page || a.createdAt - b.createdAt,
    );
  },

  add(fileKey, annotation) {
    set((s) => ({
      byFile: { ...s.byFile, [fileKey]: [...(s.byFile[fileKey] ?? []), annotation] },
    }));
  },

  setResolved(fileKey, id, resolved) {
    set((s) => {
      const list = s.byFile[fileKey];
      if (!list) return s;
      return {
        byFile: {
          ...s.byFile,
          [fileKey]: list.map((a) => (a.id === id ? { ...a, resolved } : a)),
        },
      };
    });
  },

  remove(fileKey, id) {
    set((s) => ({
      byFile: {
        ...s.byFile,
        [fileKey]: (s.byFile[fileKey] ?? []).filter((a) => a.id !== id),
      },
    }));
  },

  clear(fileKey) {
    set((s) => {
      const byFile = { ...s.byFile };
      delete byFile[fileKey];
      return { byFile };
    });
  },
}));

useAnnotationStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s.byFile));
    }
  } catch {
    /* 忽略持久化失败 */
  }
});
