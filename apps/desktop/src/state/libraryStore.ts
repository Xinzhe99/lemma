/**
 * 文献库应用层状态：条目 CRUD、BibTeX/DOI/arXiv 导入、citekey 生成消歧，
 * 以及知识索引（分块 + 本地哈希嵌入 + 混合检索），供 RAG 与 Context Pack 使用。
 *
 * 持久化：papers 以 JSON 存 localStorage（sf-library）；知识索引每次启动重建。
 */

import { create } from 'zustand';
import {
  createId,
  type Paper,
  type ReadStatus,
  type RetrievedChunk,
} from '@scholarforge/shared';
import {
  parseBibtex,
  generateCitekey,
  disambiguateCitekey,
  fetchByDoi,
  fetchByArxiv,
} from '@scholarforge/library';
import { chunkPaper, HashEmbeddingProvider, HybridRetriever } from '@scholarforge/knowledge';

const STORAGE_KEY = 'sf-library';

export interface CitedRetrievedChunk extends RetrievedChunk {
  citekey?: string;
}

interface LibraryState {
  papers: Paper[];
  /** 知识索引是否已构建完成（后台异步） */
  indexReady: boolean;
  importBibtex(text: string): { added: number; errors: string[] };
  fetchMetadata(kind: 'doi' | 'arxiv', id: string): Promise<{ ok: true; paper: Paper } | { ok: false; error: string }>;
  removePaper(id: string): void;
  setReadStatus(id: string, status: ReadStatus): void;
  searchKnowledge(query: string, k?: number): Promise<CitedRetrievedChunk[]>;
}

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

interface PersistedLibrary {
  papers: Paper[];
  seeded: boolean;
}

function readPersisted(): PersistedLibrary | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PersistedLibrary>;
    if (!v || !Array.isArray(v.papers)) return null;
    return { papers: v.papers, seeded: v.seeded === true };
  } catch {
    return null;
  }
}

const persisted = readPersisted();

// ---------------------------------------------------------------------------
// 知识索引（模块级，随 papers 变更重建）
// ---------------------------------------------------------------------------

const embedder = new HashEmbeddingProvider(256);
let retriever = new HybridRetriever();
let paperById = new Map<string, Paper>();

async function rebuildIndex(papers: Paper[]): Promise<number> {
  const next = new HybridRetriever();
  const byId = new Map(papers.map((p) => [p.id, p]));
  let count = 0;
  for (const paper of papers) {
    const chunks = chunkPaper(paper, paper.abstract);
    if (chunks.length === 0) continue;
    const vectors = await embedder.embed(chunks.map((c) => c.text));
    next.addChunks(chunks, vectors);
    count += chunks.length;
  }
  retriever = next;
  paperById = byId;
  return count;
}

// ---------------------------------------------------------------------------
// 首次种子数据（与演示项目 refs.bib 对应，让引用面板与 RAG 开箱即活）
// ---------------------------------------------------------------------------

function seedPapers(): Paper[] {
  const now = Date.now();
  return [
    {
      id: 'seed-vaswani2017attention',
      citekey: 'vaswani2017attention',
      title: 'Attention Is All You Need',
      authors: [
        { family: 'Vaswani', given: 'Ashish' },
        { family: 'Shazeer', given: 'Noam' },
        { family: 'Parmar', given: 'Niki' },
      ],
      year: 2017,
      venue: { type: 'conference', name: 'NeurIPS' },
      abstract:
        'The dominant sequence transduction models are based on complex recurrent or convolutional neural networks. We propose a new simple network architecture, the Transformer, based solely on attention mechanisms, dispensing with recurrence and convolutions entirely. Experiments on two machine translation tasks show these models to be superior in quality while being more parallelizable.',
      tags: ['transformer', 'attention'],
      collections: [],
      readStatus: 'done' as ReadStatus,
      rating: 5,
      addedAt: now - 3000,
    },
    {
      id: 'seed-brown2020language',
      citekey: 'brown2020language',
      title: 'Language Models are Few-Shot Learners',
      authors: [
        { family: 'Brown', given: 'Tom B.' },
        { family: 'Mann', given: 'Benjamin' },
        { family: 'Ryder', given: 'Nick' },
      ],
      year: 2020,
      venue: { type: 'conference', name: 'NeurIPS' },
      abstract:
        'We train GPT-3, an autoregressive language model with 175 billion parameters, and test its performance in the few-shot setting. GPT-3 is applied without any gradient updates or fine-tuning, with tasks specified purely via text interaction. We find GPT-3 achieves strong performance on many NLP datasets, including translation and question-answering.',
      tags: ['llm', 'few-shot'],
      collections: [],
      readStatus: 'reading' as ReadStatus,
      addedAt: now - 2000,
    },
    {
      id: 'seed-openai2023gpt4',
      citekey: 'openai2023gpt4',
      title: 'GPT-4 Technical Report',
      authors: [{ family: 'OpenAI' }],
      year: 2023,
      venue: { type: 'preprint', name: 'arXiv' },
      abstract:
        'We report the development of GPT-4, a large-scale multimodal model accepting image and text inputs and producing text outputs. GPT-4 exhibits human-level performance on various professional and academic benchmarks, including passing a simulated bar exam. The report discusses capabilities, limitations, and safety properties.',
      tags: ['llm', 'multimodal'],
      collections: [],
      readStatus: 'to-read' as ReadStatus,
      addedAt: now - 1000,
    },
  ];
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useLibraryStore = create<LibraryState>((set, get) => ({
  papers: persisted?.papers ?? [],
  indexReady: false,

  importBibtex(text) {
    const parsed = parseBibtex(text);
    const existing = new Set(get().papers.map((p) => p.citekey));
    const added: Paper[] = [];
    for (const partial of parsed.papers) {
      if (partial.citekey && existing.has(partial.citekey)) {
        parsed.errors.push(`跳过重复条目：${partial.citekey}`);
        continue;
      }
      existing.add(partial.citekey);
      added.push({
        ...partial,
        id: partial.id || createId(),
        citekey: disambiguateCitekey(partial.citekey || generateCitekey(partial), existing),
        tags: partial.tags ?? [],
        collections: partial.collections ?? [],
        readStatus: partial.readStatus ?? 'to-read',
        addedAt: partial.addedAt || Date.now(),
      });
    }
    if (added.length > 0) {
      set({ papers: [...added, ...get().papers] });
      void rebuildIndex(get().papers).then(() => set({ indexReady: true }));
    }
    return { added: added.length, errors: parsed.errors };
  },

  async fetchMetadata(kind, id) {
    const trimmed = id.trim();
    if (!trimmed) return { ok: false, error: '请输入标识符' };
    const http = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };
    try {
      const base =
        kind === 'doi' ? await fetchByDoi(trimmed, http) : await fetchByArxiv(trimmed, http);
      const existing = new Set(get().papers.map((p) => p.citekey));
      const paper: Paper = {
        ...base,
        id: createId(),
        citekey: disambiguateCitekey(generateCitekey(base), existing),
        tags: [],
        collections: [],
        readStatus: 'to-read',
        addedAt: Date.now(),
      };
      set({ papers: [paper, ...get().papers] });
      void rebuildIndex(get().papers).then(() => set({ indexReady: true }));
      return { ok: true, paper };
    } catch (e) {
      return {
        ok: false,
        error: `抓取失败：${e instanceof Error ? e.message : String(e)}（浏览器直连部分数据源可能受跨域限制，桌面 Tauri 形态无此问题）`,
      };
    }
  },

  removePaper(id) {
    set({ papers: get().papers.filter((p) => p.id !== id) });
    void rebuildIndex(get().papers).then(() => set({ indexReady: true }));
  },

  setReadStatus(id, status) {
    set({ papers: get().papers.map((p) => (p.id === id ? { ...p, readStatus: status } : p)) });
  },

  async searchKnowledge(query, k = 5) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const vector = (await embedder.embed([trimmed]))[0]!;
    const chunks = retriever.search({ queryVector: vector, queryText: trimmed, k });
    return chunks.map((c) => ({ ...c, citekey: paperById.get(c.paperId)?.citekey }));
  },
}));

// 持久化订阅
useLibraryStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedLibrary = { papers: s.papers, seeded: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* 忽略持久化失败 */
  }
});

/** 启动初始化：首次运行注入种子文献；随后重建知识索引。 */
export async function initLibrary(): Promise<void> {
  const state = useLibraryStore.getState();
  if (!persisted?.seeded && state.papers.length === 0) {
    useLibraryStore.setState({ papers: seedPapers() });
  }
  await rebuildIndex(useLibraryStore.getState().papers);
  useLibraryStore.setState({ indexReady: true });
}
