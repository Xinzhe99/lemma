/**
 * 文献库应用层状态：条目 CRUD、BibTeX/DOI/arXiv 导入、citekey 生成消歧，
 * 以及知识索引（分块 + 本地哈希嵌入 + 混合检索），供 RAG 与 Context Pack 使用。
 *
 * 持久化（IndexedDB 升级）：papers 经 kvStore.setBigData 写 IndexedDB kv 表
 * （localStorage 5MB 配额不再承压；旧 sf-library 键由启动迁移搬走、读路径兜底）；
 * PDF 附件字节经 db.attachmentPut 以 Blob 落 IndexedDB attachments 表，启动自动
 * hydrate 回内存（此前纯内存态、重启全丢）；知识索引每次启动重建。
 */

import { create } from 'zustand';
import {
  createId,
  type Paper,
  type ReadStatus,
  type RetrievedChunk,
  type TextChunk,
} from '@scholarforge/shared';
import {
  parseBibtex,
  generateCitekey,
  disambiguateCitekey,
  fetchByDoi,
  fetchByArxiv,
  type PaperSearchHit,
} from '@scholarforge/library';
import {
  chunkPaper,
  TfidfEmbeddingProvider,
  HybridRetriever,
  OpenAICompatEmbeddings,
  type EmbeddingProvider,
} from '@scholarforge/knowledge';
import { useSettingsStore } from './settingsStore';
import { useUiStore } from './uiStore';
import { paperAnnotationKey, useAnnotationStore } from './annotationStore';
import {
  attachmentBulkDelete,
  attachmentGet,
  attachmentGetAll,
  attachmentPut,
  blobToArrayBuffer,
} from '../storage/db';
import { getBigData, migrateLocalStorageToIdb, setBigData } from '../storage/kvStore';

const STORAGE_KEY = 'sf-library';

export interface CitedRetrievedChunk extends RetrievedChunk {
  citekey?: string;
}

/** openPdf 失败的错误码（面板按语言渲染文案）。 */
export type OpenPdfError = 'no-paper' | 'no-attachment';

interface LibraryState {
  papers: Paper[];
  /** 库内 PDF 附件（paperId → bytes；IndexedDB 持久化，模块加载时自动 hydrate 回内存）。 */
  pdfAttachments: Record<string, ArrayBuffer>;
  /** 知识索引是否已构建完成（后台异步） */
  indexReady: boolean;
  /** 当前嵌入来源：hash 本地 / api 语义嵌入 / api-fallback（API 失败已回退） */
  indexMode: 'hash' | 'api' | 'api-fallback';
  importBibtex(text: string): { added: number; errors: string[] };
  /** 发现检索结果一键入库 */
  importHit(hit: PaperSearchHit): Paper;
  fetchMetadata(kind: 'doi' | 'arxiv', id: string): Promise<{ ok: true; paper: Paper } | { ok: false; error: string }>;
  removePaper(id: string): void;
  /** 批量删除（L5）：一次重建索引，并级联清理附件与标注绑定。 */
  removePapers(ids: string[]): void;
  setReadStatus(id: string, status: ReadStatus): void;
  /** 批量标记阅读状态（L5）。 */
  setReadStatusBulk(ids: string[], status: ReadStatus): void;
  /** 关联本地 PDF：bytes 存内存 map 并持久化到 IndexedDB，paper.pdfPath 标记为 `${citekey}.pdf`。 */
  attachPdf(paperId: string, data: ArrayBuffer): boolean;
  /** 经 uiStore.setPdfView 打开库内附件；文件名固定 `${citekey}.pdf`，标注键绑定到 paperId。 */
  openPdf(paperId: string): { ok: true; name: string } | { ok: false; error: OpenPdfError };
  searchKnowledge(query: string, k?: number): Promise<CitedRetrievedChunk[]>;
}

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

interface PersistedLibrary {
  papers: Paper[];
  seeded: boolean;
}

/** 旧 localStorage 快照（升级到 IndexedDB 前的存量数据；迁移后此值为 null）。 */
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
// 知识索引（模块级，随 papers / 嵌入配置变更重建）
// ---------------------------------------------------------------------------

let embedder: EmbeddingProvider = new TfidfEmbeddingProvider(256);
let embedderMode: 'hash' | 'api' | 'api-fallback' = 'hash';
let retriever = new HybridRetriever();
let paperById = new Map<string, Paper>();

/** 依据设置选择嵌入源：激活服务 + 嵌入模型 → API；否则本地哈希 */
function chooseEmbedder(): void {
  const s = useSettingsStore.getState();
  const cfg = s.providers.find((p) => p.id === s.activeProviderId);
  const model = s.embeddingModel.trim();
  if (cfg && cfg.baseUrl.trim() && cfg.apiKey.trim() && model) {
    embedder = new OpenAICompatEmbeddings({
      url: cfg.baseUrl.trim(),
      apiKey: cfg.apiKey.trim(),
      model,
      fetchFn: (url, init) => fetch(url, init),
    });
    embedderMode = 'api';
  } else {
    embedder = new TfidfEmbeddingProvider(256);
    embedderMode = 'hash';
  }
}

/** API 嵌入失败时一次性回退本地哈希（后续调用继续用哈希，保证可用） */
async function embedWithFallback(texts: string[]): Promise<number[][]> {
  try {
    return await embedder.embed(texts);
  } catch (e) {
    if (embedderMode === 'api') {
      embedder = new TfidfEmbeddingProvider(256);
      embedderMode = 'api-fallback';
      console.warn('语义嵌入服务调用失败，已回退本地哈希嵌入：', e);
      return embedder.embed(texts);
    }
    throw e;
  }
}

/** API 单次请求的嵌入批大小（防超长请求；本地 provider 无所谓） */
const EMBED_BATCH = 64;

async function rebuildIndex(papers: Paper[]): Promise<number> {
  const next = new HybridRetriever();
  const byId = new Map(papers.map((p) => [p.id, p]));
  // 先收集全库 chunk：df 统计必须覆盖整库（而非单篇），停用词抑制才成立
  const allChunks: TextChunk[] = [];
  for (const paper of papers) {
    allChunks.push(...chunkPaper(paper, paper.abstract));
  }
  let count = 0;
  if (allChunks.length > 0) {
    embedder.fit?.(allChunks.map((c) => c.text));
    const vectors: number[][] = [];
    for (let i = 0; i < allChunks.length; i += EMBED_BATCH) {
      const batch = allChunks.slice(i, i + EMBED_BATCH).map((c) => c.text);
      vectors.push(...(await embedWithFallback(batch)));
    }
    next.addChunks(allChunks, vectors);
    count = allChunks.length;
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
  pdfAttachments: {},
  indexReady: false,
  indexMode: 'hash',

  importBibtex(text) {
    const parsed = parseBibtex(text);
    const existing = new Set(get().papers.map((p) => p.citekey));
    const added: Paper[] = [];
    for (const partial of parsed.papers) {
      if (partial.citekey && existing.has(partial.citekey)) {
        parsed.errors.push(`跳过重复条目：${partial.citekey}`);
        continue;
      }
      const baseKey = partial.citekey || generateCitekey(partial);
      const finalKey = disambiguateCitekey(baseKey, existing);
      existing.add(finalKey);
      added.push({
        ...partial,
        id: partial.id || createId(),
        citekey: finalKey,
        tags: partial.tags ?? [],
        collections: partial.collections ?? [],
        readStatus: partial.readStatus ?? 'to-read',
        addedAt: partial.addedAt || Date.now(),
      });
    }
    if (added.length > 0) {
      set({ papers: [...added, ...get().papers] });
      void rebuildIndex(get().papers).then(() => set({ indexReady: true, indexMode: embedderMode }));
    }
    return { added: added.length, errors: parsed.errors };
  },

  importHit(hit) {
    const existing = new Set(get().papers.map((p) => p.citekey));
    const paper: Paper = {
      id: createId(),
      citekey: '',
      title: hit.title,
      authors: hit.authors,
      year: hit.year,
      venue: hit.venue,
      abstract: hit.abstract,
      doi: hit.doi,
      arxivId: hit.arxivId,
      tags: hit.tags,
      collections: [],
      readStatus: 'to-read',
      addedAt: Date.now(),
    };
    paper.citekey = disambiguateCitekey(generateCitekey(paper), existing);
    set({ papers: [paper, ...get().papers] });
    void rebuildIndex(get().papers).then(() => set({ indexReady: true, indexMode: embedderMode }));
    return paper;
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
      void rebuildIndex(get().papers).then(() => set({ indexReady: true, indexMode: embedderMode }));
      return { ok: true, paper };
    } catch (e) {
      return {
        ok: false,
        error: `抓取失败：${e instanceof Error ? e.message : String(e)}（浏览器直连部分数据源可能受跨域限制，桌面 Tauri 形态无此问题）`,
      };
    }
  },

  removePaper(id) {
    get().removePapers([id]);
  },

  removePapers(ids) {
    const removing = new Set(ids);
    const removed = get().papers.filter((p) => removing.has(p.id));
    if (removed.length === 0) return;
    // 级联清理：内存附件、标注键（paper:{id}）、文件名绑定
    const annotations = useAnnotationStore.getState();
    const attachments = { ...get().pdfAttachments };
    for (const paper of removed) {
      delete attachments[paper.id];
      annotations.clear(paperAnnotationKey(paper.id));
      if (paper.pdfPath) annotations.unbindPdfName(paper.pdfPath);
    }
    set({
      papers: get().papers.filter((p) => !removing.has(p.id)),
      pdfAttachments: attachments,
    });
    // 级联清理持久层附件（含尚未 hydrate 回内存的）
    persistQuietly(attachmentBulkDelete(removed.map((p) => p.id)));
    void rebuildIndex(get().papers).then(() => set({ indexReady: true, indexMode: embedderMode }));
  },

  setReadStatus(id, status) {
    set({ papers: get().papers.map((p) => (p.id === id ? { ...p, readStatus: status } : p)) });
  },

  setReadStatusBulk(ids, status) {
    const targets = new Set(ids);
    set({
      papers: get().papers.map((p) => (targets.has(p.id) ? { ...p, readStatus: status } : p)),
    });
  },

  attachPdf(paperId, data) {
    const paper = get().papers.find((p) => p.id === paperId);
    if (!paper) return false;
    // 存副本：pdfjs 可能转移（detach）调用方传入的 buffer
    const copy = data.slice(0);
    const name = `${paper.citekey || paper.id}.pdf`;
    set((s) => ({
      pdfAttachments: { ...s.pdfAttachments, [paperId]: copy },
      papers: s.papers.map((p) => (p.id === paperId ? { ...p, pdfPath: name } : p)),
    }));
    // 持久化到 IndexedDB（fire-and-forget：失败仅告警，不打断 UI）
    persistQuietly(
      attachmentPut({ paperId, data: new Blob([copy]), name, savedAt: Date.now() }),
    );
    return true;
  },

  openPdf(paperId) {
    const paper = get().papers.find((p) => p.id === paperId);
    if (!paper) return { ok: false, error: 'no-paper' };
    const bytes = get().pdfAttachments[paperId];
    if (!bytes) {
      // 内存未命中（启动 hydrate 未完成或内存被清空）：异步从持久层回填，本次按无附件
      // 返回（同步返回类型保持不变）；回填完成后再次 openPdf 即可打开。
      persistQuietly(backfillAttachment(paperId));
      return { ok: false, error: 'no-attachment' };
    }
    const name = `${paper.citekey || paper.id}.pdf`;
    // 标注键绑定到 paperId（App 层经 resolveKey 读/写），再传出副本避免 pdfjs 转移存储 buffer
    useAnnotationStore.getState().bindPdfName(name, paperId);
    useUiStore.getState().setPdfView({ name, data: bytes.slice(0) });
    return { ok: true, name };
  },

  async searchKnowledge(query, k = 5) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const vector = (await embedWithFallback([trimmed]))[0]!;
    const chunks = retriever.search({ queryVector: vector, queryText: trimmed, k });
    return chunks.map((c) => ({ ...c, citekey: paperById.get(c.paperId)?.citekey }));
  },
}));

// 持久化订阅：papers 整库写 IndexedDB（setBigData 异步、同键串行、永不因配额抛错）；
// 旧 localStorage 副本由启动迁移搬走，读路径经 getBigData 兜底。
useLibraryStore.subscribe((s) => {
  const snap: PersistedLibrary = { papers: s.papers, seeded: true };
  void setBigData(STORAGE_KEY, snap);
});

/** fire-and-forget 持久化：失败仅控制台告警（与旧 localStorage try/catch 吞错同语义）。 */
function persistQuietly(op: Promise<unknown>): void {
  void op.catch((e) => console.warn('[storage] 附件持久化失败：', e));
}

/** 从持久层读回单条附件填内存（内存已有或持久层无则不动）。 */
async function backfillAttachment(paperId: string): Promise<void> {
  if (useLibraryStore.getState().pdfAttachments[paperId]) return;
  const rec = await attachmentGet(paperId);
  if (!rec) return;
  const bytes = await blobToArrayBuffer(rec.data);
  // 仅在内存仍缺时填入，避免覆盖稍新的 attachPdf 副本
  useLibraryStore.setState((s) =>
    s.pdfAttachments[paperId]
      ? s
      : { pdfAttachments: { ...s.pdfAttachments, [paperId]: bytes } },
  );
}

/**
 * 启动预载：把持久层全部附件读回内存 map，返回本次实际载入条数。幂等——内存已有
 * 的键不覆盖、不计入。模块加载时自动执行一次（App 无需接线），此后 openPdf 只查
 * 内存 map 即可同步打开。
 */
export async function hydrateAttachments(): Promise<number> {
  const records = await attachmentGetAll();
  let loaded = 0;
  for (const rec of records) {
    if (useLibraryStore.getState().pdfAttachments[rec.paperId]) continue;
    const bytes = await blobToArrayBuffer(rec.data);
    useLibraryStore.setState((s) =>
      s.pdfAttachments[rec.paperId]
        ? s
        : { pdfAttachments: { ...s.pdfAttachments, [rec.paperId]: bytes } },
    );
    loaded += 1;
  }
  return loaded;
}

/**
 * 启动初始化：优先读 IndexedDB 持久库（getBigData；旧 localStorage 副本兜底）；
 * 首次运行注入种子文献；随后按嵌入配置重建知识索引。
 */
export async function initLibrary(): Promise<void> {
  let fromIdb: Partial<PersistedLibrary> | undefined;
  try {
    fromIdb = await getBigData<Partial<PersistedLibrary>>(STORAGE_KEY);
  } catch {
    fromIdb = undefined; // IndexedDB 读取失败：退回模块加载时的 localStorage 旧副本
  }
  if (fromIdb && Array.isArray(fromIdb.papers)) {
    useLibraryStore.setState({ papers: fromIdb.papers });
  }
  const state = useLibraryStore.getState();
  const alreadySeeded =
    persisted?.seeded === true || fromIdb?.seeded === true || state.papers.length > 0;
  if (!alreadySeeded) {
    useLibraryStore.setState({ papers: seedPapers() });
  }
  chooseEmbedder();
  await rebuildIndex(useLibraryStore.getState().papers);
  useLibraryStore.setState({ indexReady: true, indexMode: embedderMode });
}

// 嵌入配置（激活服务 / 嵌入模型）变化时自动重建索引
useSettingsStore.subscribe((s, prev) => {
  if (s.embeddingModel !== prev.embeddingModel || s.activeProviderId !== prev.activeProviderId) {
    chooseEmbedder();
    void rebuildIndex(useLibraryStore.getState().papers).then(() =>
      useLibraryStore.setState({ indexReady: true, indexMode: embedderMode }),
    );
  }
});

// 模块加载即自举（App 无需接线）：
//  1. 附件 hydrate——持久层全部 PDF 附件预载回内存 map（幂等），重启后附件不再丢失；
//  2. localStorage → IndexedDB 启动迁移——把 ≥32KB 的 sf-* 大键搬入 IndexedDB 释放配额
//     （惰性读取方属主的键跳过，见 kvStore 注释；所有 store 的模块级同步读取先于
//      本异步迁移执行，搬运不与任何模块初始化竞争）。
persistQuietly(hydrateAttachments());
void migrateLocalStorageToIdb().catch((e) => console.warn('[storage] 启动迁移失败：', e));
