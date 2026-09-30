/**
 * PDF 标注持久化：按「文件名:字节数」为键存 localStorage（sf-pdf-annotations）。
 * 同一 PDF 重新打开时恢复标注。
 */

import { create } from 'zustand';
import type { Annotation } from '@scholarforge/shared';

const STORAGE_KEY = 'sf-pdf-annotations';

type AnnotationMap = Record<string, Annotation[]>;

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
  add(fileKey: string, annotation: Annotation): void;
  remove(fileKey: string, id: string): void;
  clear(fileKey: string): void;
}

export const useAnnotationStore = create<AnnotationState>((set) => ({
  byFile: readPersisted(),

  add(fileKey, annotation) {
    set((s) => ({
      byFile: { ...s.byFile, [fileKey]: [...(s.byFile[fileKey] ?? []), annotation] },
    }));
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
