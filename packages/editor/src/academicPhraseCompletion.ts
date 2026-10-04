/**
 * 学术句式补全扩展（v2.9.0 ①）：输入学术常用前缀（如 "In this"）→ 弹出完整句式建议。
 * 触发条件：行首纯英文文本 ≥3 字符，匹配句式库前缀。
 * 与 LaTeX 命令补全（\\ 开头）互不干扰——检测到 \\ 前缀时静默返回 null。
 */

import { snippet, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import { matchPhrases, CATEGORY_LABELS } from './academicPhrases';

/** 只在纯英文文本区域触发 */
const LINE_TEXT_RE = /^[A-Za-z][A-Za-z\s]*$/;

export function academicPhraseCompletion(context: CompletionContext): CompletionResult | null {
  // 不与 \ 命令补全冲突
  const before = context.state.sliceDoc(Math.max(0, context.pos - 200), context.pos);
  if (/\\[a-zA-Z]*$/.test(before)) return null;

  const line = context.state.doc.lineAt(context.pos);
  const lineBefore = context.state.sliceDoc(line.from, context.pos);

  if (!LINE_TEXT_RE.test(lineBefore)) return null;
  if (lineBefore.trim().length < 3) return null;

  const hits = matchPhrases(lineBefore.trim());
  if (hits.length === 0) return null;

  const options: Completion[] = hits.slice(0, 5).map((h) => ({
    label: h.trigger + '…',
    detail: CATEGORY_LABELS[h.category],
    type: 'text',
    apply: snippet(h.phrase),
  }));

  return {
    from: line.from,
    to: context.pos,
    options,
    validFor: /^[A-Za-z\s]*$/,
  };
}

/** 把学术句式补全追加到既有 latexCompletionSource 后（不覆盖 LaTeX 补全） */
export function academicPhraseCompletionSource(context: CompletionContext): CompletionResult | null {
  return academicPhraseCompletion(context);
}
