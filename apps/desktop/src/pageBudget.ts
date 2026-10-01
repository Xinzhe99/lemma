/**
 * 页数预算纯函数（状态栏页数 chip 的数据源）：
 * - parsePageCount：从编译日志解析产物页数，支持两种真实引擎的输出行——
 *   pdflatex/latexmk 的 `Output written on main.pdf (9 pages, 348576 bytes).`
 *   与 tectonic 的 `Wrote 9 pages`（前缀 note:/warning: 等噪声不干扰）；
 *   compileLog 会跨多次编译累积，故取最后一次匹配（最近一次编译的页数）；
 *   不做 PDF 大小估算——只有日志两模式，匹配不到返回 null（UI 不渲染 chip）。
 * - venuePageLimit：从投稿 venue 档案的 pageLimit 描述串取首个整数
 *   （"9 页（含引用）" → 9；"8–9 页" → 8），无整数（"No limit"）返回 null。
 */

import type { VenueProfile } from './submission/venues';

/** pdflatex / latexmk：`Output written on main.pdf (9 pages, 348576 bytes).`（1 页时为 `1 page`） */
const OUTPUT_WRITTEN_RE = /Output written on .*?\((\d+) pages?/gi;
/** tectonic：`Wrote 9 pages`（可能带 `note: ` 等前缀，也可能写作 `Wrote 9 pages to main.pdf`） */
const WROTE_PAGES_RE = /Wrote\s+(\d+)\s+pages?/gi;

/**
 * 解析编译日志中的产物页数：两种引擎模式逐一扫描，返回最后一次出现的页数；
 * 两种模式都出现时（不太可能）以文本顺序靠后者为准；无匹配返回 null。
 */
export function parsePageCount(log: string): number | null {
  let found: { at: number; pages: number } | null = null;
  for (const re of [OUTPUT_WRITTEN_RE, WROTE_PAGES_RE]) {
    re.lastIndex = 0;
    for (const m of log.matchAll(re)) {
      const pages = Number(m[1]);
      const at = m.index ?? 0;
      if (!found || at > found.at) found = { at, pages };
    }
  }
  return found ? found.pages : null;
}

/**
 * 从 venue 档案 pageLimit 字符串取首个整数作为页数上限：
 * "主文 9 页，参考文献与附录不计入" → 9；"主文 8–9 页" → 8；
 * 无任何整数（"No limit" / 空串 / 未选择 venue）返回 null。
 */
export function venuePageLimit(venueProfile: VenueProfile | null | undefined): number | null {
  if (!venueProfile) return null;
  const m = /\d+/.exec(venueProfile.pageLimit);
  return m ? Number(m[0]) : null;
}
