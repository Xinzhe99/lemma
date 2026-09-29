import * as pdfjsLib from 'pdfjs-dist';

/**
 * pdfjs-dist 封装：worker URL 由宿主注入（包内不硬编码）。
 * 测试不应加载本模块（会拉起 pdfjs 运行时）。
 */

export interface PdfTextPage {
  page: number;
  text: string;
}

export interface PdfTextResult {
  numPages: number;
  pages: PdfTextPage[];
}

/** 设置 PDF worker 脚本地址（如 Vite 的 `?url` 导入或 CDN 地址）。 */
export function configurePdfWorker(url: string): void {
  pdfjsLib.GlobalWorkerOptions.workerSrc = url;
}

/** 提取整份 PDF 的纯文本（按 pdfjs 的 EOL 信息还原换行，供 extractSections 使用）。 */
export async function loadPdfText(data: ArrayBuffer): Promise<PdfTextResult> {
  // getDocument 会接管传入的 buffer，复制一份避免调用方的 data 被转移
  const bytes = new Uint8Array(data.slice(0));
  const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
  try {
    const pages: PdfTextPage[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = '';
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str;
        if (item.hasEOL) text += '\n';
      }
      pages.push({ page: pageNumber, text });
      page.cleanup();
    }
    return { numPages: doc.numPages, pages };
  } finally {
    await doc.destroy();
  }
}
