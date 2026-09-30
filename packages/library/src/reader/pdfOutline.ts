/**
 * PDF 大纲（书签）解析辅助：
 * - flattenOutline / resolveOutlinePages 为纯函数（可独立单测，不依赖 DOM 与 pdfjs 实例）；
 * - createDestPageResolver 为 pdfjs 文档对象的适配辅助：把 getOutline() 给出的 dest
 *   （命名目标字符串 / 显式目标数组）解析为 0-based 页码，供 resolveOutlinePages 使用。
 *
 * pdfjs getOutline() 节点的 dest 可为：
 * - null（无目标，如外链/占位节点）→ 无法定位，按失败跳过；
 * - string（命名目标）→ 先经 doc.getDestination(name) 展开为显式目标数组；
 * - Array（显式目标）→ 首元素为页面引用 { num, gen }，经 doc.getPageIndex(ref) 得 0-based 页码。
 */

/** 大纲树节点（pdfjs OutlineNode 的最小结构化子集）。 */
export interface PdfOutlineNode {
  title: string;
  dest: unknown;
  items?: readonly PdfOutlineNode[];
}

/** 先序展开后的大纲条目（depth：根为 0，逐层 +1）。 */
export interface FlatOutlineItem {
  title: string;
  dest: unknown;
  depth: number;
}

/** dest 解析完成的大纲条目（page：1-based 页码）。 */
export type ResolvedOutlineItem = FlatOutlineItem & { page: number };

/**
 * 把大纲树先序展开为扁平列表：
 * 父节点先于子节点出现，depth 记录层级（用于目录缩进）。
 * 非法节点（无 title）与非数组 items 容忍跳过，不抛错。
 */
export function flattenOutline(outline: readonly PdfOutlineNode[]): FlatOutlineItem[] {
  const flat: FlatOutlineItem[] = [];
  const walk = (nodes: readonly PdfOutlineNode[], depth: number): void => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node.title !== 'string') continue;
      flat.push({ title: node.title, dest: node.dest, depth });
      if (node.items && node.items.length > 0) walk(node.items, depth + 1);
    }
  };
  walk(outline, 0);
  return flat;
}

/**
 * 逐项把 dest 解析为 1-based 页码（getPageIndex 返回 0-based，+1）。
 * 单个条目解析失败（抛错 / 结果非有限数 / 负数）只跳过该项，不中断其余条目；
 * 输出顺序与输入一致，title/dest/depth 原样保留。
 */
export async function resolveOutlinePages(
  flat: readonly FlatOutlineItem[],
  helpers: { getPageIndex: (dest: unknown) => Promise<number> },
): Promise<ResolvedOutlineItem[]> {
  const resolved: ResolvedOutlineItem[] = [];
  for (const item of flat) {
    try {
      const index = await helpers.getPageIndex(item.dest);
      if (!Number.isFinite(index) || index < 0) continue; // 视为解析失败，跳过
      resolved.push({ ...item, page: index + 1 });
    } catch {
      // 单项失败：跳过，不中断
    }
  }
  return resolved;
}

/** pdfjs PDFDocumentProxy 的最小结构接口（便于单测注入假实现）。 */
export interface OutlineDocLike {
  getDestination(dest: string): Promise<Array<unknown> | null>;
  getPageIndex(ref: { num: number; gen: number }): Promise<number>;
}

/**
 * 组装 resolveOutlinePages 所需的 helpers.getPageIndex：
 * - 显式目标数组（首元素为页面引用）→ 直接 getPageIndex；
 * - 命名目标字符串 → 先 getDestination 展开再取页面引用；
 * - 其余（null / 非法结构）→ 抛错（由 resolveOutlinePages 跳过该项）。
 */
export function createDestPageResolver(doc: OutlineDocLike): (dest: unknown) => Promise<number> {
  return async (dest: unknown) => {
    let explicit: unknown = dest;
    if (typeof dest === 'string') explicit = await doc.getDestination(dest);
    if (Array.isArray(explicit)) {
      const ref = explicit[0] as { num?: unknown; gen?: unknown } | null | undefined;
      if (ref && typeof ref === 'object' && typeof ref.num === 'number') {
        return doc.getPageIndex({ num: ref.num, gen: typeof ref.gen === 'number' ? ref.gen : 0 });
      }
    }
    throw new Error(`Unsupported outline destination: ${String(dest)}`);
  };
}
