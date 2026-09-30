/**
 * 卡片笔记状态（设计 4.7 知识底座）：CRUD、[[双链]] 目标同步、localStorage 持久化（sf-notes）。
 * PDF 标注转卡片（@scholarforge/knowledge 的 createNoteFromAnnotation）也经此 store 落库。
 */

import { create } from 'zustand';
import { createId, type Annotation, type Note } from '@scholarforge/shared';
import { createNoteFromAnnotation, parseWikilinks, type PaperRef } from '@scholarforge/knowledge';

export const NOTES_STORAGE_KEY = 'sf-notes';

export interface NoteInput {
  title: string;
  bodyMd: string;
}

function isNote(v: unknown): v is Note {
  if (!v || typeof v !== 'object') return false;
  const n = v as Partial<Note>;
  return (
    typeof n.id === 'string' &&
    typeof n.title === 'string' &&
    typeof n.bodyMd === 'string' &&
    Array.isArray(n.links) &&
    typeof n.createdAt === 'number' &&
    typeof n.updatedAt === 'number'
  );
}

function readPersisted(): Note[] {
  try {
    const raw =
      typeof localStorage === 'undefined' ? null : localStorage.getItem(NOTES_STORAGE_KEY);
    if (!raw) return [];
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter(isNote) : [];
  } catch {
    return [];
  }
}

interface NotesState {
  /** 新建在最前 */
  notes: Note[];
  addNote(input: NoteInput): Note;
  /** PDF 标注 → 卡片（正文自带出处脚注，含页码） */
  addNoteFromAnnotation(annotation: Annotation, paper?: PaperRef): Note;
  updateNote(id: string, patch: Partial<NoteInput>): void;
  removeNote(id: string): void;
}

export const useNotesStore = create<NotesState>((set) => ({
  notes: readPersisted(),

  addNote(input) {
    const now = Date.now();
    const title = input.title.trim();
    const note: Note = {
      id: createId(),
      title: title.length > 0 ? title : '未命名卡片',
      bodyMd: input.bodyMd,
      links: parseWikilinks(input.bodyMd),
      createdAt: now,
      updatedAt: now,
    };
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  addNoteFromAnnotation(annotation, paper) {
    const note = createNoteFromAnnotation(
      {
        id: annotation.id,
        text: annotation.text,
        quotedText: annotation.quotedText,
        paperId: annotation.paperId,
        page: annotation.page,
      },
      paper,
    );
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  updateNote(id, patch) {
    set((s) => ({
      notes: s.notes.map((n) => {
        if (n.id !== id) return n;
        const nextTitle =
          patch.title !== undefined ? patch.title.trim() : n.title;
        const nextBody = patch.bodyMd !== undefined ? patch.bodyMd : n.bodyMd;
        return {
          ...n,
          title: nextTitle.length > 0 ? nextTitle : n.title,
          bodyMd: nextBody,
          links: parseWikilinks(nextBody),
          updatedAt: Date.now(),
        };
      }),
    }));
  },

  removeNote(id) {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },
}));

useNotesStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(NOTES_STORAGE_KEY, JSON.stringify(s.notes));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});
