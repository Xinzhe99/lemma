// @vitest-environment jsdom
/**
 * 零依赖 markdown 渲染器测试：块级 / 行内 / 表格 / 围栏嵌套段落 /
 * 链接协议白名单 / 引用 chip 回调 / 空输入 / 纯文本直通。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { renderMarkdown } from './markdown';

function md(text: string, onCitekeyClick?: (key: string) => void) {
  return render(<div data-testid="md">{renderMarkdown(text, { onCitekeyClick })}</div>);
}

describe('renderMarkdown 块级', () => {
  it('渲染 #~#### 各级标题', () => {
    const { container } = md('# 标题一\n## 标题二\n### 标题三\n#### 标题四');
    expect(container.querySelector('h1')?.textContent).toBe('标题一');
    expect(container.querySelector('h2')?.textContent).toBe('标题二');
    expect(container.querySelector('h3')?.textContent).toBe('标题三');
    expect(container.querySelector('h4')?.textContent).toBe('标题四');
    expect(container.querySelector('h5')).toBeNull();
  });

  it('渲染 --- 分隔线与两侧段落', () => {
    const { container } = md('上文\n\n---\n\n下文');
    expect(container.querySelectorAll('hr.sf-ah-md-hr')).toHaveLength(1);
    const ps = container.querySelectorAll('p.sf-ah-md-p');
    expect(ps).toHaveLength(2);
    expect(ps[0]!.textContent).toBe('上文');
    expect(ps[1]!.textContent).toBe('下文');
  });

  it('围栏代码块：多行内容 + 语言标注', () => {
    const { container } = md('```python\nx = 1\ny = x + 2\n```');
    expect(container.querySelector('.sf-ah-md-code-lang')?.textContent).toBe('python');
    expect(container.querySelector('pre.sf-ah-md-pre code')?.textContent).toBe('x = 1\ny = x + 2');
  });

  it('未闭合围栏容忍：剩余行仍按代码渲染', () => {
    const { container } = md('```\nabc\ndef');
    expect(container.querySelector('pre code')?.textContent).toBe('abc\ndef');
  });

  it('围栏之后的段落正常解析（嵌套段落）', () => {
    const { container } = md('```\ncode\n```\n\n段落文字');
    expect(container.querySelector('pre code')?.textContent).toBe('code');
    expect(container.querySelector('p.sf-ah-md-p')?.textContent).toBe('段落文字');
  });

  it('引用块：连续 > 行合并，内容含行内样式', () => {
    const { container } = md('> 引用第一行\n> 引用**加粗**第二行');
    const q = container.querySelector('blockquote.sf-ah-md-quote');
    expect(q?.textContent).toContain('引用第一行');
    expect(q?.querySelector('strong')?.textContent).toBe('加粗');
  });

  it('无序列表嵌套一层', () => {
    const { container } = md('- 甲\n- 乙\n  - 乙1\n  - 乙2');
    const top = container.querySelector('ul.sf-ah-md-list');
    const topItems = Array.from(top?.children ?? []).filter((el) => el.tagName === 'LI');
    expect(topItems).toHaveLength(2);
    const nested = top?.querySelector('li > ul');
    expect(nested?.querySelectorAll('li')).toHaveLength(2);
    expect(nested?.textContent).toContain('乙1');
    expect(nested?.textContent).toContain('乙2');
  });

  it('有序列表', () => {
    const { container } = md('1. 第一步\n2. 第二步');
    const ol = container.querySelector('ol.sf-ah-md-list');
    expect(ol?.querySelectorAll('li')).toHaveLength(2);
    expect(ol?.textContent).toContain('第一步');
  });

  it('表格：表头 / 表体 / 对齐 / 滚动容器', () => {
    const { container } = md('| 列A | 列B |\n| --- | :--: |\n| 1 | **粗** |\n| 2 | 普通 |');
    expect(container.querySelector('.sf-ah-md-tablewrap table.sf-ah-md-table')).toBeTruthy();
    const ths = container.querySelectorAll('thead th');
    expect(ths[0]!.textContent).toBe('列A');
    expect(ths[1]!.textContent).toBe('列B');
    expect((ths[1] as HTMLElement).style.textAlign).toBe('center');
    const tds = container.querySelectorAll('tbody td');
    expect(tds).toHaveLength(4);
    expect(container.querySelector('tbody strong')?.textContent).toBe('粗');
  });
});

describe('renderMarkdown 行内', () => {
  it('粗体 / 斜体 / 行内 code / 删除线', () => {
    const { container } = md('**粗** 和 *斜* 和 `码` 和 ~~删~~');
    expect(container.querySelector('strong')?.textContent).toBe('粗');
    expect(container.querySelector('em')?.textContent).toBe('斜');
    expect(container.querySelector('code.sf-ah-md-code-inline')?.textContent).toBe('码');
    expect(container.querySelector('del')?.textContent).toBe('删');
  });

  it('http(s) 链接：新窗口 + noopener', () => {
    const { container } = md('[官网](https://example.com/a?b=1)');
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://example.com/a?b=1');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
    expect(a?.textContent).toBe('官网');
  });

  it('链接协议白名单：javascript: 不渲染为链接，按原文输出', () => {
    const { container } = md('[点我](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container.querySelector('[data-testid="md"]')?.textContent).toContain('点我');
    expect(container.querySelector('[data-testid="md"]')?.textContent).toContain('javascript:alert(1)');
  });

  it('未闭合的行内标记按原文输出', () => {
    const single = md('a * b');
    expect(single.container.querySelector('em')).toBeNull();
    expect(single.container.querySelector('p')?.textContent).toBe('a * b');
    const dbl = md('x ** y');
    expect(dbl.container.querySelector('strong')).toBeNull();
    expect(dbl.container.querySelector('em')).toBeNull();
    expect(dbl.container.querySelector('p')?.textContent).toBe('x ** y');
  });
});

describe('renderMarkdown 引用 chip', () => {
  it('行内 code 形式 `[citekey]` 渲染为可点 chip 并回调 key', () => {
    const onCitekeyClick = vi.fn();
    const { container } = md('参见 `[vaswani2017attention]` 一文。', onCitekeyClick);
    const chip = container.querySelector('button.sf-ah-md-cite');
    expect(chip?.textContent).toBe('[vaswani2017attention]');
    expect(chip?.getAttribute('data-citekey')).toBe('vaswani2017attention');
    fireEvent.click(chip!);
    expect(onCitekeyClick).toHaveBeenCalledWith('vaswani2017attention');
  });

  it('带页码定位 `[key p.12]`：chip 显示全文，回调只给 key', () => {
    const onCitekeyClick = vi.fn();
    const { container } = md('见 `[key p.12]`。', onCitekeyClick);
    const chip = container.querySelector('button.sf-ah-md-cite');
    expect(chip?.textContent).toBe('[key p.12]');
    fireEvent.click(chip!);
    expect(onCitekeyClick).toHaveBeenCalledWith('key');
  });

  it('转义括号形式 \\[key\\] 也渲染为 chip', () => {
    const onCitekeyClick = vi.fn();
    const { container } = md('见 \\[devlin2019bert\\] 一文', onCitekeyClick);
    const chip = container.querySelector('button.sf-ah-md-cite');
    expect(chip?.getAttribute('data-citekey')).toBe('devlin2019bert');
    fireEvent.click(chip!);
    expect(onCitekeyClick).toHaveBeenCalledWith('devlin2019bert');
  });

  it('无回调时 chip 静态展示（span、不可点）', () => {
    const { container } = md('`[vaswani2017attention]`');
    const chip = container.querySelector('.sf-ah-md-cite');
    expect(chip).toBeTruthy();
    expect(chip?.tagName).toBe('SPAN');
    expect(chip?.classList.contains('sf-ah-md-cite--plain')).toBe(true);
  });

  it('普通行内 code 不误判为引用（如 [x] 或含空格代码）', () => {
    const { container } = md('`[x]` 与 `a + b = c`');
    expect(container.querySelector('.sf-ah-md-cite')).toBeNull();
    expect(container.querySelectorAll('code.sf-ah-md-code-inline')).toHaveLength(2);
  });
});

describe('renderMarkdown 边界', () => {
  it('空输入返回 null（容器无子节点）', () => {
    const { container } = md('');
    expect(container.querySelector('[data-testid="md"]')?.children.length).toBe(0);
  });

  it('纯文本直通为单个段落', () => {
    const { container } = md('只是一句话');
    const root = container.querySelector('[data-testid="md"]')!;
    expect(root.children).toHaveLength(1);
    expect(root.firstElementChild?.tagName).toBe('P');
    expect(root.firstElementChild?.textContent).toBe('只是一句话');
  });
});
