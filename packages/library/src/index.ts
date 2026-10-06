/** @lemma/library —— WS-C：文献库与 PDF 阅读器 */
export const LIBRARY_PACKAGE_VERSION = '1.1.0';

export type { LibraryStore } from './store';
export { MemoryStore, DexieStore, LibraryDatabase, openDexieStore } from './store';

export type { FilterNode, FilterCompareOp, ParsedFilter } from './filter';
export { parseFilter, applyFilter } from './filter';

export type { ParseBibtexResult } from './importers/bibtex';
export { parseBibtex, parseBibtexAuthors, parsePersonName } from './importers/bibtex';

export type { ParseRisResult } from './importers/ris';
export { parseRis } from './importers/ris';

export type { Http } from './fetchers';
export { fetchByDoi, fetchByArxiv } from './fetchers';

export type { PaperSearchHit } from './search';
export { searchArxiv, searchCrossref, mergeSearchHits, buildArxivQuery } from './search';

export { generateCitekey, disambiguateCitekey } from './citekey';

export type { CitationStyle, CitationSegment } from './cite';
export { formatCitation, parseCitationSegments, CITATION_STYLES } from './cite';

// 知识导出（全库 BibTeX / PDF 标注 Markdown）
export { escapeBibtex, paperToBibtex, papersToBibtex, annotationsToMarkdown } from './export';

export type { PdfPageText } from './pdf/extract';
export { extractSections } from './pdf/extract';
// PDF 全文搜索纯函数（v6.0.0，无 pdfjs 依赖）
export { searchPdfPages, type PdfSearchHit } from './reader/pdfSearch';
// pdfjs 运行时拆分（v4.2.0）：loadPdfText / configurePdfWorker / PdfReader 迁往
// './reader' 子入口，barrel 只保留类型与 worker URL 注入（纯模块）——
// 任何 barrel 导入都不再把 pdfjs-dist 拖进启动 chunk。
export type { PdfTextResult, PdfTextPage } from './pdf/pdfjs';
export { setPdfWorkerUrl, getPdfWorkerUrl } from './pdf/workerRef';

export type { Bm25Doc, Bm25Scored, Bm25Index } from './bm25';
export { tokenize, buildBm25 } from './bm25';

export { annotationToCard } from './annotationToNote';

export type { PdfReaderProps, PdfAskAction, PdfReaderLang } from './reader/PdfReader';

// BibTeX 导出（v2.6.0）
export { toBibtex } from './bibtexExport';
