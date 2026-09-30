/**
 * 智能引用推荐（纯函数，供 CitationPicker「智能推荐」按钮调用）：
 *  1. 取当前 .tex 内容尾部构造检索 query —— 默认尾部 ~1500 字符；
 *     CJK 内容信息密度高，尾部 ~800 字符即可表达当前语境（CJK 占比 > 20% 时取 800，见 buildSuggestQuery）；
 *  2. query 经注入的 retrieve（libraryStore.searchKnowledge 混合检索）取 top 8；
 *  3. 过滤：已引用（alreadyCited）、无 citekey、重复（citekey / paperId 双重去重），
 *     reason 固定为「与当前内容语义相关」，title 由 papers 按 paperId 回查（缺失回退 citekey）；
 *  4. 检索空结果 / 抛异常 / query 为空 → 回退：papers 按 year 降序取前 5
 *     （同样过滤已引与无 citekey，年份缺失排最后），reason 标注「（回退）」。
 */

import type { Paper } from '@scholarforge/shared';

/** 检索注入签名：与 libraryStore.searchKnowledge(query, k) 结构兼容 */
export type RetrieveFn = (q: string, k: number) => Promise<{ paperId: string; citekey?: string }[]>;

export interface CitationSuggestion {
  citekey: string;
  title: string;
  reason: string;
}

export const SUGGEST_REASON_SEMANTIC = '与当前内容语义相关';
export const SUGGEST_REASON_FALLBACK = '最近入库的高相关候选（回退）';

/** 非 CJK 语境的 query 尾部长度 */
const QUERY_TAIL_DEFAULT = 1500;
/** CJK 语境的 query 尾部长度（信息密度高，取更短窗口） */
const QUERY_TAIL_CJK = 800;
/** CJK 占比阈值：尾部字符中 CJK 占比超过该值视为中文语境 */
const CJK_RATIO_THRESHOLD = 0.2;
/** 混合检索取回条数 */
export const RETRIEVE_K = 8;
/** 回退候选条数 */
export const FALLBACK_LIMIT = 5;

/** CJK 统一表意文字 + 日文假名（兼容中日混排摘要） */
const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function tail(text: string, n: number): string {
  return text.length <= n ? text : text.slice(-n);
}

/**
 * 由当前内容尾部构造检索 query：默认尾部 ~1500 字符；
 * CJK 占比 > 20% 时改取尾部 ~800 字符（CJK 信息密度高，短窗口即可，且缩短嵌入输入）。
 */
export function buildSuggestQuery(activeText: string): string {
  const approx = tail(activeText, QUERY_TAIL_DEFAULT);
  let cjk = 0;
  let total = 0;
  for (const ch of approx) {
    total++;
    if (CJK_RE.test(ch)) cjk++;
  }
  const ratio = total > 0 ? cjk / total : 0;
  return ratio > CJK_RATIO_THRESHOLD ? tail(activeText, QUERY_TAIL_CJK) : approx;
}

export async function suggestCitations(
  activeText: string,
  papers: Paper[],
  alreadyCited: string[],
  retrieve: RetrieveFn,
): Promise<CitationSuggestion[]> {
  const cited = new Set(alreadyCited);
  const paperById = new Map(papers.map((p) => [p.id, p] as const));

  const query = buildSuggestQuery(activeText).trim();

  // —— 主路径：语义检索 top 8 → 过滤已引 / 无键 / 重复 ——
  if (query) {
    try {
      const hits = await retrieve(query, RETRIEVE_K);
      const suggestions: CitationSuggestion[] = [];
      const seenKeys = new Set<string>();
      const seenIds = new Set<string>();
      for (const hit of hits) {
        const key = hit.citekey?.trim();
        if (!key || cited.has(key) || seenKeys.has(key) || seenIds.has(hit.paperId)) continue;
        seenKeys.add(key);
        seenIds.add(hit.paperId);
        suggestions.push({
          citekey: key,
          title: paperById.get(hit.paperId)?.title ?? key, // 库内缺失时回退 citekey 作为标题
          reason: SUGGEST_REASON_SEMANTIC,
        });
      }
      if (suggestions.length > 0) return suggestions;
    } catch {
      // 检索异常 → 走下方年份回退（不向调用方抛错）
    }
  }

  // —— 回退路径：库内按 year 降序取前 5（同样过滤已引与无 citekey；年份缺失排最后）——
  return papers
    .filter((p) => {
      const key = p.citekey.trim();
      return key !== '' && !cited.has(key);
    })
    .sort((a, b) => (b.year ?? Number.NEGATIVE_INFINITY) - (a.year ?? Number.NEGATIVE_INFINITY))
    .slice(0, FALLBACK_LIMIT)
    .map((p) => ({ citekey: p.citekey, title: p.title, reason: SUGGEST_REASON_FALLBACK }));
}
