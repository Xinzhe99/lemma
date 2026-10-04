/**
 * 文档格式规范化（v3.2.0 ②）：一键清理 LaTeX 源码中的常见格式问题。
 *
 * 清理项（按安全程度排序）：
 *  1. 智能引号 → 直引号（" " → "，' ' → '）
 *  2. Unicode 破折号 → LaTeX 命令（– → --，— → ---）
 *  3. 省略号 → \ldots（... → \ldots{}）
 *  4. 连续空格 → 单空格（跳过 verbatim/lstlisting 环境）
 *  5. 行尾空白 → 删除
 *  6. 不间断空格 (U+00A0) → 普通空格
 *  7. 全角空格 (U+3000) → 普通空格
 *
 * 跳过：verbatim / lstlisting / minted 环境内的内容（代码原样保留）。
 * 输入输出都是纯文本，无 store 依赖。
 */

/** 需要跳过的代码环境（内容不修改） */
const CODE_ENVS = ['verbatim', 'lstlisting', 'minted'];

/** 检测行是否在代码环境内（简化检测：begin/end 配对栈） */
function splitByCodeEnv(text: string): { code: boolean; segment: string }[] {
  const segments: { code: boolean; segment: string }[] = [];
  let inCode = false;
  let current = '';

  const envRe = new RegExp(`\\\\(?:begin|end)\\{(${CODE_ENVS.join('|')})\\}`, 'g');
  let lastIndex = 0;
  for (const m of text.matchAll(envRe)) {
    const isBegin = m[0].startsWith('\\begin');
    current += text.slice(lastIndex, m.index);
    // 当前段的代码状态在遇到 begin/end 时切换
    segments.push({ code: inCode, segment: current });
    current = '';
    lastIndex = m.index + m[0].length;
    if (isBegin && !inCode) inCode = true;
    else if (!isBegin && inCode) inCode = false;
  }
  current += text.slice(lastIndex);
  segments.push({ code: inCode, segment: current });
  return segments;
}

/** 对非代码段执行格式清理 */
function cleanSegment(s: string): string {
  let out = s;
  // 智能引号
  out = out.replace(/[\u201C\u201D]/g, '"');
  out = out.replace(/[\u2018\u2019]/g, "'");
  // Unicode 破折号
  out = out.replace(/\u2013/g, '--'); // en dash
  out = out.replace(/\u2014/g, '---'); // em dash
  // 省略号
  out = out.replace(/\.\.\./g, '\\ldots{}');
  // 不间断空格 / 全角空格
  out = out.replace(/\u00A0/g, ' ');
  out = out.replace(/\u3000/g, ' ');
  // 连续空格 → 单空格
  out = out.replace(/ {2,}/g, ' ');
  // 行尾空白
  out = out.replace(/[ \t]+$/gm, '');
  return out;
}

/** 对整篇文档执行格式规范化 */
export function normalizeDocument(text: string): { result: string; changes: number } {
  const segments = splitByCodeEnv(text);
  let cleaned = '';
  let changes = 0;
  for (const seg of segments) {
    if (seg.code) {
      cleaned += seg.segment;
    } else {
      const c = cleanSegment(seg.segment);
      if (c !== seg.segment) changes++;
      cleaned += c;
    }
  }
  return { result: cleaned, changes };
}

/** 统计文档中存在的格式问题（不修改，只报告） */
export function countFormatIssues(text: string): {
  smartQuotes: number;
  unicodeDashes: number;
  ellipsis: number;
  doubleSpaces: number;
  trailingWhitespace: number;
  specialSpaces: number;
} {
  const segments = splitByCodeEnv(text);
  const nonCode = segments.filter((s) => !s.code).map((s) => s.segment).join('');
  return {
    smartQuotes: (nonCode.match(/[\u201C\u201D\u2018\u2019]/g) ?? []).length,
    unicodeDashes: (nonCode.match(/[\u2013\u2014]/g) ?? []).length,
    ellipsis: (nonCode.match(/\.\.\./g) ?? []).length,
    doubleSpaces: (nonCode.match(/ {2,}/g) ?? []).length,
    trailingWhitespace: (nonCode.match(/[ \t]+$/gm) ?? []).length,
    specialSpaces: (nonCode.match(/[\u00A0\u3000]/g) ?? []).length,
  };
}
