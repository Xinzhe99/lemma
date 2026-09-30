// @vitest-environment jsdom
/**
 * mathPreview 测试：定界符扫描（四类定界符 / 转义 / 注释 / 跨行）+ KaTeX 渲染缓存。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearMathPreviewCache,
  createMathPreviewElement,
  extractMathSpans,
  renderMathPreview,
  type MathSpan,
} from './mathPreview';

/** 便捷断言：只比较关心的字段 */
function slim(spans: MathSpan[]) {
  return spans.map((s) => ({ tex: s.tex, display: s.display, from: s.from, to: s.to }));
}

describe('extractMathSpans', () => {
  it('内联 $...$：位置含定界符，tex 为定界符内原文', () => {
    const doc = 'a $x$ b';
    //        0 12 3 45 6
    expect(slim(extractMathSpans(doc))).toEqual([
      { tex: 'x', display: false, from: 2, to: 5 },
    ]);
  });

  it('内联 \\(...\\)', () => {
    const doc = 'a \\(x+y\\) b';
    //        0 1 23 4..7 89
    expect(slim(extractMathSpans(doc))).toEqual([
      { tex: 'x+y', display: false, from: 2, to: 9 },
    ]);
  });

  it('行间 $$...$$', () => {
    const doc = 'a $$x^2$$';
    expect(slim(extractMathSpans(doc))).toEqual([
      { tex: 'x^2', display: true, from: 2, to: 9 },
    ]);
  });

  it('行间 \\[...\\]', () => {
    const doc = 'a \\[x\\] b';
    expect(slim(extractMathSpans(doc))).toEqual([
      { tex: 'x', display: true, from: 2, to: 7 },
    ]);
  });

  it('行间公式跨行：$$ 与 $$ 分布在不同行', () => {
    const doc = '$$\nE = mc^2\n$$';
    const spans = extractMathSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.display).toBe(true);
    expect(spans[0]!.tex).toBe('E = mc^2');
    expect(spans[0]!.from).toBe(0);
    expect(spans[0]!.to).toBe(doc.length);
  });

  it('\\[...\\] 跨行同样识别', () => {
    const doc = 'text\n\\[\n\\int_0^1 x\\,dx\n\\]\ntail';
    const spans = extractMathSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.display).toBe(true);
    expect(spans[0]!.tex).toBe('\\int_0^1 x\\,dx');
  });

  it('定界符内 \\$ 转义不误判为闭合', () => {
    const doc = '$a \\$ b$';
    const spans = extractMathSpans(doc);
    expect(spans).toHaveLength(1);
    expect(spans[0]!.tex).toBe('a \\$ b');
    expect(spans[0]!.to).toBe(doc.length);
  });

  it('\\$ 之后的 $ 不当定界符起点，后续真公式仍识别', () => {
    const doc = '价格 \\$5 与 $x$';
    expect(slim(extractMathSpans(doc))).toEqual([
      { tex: 'x', display: false, from: 9, to: 12 },
    ]);
  });

  it('注释行整体跳过：% 后的公式不识别', () => {
    expect(extractMathSpans('% $x$ 与 \\(y\\)')).toEqual([]);
  });

  it('行内注释被忽略：正文 % 之后的定界符不识别', () => {
    expect(extractMathSpans('text % $x$ more')).toEqual([]);
  });

  it('注释前仍正常：注释定界符之前的部分照常扫描', () => {
    // `$a$` 在注释前，`$b$` 在注释后（不识别）
    expect(slim(extractMathSpans('$a$ % $b$'))).toEqual([
      { tex: 'a', display: false, from: 0, to: 3 },
    ]);
  });

  it('未闭合定界符按普通文本跳过', () => {
    expect(extractMathSpans('abc $x')).toEqual([]);
    expect(extractMathSpans('abc $$x')).toEqual([]);
    expect(extractMathSpans('abc \\(x')).toEqual([]);
    expect(extractMathSpans('abc \\[x')).toEqual([]);
  });

  it('同一段落多个公式按顺序返回', () => {
    const doc = '$a$ 与 $b$';
    const spans = extractMathSpans(doc);
    expect(spans.map((s) => s.tex)).toEqual(['a', 'b']);
    expect(spans[0]!.from).toBeLessThan(spans[1]!.from);
    expect(spans[1]!.to).toBe(doc.length);
  });

  it('$a$$b$ 拆成两个内联公式（$$ 未构成行间对）', () => {
    expect(extractMathSpans('$a$$b$').map((s) => s.tex)).toEqual(['a', 'b']);
  });

  it('\\\\( 不开启数学：换行命令后的括号是普通文本', () => {
    expect(extractMathSpans('a \\\\(x')).toEqual([]);
  });

  it('空内容定界符不产出 span；无公式文档返回空数组', () => {
    expect(extractMathSpans('$$ $$ $ $')).toEqual([]);
    expect(extractMathSpans('plain text')).toEqual([]);
    expect(extractMathSpans('')).toEqual([]);
  });

  it('真实文档片段：equation 环境、\\% 转义注释不受干扰', () => {
    const doc = [
      '\\section{方法}', // 0
      '合格率 \\% 如下 $p<0.05$。', // \$→\% 转义注释不开启注释
      '\\begin{equation}', // 无 $/\\[ 定界符，不识别
      '  x = 1',
      '\\end{equation}',
      '\\[ y = 2 \\]',
    ].join('\n');
    const spans = extractMathSpans(doc);
    expect(spans.map((s) => ({ tex: s.tex, display: s.display }))).toEqual([
      { tex: 'p<0.05', display: false },
      { tex: 'y = 2', display: true },
    ]);
  });
});

describe('renderMathPreview（KaTeX 渲染 + 缓存）', () => {
  beforeEach(() => {
    clearMathPreviewCache();
  });

  it('同一公式第二次渲染命中缓存（注入 spy 只调用一次）', () => {
    const spy = vi.fn((tex: string) => `<k>${tex}</k>`);
    const first = renderMathPreview('E=mc^2', false, spy);
    const second = renderMathPreview('E=mc^2', false, spy);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.html).toBe('<k>E=mc^2</k>');
    expect(first.error).toBeNull();
  });

  it('缓存键区分 display 形态：同 tex 不同 display 各渲染一次', () => {
    const spy = vi.fn((tex: string) => `<k>${tex}</k>`);
    renderMathPreview('x', false, spy);
    renderMathPreview('x', true, spy);
    renderMathPreview('x', false, spy);
    renderMathPreview('x', true, spy);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenNthCalledWith(1, 'x', { displayMode: false });
    expect(spy).toHaveBeenNthCalledWith(2, 'x', { displayMode: true });
  });

  it('KaTeX 抛错时返回 error 信息且不抛出', () => {
    const spy = vi.fn(() => {
      throw new Error('ParseError:Unexpected');
    });
    const result = renderMathPreview('\\frac{', false, spy);
    expect(result.error).toBe('ParseError:Unexpected');
    expect(result.html).toBe('');
    // 错误结果同样被缓存
    expect(renderMathPreview('\\frac{', false, spy).error).toBe('ParseError:Unexpected');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('默认渲染器走真实 KaTeX：内联/行间输出与错误回退', () => {
    const ok = renderMathPreview('\\frac{a}{b}', false);
    expect(ok.error).toBeNull();
    expect(ok.html).toContain('katex');

    const bad = renderMathPreview('\\thisIsNotACommand', false);
    expect(bad.error).not.toBeNull();
  });

  it('clearMathPreviewCache 后重新渲染', () => {
    const spy = vi.fn((tex: string) => `<k>${tex}</k>`);
    renderMathPreview('q', false, spy);
    clearMathPreviewCache();
    renderMathPreview('q', false, spy);
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('createMathPreviewElement（浮层 DOM）', () => {
  beforeEach(() => {
    clearMathPreviewCache();
  });

  it('成功：注入 KaTeX 渲染 HTML', () => {
    const dom = createMathPreviewElement('x', false, (tex) => `<span class="katex">${tex}</span>`);
    expect(dom.className).toBe('sf-math-preview');
    expect(dom.querySelector('.katex')?.textContent).toBe('x');
  });

  it('失败：展示原始 TeX + 错误信息（textContent 注入，无 XSS）', () => {
    const dom = createMathPreviewElement('\\bad{', false, () => {
      throw new Error('boom <img>');
    });
    expect(dom.querySelector('.sf-math-preview-raw')?.textContent).toBe('\\bad{');
    expect(dom.querySelector('.sf-math-preview-error')?.textContent).toBe('boom <img>');
    expect(dom.querySelector('img')).toBeNull();
  });
});
