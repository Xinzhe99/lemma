/**
 * WS-3：searchProject 纯函数单测（node 环境即可）。
 * 覆盖：多文件多行基础命中与列偏移、大小写翻转、整词边界（cite 不匹配 citekey、
 * CJK 连续串精确匹配）、空 query、limit 截断与 truncated 标记、超长行窗口、
 * 空文件 / >2MB / .synctex 排除规则、trimStart 后原始列位置、同行多命中。
 */
import { describe, expect, it } from 'vitest';
import { searchProject, type SearchHit } from './searchProject';

/** 断言某条命中：text.slice(matchStart, matchEnd) 恰为命中原文 */
function expectSelfConsistent(hit: SearchHit, query: string) {
  expect(hit.text.slice(hit.matchStart, hit.matchEnd)).toBe(query);
}

describe('searchProject 基础命中', () => {
  const files = {
    'main.tex': '\\documentclass{article}\n\\usepackage{graphicx}\nsee \\ref{fig:demo} below',
    'sections/intro.tex': 'first line\nthe figure shows \\ref{fig:demo} clearly',
    'refs.bib': 'no refs here',
  };

  it('空 query 返回空结果', () => {
    expect(searchProject(files, '')).toEqual({ hits: [], truncated: false });
  });

  it('多文件多行：按文件顺序返回，file/line 正确（1-based）', () => {
    const { hits, truncated } = searchProject(files, 'fig:demo');
    expect(truncated).toBe(false);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({ file: 'main.tex', line: 3 });
    expect(hits[1]).toMatchObject({ file: 'sections/intro.tex', line: 2 });
  });

  it('matchStart/matchEnd 相对 text 且自洽（slice 即命中原文）', () => {
    const { hits } = searchProject(files, 'fig:demo');
    for (const hit of hits) expectSelfConsistent(hit, 'fig:demo');
    expect(hits[0]!.text).toBe('see \\ref{fig:demo} below');
    expect(hits[0]!.matchStart).toBe(9);
  });

  it('命中词嵌入行中：text 保留整行（未超窗口），列偏移正确', () => {
    const { hits } = searchProject({ 'a.tex': 'one two three' }, 'two');
    expect(hits[0]).toMatchObject({ text: 'one two three', matchStart: 4, matchEnd: 7 });
  });

  it('同一行多个命中各返回一条', () => {
    const { hits } = searchProject({ 'a.tex': 'bib bib bib' }, 'bib');
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.matchStart)).toEqual([0, 4, 8]);
  });
});

describe('大小写', () => {
  const files = { 'a.tex': 'CITE upper\ncite lower\nCiTe mixed' };

  it('默认大小写不敏感（全命中）', () => {
    const { hits } = searchProject(files, 'cite');
    expect(hits).toHaveLength(3);
  });

  it('caseSensitive: true 只命中精确大小写', () => {
    const { hits } = searchProject(files, 'cite', { caseSensitive: true });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.line).toBe(2);
    const upper = searchProject(files, 'CITE', { caseSensitive: true });
    expect(upper.hits[0]!.line).toBe(1);
  });

  it('大小写不敏感时命中原文保持原行原样（非小写化文本）', () => {
    const { hits } = searchProject(files, 'cite');
    expect(hits[0]!.text).toBe('CITE upper');
    expectSelfConsistent(hits[0]!, 'CITE');
  });
});

describe('整词（wholeWord）', () => {
  const files = { 'a.tex': 'cite this\ncitekey not matched\na cite-bounded ok\nuncite no' };

  it('拉丁词边界：cite 不匹配 citekey / uncite，匹配独立词与连字符边界', () => {
    const { hits } = searchProject(files, 'cite', { wholeWord: true });
    // 行1 独立词、行3 “cite-bounded” 中连字符是边界；行2 citekey、行4 uncite 均排除
    expect(hits.map((h) => h.line)).toEqual([1, 3]);
  });

  it('不带整词时 citekey 内的 cite 也命中（对照）', () => {
    const { hits } = searchProject(files, 'cite');
    expect(hits.map((h) => h.line)).toEqual([1, 2, 3, 4]);
  });

  it('整词模式对大小写不敏感查询同样生效', () => {
    const { hits } = searchProject({ 'b.tex': 'CITEKEY x\nCITE y' }, 'cite', { wholeWord: true });
    expect(hits.map((h) => h.line)).toEqual([2]);
  });

  it('CJK 整词：连续串精确匹配，相邻汉字不部分命中', () => {
    const files = { 'c.tex': '这是神经网络模型\n网络 图表\n见图说' };
    // “网络” 在 “神经网络” 内不命中；行2 的独立 “网络” 命中；行3 “见图说” 不命中
    const { hits } = searchProject(files, '网络', { wholeWord: true });
    expect(hits.map((h) => h.line)).toEqual([2]);
    // 非整词模式：行1、行2、行3 的 “网络” 均命中（行3 无 “网络”，实为 2 条）
    expect(searchProject(files, '网络').hits.map((h) => h.line)).toEqual([1, 2]);
  });

  it('CJK 单字整词：前后无汉字（行首/空格/标点）才命中', () => {
    const files = { 'd.tex': '图 与表\n一张图多地\n见图说，图 三' };
    const { hits } = searchProject(files, '图', { wholeWord: true });
    // 行1 行首命中；行2 前后都是汉字不命中；行3 “见图说” 不命中，但 “，图 ” 命中
    expect(hits.map((h) => h.line)).toEqual([1, 3]);
  });
});

describe('排除规则', () => {
  it('空文件跳过；命中文件不受影响', () => {
    const { hits } = searchProject({ 'empty.tex': '', 'a.tex': 'hit here' }, 'hit');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.file).toBe('a.tex');
  });

  it('超过 2MB 的文件跳过', () => {
    const big = 'x'.repeat(2 * 1024 * 1024) + ' needle';
    const { hits } = searchProject({ 'big.tex': big, 'a.tex': 'needle small' }, 'needle');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.file).toBe('a.tex');
  });

  it('.synctex 与 .synctex.gz 跳过，同项目 .tex 不受影响', () => {
    const files = {
      'main.synctex': 'needle in synctex',
      'main.synctex.gz': 'needle in gz',
      'main.tex': 'needle in tex',
    };
    const { hits } = searchProject(files, 'needle');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.file).toBe('main.tex');
  });
});

describe('limit 截断', () => {
  // 3 个文件各 3 行命中 → 共 9 条
  const mkFiles = () => ({
    'a.tex': 'needle\nneedle\nneedle',
    'b.tex': 'needle\nneedle\nneedle',
    'c.tex': 'needle\nneedle\nneedle',
  });

  it('limit 截断：返回前 limit 条且 truncated=true', () => {
    const { hits, truncated } = searchProject(mkFiles(), 'needle', { limit: 4 });
    expect(truncated).toBe(true);
    expect(hits).toHaveLength(4);
  });

  it('limit 恰等于命中总数：不截断', () => {
    const { hits, truncated } = searchProject(mkFiles(), 'needle', { limit: 9 });
    expect(truncated).toBe(false);
    expect(hits).toHaveLength(9);
  });

  it('默认 limit 500：601 行命中 → 500 条 + truncated', () => {
    const lines = Array.from({ length: 601 }, (_, i) => `needle ${i}`).join('\n');
    const { hits, truncated } = searchProject({ 'a.tex': lines }, 'needle');
    expect(truncated).toBe(true);
    expect(hits).toHaveLength(500);
  });

  it('未超 limit 时 truncated=false', () => {
    const { truncated } = searchProject(mkFiles(), 'needle');
    expect(truncated).toBe(false);
  });
});

describe('截断窗口与 trimStart', () => {
  it('trimStart 后 matchStart 反映原始列位置（前导空格平移）', () => {
    const { hits } = searchProject({ 'a.tex': '      indent then needle tail' }, 'needle');
    expect(hits[0]!.text).toBe('indent then needle tail');
    expectSelfConsistent(hits[0]!, 'needle');
    expect(hits[0]!.matchStart).toBe(12); // 原始列 18 - 前导空白 6
  });

  it('超长行：命中在 160 窗口之外时窗口贴住命中，以 … 标记越界侧', () => {
    const line = 'x'.repeat(200) + 'needle' + 'y'.repeat(200);
    const { hits } = searchProject({ 'a.tex': line }, 'needle');
    const hit = hits[0]!;
    expect(hit.text.startsWith('…')).toBe(true);
    expect(hit.text.endsWith('…')).toBe(true);
    expect(hit.text).toHaveLength(162); // 160 窗口 + 两个省略号
    expectSelfConsistent(hit, 'needle');
  });

  it('超长行但命中在前 160 字符内：只截尾部', () => {
    const line = 'needle' + 'x'.repeat(400);
    const { hits } = searchProject({ 'a.tex': line }, 'needle');
    const hit = hits[0]!;
    expect(hit.text.startsWith('needle')).toBe(true);
    expect(hit.text.endsWith('…')).toBe(true);
    expect(hit.matchStart).toBe(0);
    expect(hit.matchEnd).toBe(6);
  });

  it('行尾命中且行尾含空白：仅 trimStart，行尾空白原样保留', () => {
    const { hits } = searchProject({ 'a.tex': 'tail has needle   ' }, 'needle');
    expect(hits[0]!.text).toBe('tail has needle   ');
    expectSelfConsistent(hits[0]!, 'needle');
  });
});
