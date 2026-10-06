/**
 * PDF 全文搜索（v6.0.0 F1）：纯函数层——逐页文本 + 关键词 → 命中列表（页码 + 上下文摘录）。
 * 与渲染解耦便于单测；UI 层负责跳页/计数/前后导航。
 */

export interface PdfSearchHit {
  page: number;
  /** 命中词前后各约 28 字符的上下文（截断加省略号） */
  snippet: string;
}

/** 大小写不敏感子串搜索；query 去空白后为空返回 [] */
export function searchPdfPages(
  pages: Array<{ page: number; text: string }>,
  query: string,
  limit = 200,
): PdfSearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: PdfSearchHit[] = [];
  for (const { page, text } of pages) {
    const lower = text.toLowerCase();
    let from = 0;
    while (hits.length < limit) {
      const idx = lower.indexOf(q, from);
      if (idx < 0) break;
      hits.push({ page, snippet: makeSnippet(text, idx, q.length) });
      from = idx + q.length;
      // 同页命中过多也截断（防关键词是单字符的长页）
      if (from > lower.length) break;
    }
    if (hits.length >= limit) break;
  }
  return hits;
}

function makeSnippet(text: string, idx: number, len: number, radius = 28): string {
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + len + radius);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const body = text
    .slice(start, end)
    .replace(/\s+/g, ' ')
    .trim();
  return `${prefix}${body}${suffix}`;
}
