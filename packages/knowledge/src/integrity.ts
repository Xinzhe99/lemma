/**
 * RAG 答案引用守卫与导出脱敏（设计 5.6 的纯函数层）。
 * validateCitations 把不在白名单里的引用全部报出，是拦截幻觉引用的第一道闸。
 */

export const REDACTED = '⟦REDACTED⟧';

export interface ExtractedCitation {
  citekey: string;
  page?: number;
}

export interface CitationValidation {
  ok: boolean;
  /** 不在白名单中的引用键 */
  invalid: string[];
  /** 文中实际使用的引用键（按出现顺序去重） */
  usedKeys: string[];
}

// [citekey] 或 [citekey p.12] / [citekey p. 12]；
// 排除 markdown 链接 [x](url)、图片 ![x]、双链 [[x]]、复选框 [x]（键至少 2 字符）
const CITE_RE = /(?<![![\[])\[([A-Za-z0-9_.:+-]{2,})(?:\s+p\.\s*(\d+))?\](?!\()/g;

function isPageOnlyKey(key: string): boolean {
  return /^p\.?\d+$/i.test(key);
}

/** 提取 markdown 中的引用（含可选页码），按出现顺序返回 */
export function extractCitations(md: string): ExtractedCitation[] {
  const out: ExtractedCitation[] = [];
  for (const m of md.matchAll(CITE_RE)) {
    const citekey = m[1] ?? '';
    if (isPageOnlyKey(citekey)) continue;
    const page = m[2] !== undefined ? Number(m[2]) : undefined;
    out.push(page === undefined ? { citekey } : { citekey, page });
  }
  return out;
}

/** 校验引用是否全部在白名单内（拦截幻觉引用的纯函数层） */
export function validateCitations(md: string, validKeys: string[]): CitationValidation {
  const valid = new Set(validKeys);
  const usedKeys: string[] = [];
  for (const c of extractCitations(md)) {
    if (!usedKeys.includes(c.citekey)) usedKeys.push(c.citekey);
  }
  const invalid = usedKeys.filter((k) => !valid.has(k));
  return { ok: invalid.length === 0, invalid, usedKeys };
}

/** 把敏感串替换为占位符（长串优先，避免子串先被替换） */
export function sanitizeForExport(text: string, secrets: string[]): string {
  const ordered = [...secrets].filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
  let out = text;
  for (const s of ordered) {
    out = out.split(s).join(REDACTED);
  }
  return out;
}
