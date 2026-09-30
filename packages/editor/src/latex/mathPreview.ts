/**
 * 数学公式实时预览：定界符扫描（纯函数）+ KaTeX 渲染（按 tex|display 缓存）。
 *
 * 识别四类定界符：`$...$`（内联）、`\(...\)`（内联）、`$$...$$`（行间）、`\[...\]`（行间），
 * 行间公式支持跨行；`\$` 转义不构成定界符；注释（复用 outline.ts 的 stripLineComment 语义，
 * 即「未被转义的 % 起、至行尾」）内的字符不参与定界符识别。
 */

import { renderToString as katexRenderToString } from 'katex';
import { stripLineComment } from './outline';

/** 一段数学公式在源码中的位置与内容（tex 为定界符内原文，已 trim；from/to 含定界符本身） */
export interface MathSpan {
  tex: string;
  display: boolean;
  from: number;
  to: number;
}

/**
 * 提取文档中的全部数学公式 span（按出现顺序）。
 * 内容中出现 `%` 注释不影响 span 完整性（注释仅让其中的定界符失效），
 * 未闭合的定界符按普通文本跳过。
 */
export function extractMathSpans(doc: string): MathSpan[] {
  const spans: MathSpan[] = [];
  const n = doc.length;
  if (n === 0) return spans;

  // 逐行标记「非注释」字符位：active[i]=1 表示该字符可参与定界符匹配
  const active = new Uint8Array(n);
  let offset = 0;
  for (const line of doc.split('\n')) {
    const keep = stripLineComment(line).length;
    for (let k = 0; k < keep; k++) active[offset + k] = 1;
    offset += line.length + 1; // +1 补回被 split 吃掉的 '\n'
  }

  // 在 [from, n) 内找闭合定界符，返回其起始下标（找不到 -1）；
  // 跳过注释区与 `\X` 转义对（\$ 不误判、\\ 后的 $ 照常闭合）
  const findClosing = (from: number, isClose: (i: number) => number): number => {
    let j = from;
    while (j < n) {
      if (!active[j]) {
        j++;
        continue;
      }
      if (isClose(j) > 0) return j;
      j += doc[j] === '\\' ? 2 : 1; // 控制序列/转义整体消费
    }
    return -1;
  };

  const isDollarClose = (single: boolean) => (i: number): number => {
    if (doc[i] !== '$') return 0;
    if (!single) return doc[i + 1] === '$' ? 2 : 0;
    return 1;
  };
  const isBackslashClose = (mark: string) => (i: number): number =>
    doc[i] === '\\' && doc[i + 1] === mark ? 2 : 0;

  let i = 0;
  while (i < n) {
    if (!active[i]) {
      i++;
      continue;
    }
    const ch = doc[i]!;
    if (ch === '\\') {
      const mark = doc[i + 1];
      if (mark === '(') {
        const end = findClosing(i + 2, isBackslashClose(')'));
        if (end >= 0) {
          const tex = doc.slice(i + 2, end).trim();
          if (tex) spans.push({ tex, display: false, from: i, to: end + 2 });
          i = end + 2;
          continue;
        }
      } else if (mark === '[') {
        const end = findClosing(i + 2, isBackslashClose(']'));
        if (end >= 0) {
          const tex = doc.slice(i + 2, end).trim();
          if (tex) spans.push({ tex, display: true, from: i, to: end + 2 });
          i = end + 2;
          continue;
        }
      }
      i += 2; // \$、\\、\alpha 等整体消费
      continue;
    }
    if (ch === '$') {
      if (doc[i + 1] === '$') {
        const end = findClosing(i + 2, isDollarClose(false));
        if (end >= 0) {
          const tex = doc.slice(i + 2, end).trim();
          if (tex) spans.push({ tex, display: true, from: i, to: end + 2 });
          i = end + 2;
          continue;
        }
        i += 2;
        continue;
      }
      const end = findClosing(i + 1, isDollarClose(true));
      if (end >= 0) {
        const tex = doc.slice(i + 1, end).trim();
        if (tex) spans.push({ tex, display: false, from: i, to: end + 1 });
        i = end + 1;
        continue;
      }
      i++;
      continue;
    }
    i++;
  }
  return spans;
}

// ---------------------------------------------------------------------------
// KaTeX 渲染（缓存）
// ---------------------------------------------------------------------------

/** 可注入的 renderToString（测试用 spy 断言缓存命中时不重复调用） */
export type RenderToStringFn = (tex: string, options: { displayMode: boolean }) => string;

const defaultRenderToString: RenderToStringFn = (tex, options) =>
  katexRenderToString(tex, {
    displayMode: options.displayMode,
    throwOnError: true,
    strict: false, // 中文等非 ASCII 内容不告警
  });

/** 渲染结果：成功时 html 为 KaTeX 输出；失败时 error 为原始错误信息（html 为空） */
export interface MathPreviewResult {
  html: string;
  error: string | null;
}

const previewCache = new Map<string, MathPreviewResult>();

/** 清空渲染缓存（测试隔离 / 文档语义变化时用） */
export function clearMathPreviewCache(): void {
  previewCache.clear();
}

/**
 * 渲染单个公式为 HTML，结果按 `tex|display` 键缓存：
 * 同一公式（含 display 形态）第二次渲染不会再次调用底层 renderToString。
 * KaTeX 抛错时返回 { html: '', error }，由调用方回退展示原始 TeX。
 */
export function renderMathPreview(
  tex: string,
  display: boolean,
  renderToString: RenderToStringFn = defaultRenderToString,
): MathPreviewResult {
  const key = `${tex}|${display ? '1' : '0'}`;
  const cached = previewCache.get(key);
  if (cached) return cached;
  let result: MathPreviewResult;
  try {
    result = { html: renderToString(tex, { displayMode: display }), error: null };
  } catch (err) {
    result = { html: '', error: err instanceof Error ? err.message : String(err) };
  }
  previewCache.set(key, result);
  return result;
}

/**
 * 构建浮层 DOM：成功放 KaTeX 渲染 HTML；失败放原始 TeX（code）+ 错误信息。
 * 仅操作 DOM 文本/innerHTML，不依赖任何外部 CSS 文件。
 */
export function createMathPreviewElement(
  tex: string,
  display: boolean,
  renderToString?: RenderToStringFn,
): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'sf-math-preview';
  const { html, error } = renderMathPreview(tex, display, renderToString);
  if (error === null) {
    dom.innerHTML = html;
  } else {
    const raw = document.createElement('code');
    raw.className = 'sf-math-preview-raw';
    raw.textContent = tex;
    const msg = document.createElement('div');
    msg.className = 'sf-math-preview-error';
    msg.textContent = error;
    dom.append(raw, msg);
  }
  return dom;
}
