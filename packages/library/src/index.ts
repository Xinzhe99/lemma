/** @scholarforge/library —— WS-C：文献库与 PDF 阅读器 */
export const LIBRARY_PACKAGE_VERSION = '0.1.0';

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

export type { PdfPageText } from './pdf/extract';
export { extractSections } from './pdf/extract';
export type { PdfTextResult, PdfTextPage } from './pdf/pdfjs';
export { configurePdfWorker, loadPdfText } from './pdf/pdfjs';

export type { Bm25Doc, Bm25Scored, Bm25Index } from './bm25';
export { tokenize, buildBm25 } from './bm25';

export { annotationToCard } from './annotationToNote';

export type { PdfReaderProps, PdfAskAction, PdfReaderLang } from './reader/PdfReader';
export { PdfReader } from './reader/PdfReader';
