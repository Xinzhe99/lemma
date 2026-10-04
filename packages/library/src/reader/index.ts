/**
 * PDF 阅读器子入口（v4.2.0 分包优化）：
 * 本模块聚合所有携带 pdfjs-dist 运行时的导出（PdfReader / loadPdfText /
 * configurePdfWorker）。主包 barrel（src/index.ts）不再静态导出它们——
 * 宿主按需 `import('@lemma/library/reader')` 才会加载 pdfjs（约数百 KB），
 * 启动关键路径不再背负 PDF 渲染引擎。
 *
 * 加载即接线 worker URL：宿主在启动早期经 barrel 的 setPdfWorkerUrl 注入
 * （main.tsx 的 `?url` 资产），本模块初始化时转交给 pdfjs GlobalWorkerOptions。
 */
import { configurePdfWorker, loadPdfText } from '../pdf/pdfjs';
import { getPdfWorkerUrl } from '../pdf/workerRef';

export type { PdfTextResult, PdfTextPage } from '../pdf/pdfjs';
export { configurePdfWorker, loadPdfText } from '../pdf/pdfjs';

export type { PdfReaderProps, PdfAskAction, PdfReaderLang } from './PdfReader';
export { PdfReader } from './PdfReader';

const workerUrl = getPdfWorkerUrl();
if (workerUrl) configurePdfWorker(workerUrl);
