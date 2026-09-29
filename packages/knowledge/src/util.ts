/**
 * 包内基础工具：确定性哈希与分词。
 * 全库约定：拉丁连续词为一个词，汉字按单字切分（供嵌入 / BM25 / 风格统计共用）。
 */

/** 32 位 FNV-1a 哈希（确定性，无第三方依赖） */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** 小写化后分词：拉丁字母数字连续段为词，汉字一字一词 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const re = /[a-z0-9]+(?:'[a-z]+)?|\p{Script=Han}/gu;
  for (const m of text.toLowerCase().matchAll(re)) {
    tokens.push(m[0]);
  }
  return tokens;
}

/** 转义正则特殊字符，用于把用户字符串安全嵌入 RegExp */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
