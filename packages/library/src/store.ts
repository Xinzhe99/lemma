import Dexie, { type Table } from 'dexie';
import type { Annotation, Collection, Note, Paper } from '@lemma/shared';

/**
 * 文献库存储接口：MemoryStore 供测试与纯内存场景，DexieStore 供应用端 IndexedDB 持久化。
 * 约定：listPapers / listNotes 按创建时间倒序；listAnnotations 按页码、再按创建时间升序。
 */
export interface LibraryStore {
  addPaper(paper: Paper): Promise<void>;
  updatePaper(paper: Paper): Promise<void>;
  /** 同时删除该文献下的全部标注 */
  deletePaper(id: string): Promise<void>;
  getPaper(id: string): Promise<Paper | undefined>;
  listPapers(): Promise<Paper[]>;

  createCollection(collection: Collection): Promise<void>;
  updateCollection(collection: Collection): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  getCollection(id: string): Promise<Collection | undefined>;
  listCollections(): Promise<Collection[]>;

  addAnnotation(annotation: Annotation): Promise<void>;
  listAnnotations(paperId: string): Promise<Annotation[]>;

  addNote(note: Note): Promise<void>;
  listNotes(): Promise<Note[]>;
}

function sortPapers(papers: Paper[]): Paper[] {
  return [...papers].sort((a, b) => b.addedAt - a.addedAt);
}

function sortAnnotations(annotations: Annotation[]): Annotation[] {
  return [...annotations].sort((a, b) => a.page - b.page || a.createdAt - b.createdAt);
}

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => b.createdAt - a.createdAt);
}

/** 纯内存实现：测试与无持久化场景使用。 */
export class MemoryStore implements LibraryStore {
  private readonly papers = new Map<string, Paper>();
  private readonly collections = new Map<string, Collection>();
  private readonly annotations = new Map<string, Annotation>();
  private readonly notes = new Map<string, Note>();

  async addPaper(paper: Paper): Promise<void> {
    if (this.papers.has(paper.id)) throw new Error(`文献已存在：${paper.id}`);
    this.papers.set(paper.id, { ...paper });
  }

  async updatePaper(paper: Paper): Promise<void> {
    if (!this.papers.has(paper.id)) throw new Error(`文献不存在：${paper.id}`);
    this.papers.set(paper.id, { ...paper });
  }

  async deletePaper(id: string): Promise<void> {
    this.papers.delete(id);
    for (const [key, annotation] of this.annotations) {
      if (annotation.paperId === id) this.annotations.delete(key);
    }
  }

  async getPaper(id: string): Promise<Paper | undefined> {
    const paper = this.papers.get(id);
    return paper ? { ...paper } : undefined;
  }

  async listPapers(): Promise<Paper[]> {
    return sortPapers([...this.papers.values()].map(p => ({ ...p })));
  }

  async createCollection(collection: Collection): Promise<void> {
    if (this.collections.has(collection.id)) throw new Error(`集合已存在：${collection.id}`);
    this.collections.set(collection.id, { ...collection });
  }

  async updateCollection(collection: Collection): Promise<void> {
    if (!this.collections.has(collection.id)) throw new Error(`集合不存在：${collection.id}`);
    this.collections.set(collection.id, { ...collection });
  }

  async deleteCollection(id: string): Promise<void> {
    this.collections.delete(id);
  }

  async getCollection(id: string): Promise<Collection | undefined> {
    const collection = this.collections.get(id);
    return collection ? { ...collection } : undefined;
  }

  async listCollections(): Promise<Collection[]> {
    return [...this.collections.values()].map(c => ({ ...c }));
  }

  async addAnnotation(annotation: Annotation): Promise<void> {
    if (this.annotations.has(annotation.id)) throw new Error(`标注已存在：${annotation.id}`);
    this.annotations.set(annotation.id, { ...annotation });
  }

  async listAnnotations(paperId: string): Promise<Annotation[]> {
    return sortAnnotations(
      [...this.annotations.values()].filter(a => a.paperId === paperId).map(a => ({ ...a })),
    );
  }

  async addNote(note: Note): Promise<void> {
    if (this.notes.has(note.id)) throw new Error(`笔记已存在：${note.id}`);
    this.notes.set(note.id, { ...note });
  }

  async listNotes(): Promise<Note[]> {
    return sortNotes([...this.notes.values()].map(n => ({ ...n })));
  }
}

/** IndexedDB schema v1：papers/collections/annotations/notes 四表，papers 带 citekey 索引。 */
export class LibraryDatabase extends Dexie {
  papers!: Table<Paper, string>;
  collections!: Table<Collection, string>;
  annotations!: Table<Annotation, string>;
  notes!: Table<Note, string>;

  constructor(name = 'lemma-library') {
    super(name);
    this.version(1).stores({
      papers: 'id, citekey',
      collections: 'id',
      annotations: 'id, paperId',
      notes: 'id',
    });
  }
}

/** IndexedDB 持久化实现（浏览器环境使用）。 */
export class DexieStore implements LibraryStore {
  private readonly db: LibraryDatabase;

  constructor(nameOrDb: string | LibraryDatabase = 'lemma-library') {
    this.db = typeof nameOrDb === 'string' ? new LibraryDatabase(nameOrDb) : nameOrDb;
  }

  async addPaper(paper: Paper): Promise<void> {
    await this.db.papers.add(paper);
  }

  async updatePaper(paper: Paper): Promise<void> {
    await this.db.papers.put(paper);
  }

  async deletePaper(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.papers, this.db.annotations, async () => {
      await this.db.papers.delete(id);
      await this.db.annotations.where('paperId').equals(id).delete();
    });
  }

  async getPaper(id: string): Promise<Paper | undefined> {
    return this.db.papers.get(id);
  }

  async listPapers(): Promise<Paper[]> {
    return sortPapers(await this.db.papers.toArray());
  }

  async createCollection(collection: Collection): Promise<void> {
    await this.db.collections.add(collection);
  }

  async updateCollection(collection: Collection): Promise<void> {
    await this.db.collections.put(collection);
  }

  async deleteCollection(id: string): Promise<void> {
    await this.db.collections.delete(id);
  }

  async getCollection(id: string): Promise<Collection | undefined> {
    return this.db.collections.get(id);
  }

  async listCollections(): Promise<Collection[]> {
    return this.db.collections.toArray();
  }

  async addAnnotation(annotation: Annotation): Promise<void> {
    await this.db.annotations.add(annotation);
  }

  async listAnnotations(paperId: string): Promise<Annotation[]> {
    return sortAnnotations(await this.db.annotations.where('paperId').equals(paperId).toArray());
  }

  async addNote(note: Note): Promise<void> {
    await this.db.notes.add(note);
  }

  async listNotes(): Promise<Note[]> {
    return sortNotes(await this.db.notes.toArray());
  }
}

/** 打开（或创建）一个 Dexie 存储实例。 */
export function openDexieStore(name = 'lemma-library'): DexieStore {
  return new DexieStore(name);
}
