/** @lemma/knowledge —— WS-E：RAG / Context Pack / 术语与风格 / 笔记双链 / 引用守卫 */
export const KNOWLEDGE_PACKAGE_VERSION = '1.1.0';

export {
  chunkPaper,
  chunkPlainText,
  chunkBySentence,
  splitSentences,
  SECTION_MAX_CHARS,
  CHUNK_OVERLAP,
} from './chunker';
export type { ChunkPlainTextOptions } from './chunker';

export { HashEmbeddingProvider, TfidfEmbeddingProvider, OpenAICompatEmbeddings } from './embeddings';
export type { EmbeddingProvider, OpenAICompatEmbeddingsOptions, FetchLike } from './embeddings';

export { HybridRetriever, cosine, VECTOR_WEIGHT, TEXT_WEIGHT, BM25_K1, BM25_B } from './retriever';
export type { SearchParams } from './retriever';

export { buildContextPack, renderContextPackMd } from './contextPack';
export type { CitedChunk, BuildContextPackInput } from './contextPack';

export { extractGlossary, checkConsistency } from './glossary';
export type { GlossaryIssue } from './glossary';

export { analyzeStyle, splitTextSentences } from './style';

export { parseWikilinks, buildBacklinkIndex, createNoteFromAnnotation } from './notes';
export type { AnnotationDraft, PaperRef } from './notes';

export { extractCitations, validateCitations, sanitizeForExport, REDACTED } from './integrity';
export type { ExtractedCitation, CitationValidation } from './integrity';
export type { GlossaryTerm } from '@lemma/shared';
