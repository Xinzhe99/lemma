/**
 * citationSuggest 纯函数测试（node 环境，mock retrieve）。
 * 覆盖验收维度：query 构造（ASCII 1500 / CJK 800）、主路径映射（title 回查 / reason）、
 * 过滤已引、过滤无键、去重、空结果回退、异常回退、回退排序与截断、回退过滤、空文本短路。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Paper } from '@scholarforge/shared';
import {
  buildSuggestQuery,
  FALLBACK_LIMIT,
  RETRIEVE_K,
  SUGGEST_REASON_FALLBACK,
  SUGGEST_REASON_SEMANTIC,
  suggestCitations,
  type RetrieveFn,
} from './citationSuggest';

function makePaper(overrides: Partial<Paper> & Pick<Paper, 'id' | 'citekey' | 'title'>): Paper {
  return {
    authors: [{ family: 'Doe', given: 'Jane' }],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...overrides,
  };
}

const PAPERS: Paper[] = [
  makePaper({ id: 'a', citekey: 'vaswani2017attention', title: 'Attention Is All You Need', year: 2017 }),
  makePaper({ id: 'b', citekey: 'brown2020language', title: 'Language Models are Few-Shot Learners', year: 2020 }),
  makePaper({ id: 'c', citekey: 'openai2023gpt4', title: 'GPT-4 Technical Report', year: 2023 }),
];

describe('buildSuggestQuery', () => {
  it('ASCII 内容取尾部 ~1500 字符；不足 1500 时原样返回', () => {
    const long = 'x'.repeat(2000) + 'querytail';
    expect(buildSuggestQuery(long)).toBe(long.slice(-1500));
    expect(buildSuggestQuery('short text')).toBe('short text');
  });

  it('CJK 内容取尾部 ~800 字符（信息密度高，实现约定缩短窗口）', () => {
    const cjk = ' transformer'.repeat(120) + '文'.repeat(1000);
    expect(buildSuggestQuery(cjk)).toBe(cjk.slice(-800));
    // 尾部 CJK 占比低时不缩短
    expect(buildSuggestQuery('文'.repeat(100) + 'a'.repeat(1500))).toHaveLength(1500);
  });
});

describe('suggestCitations · 主路径', () => {
  it('retrieve 收到尾部 query 与 k=8；结果映射 title（papers 回查）与 reason', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'a', citekey: 'vaswani2017attention' },
      { paperId: 'unknown', citekey: 'ghost2024' }, // 不在 papers：title 回退 citekey
    ]);
    const text = 'y'.repeat(3000) + 'tail context about attention';
    const out = await suggestCitations(text, PAPERS, [], retrieve);

    expect(retrieve).toHaveBeenCalledTimes(1);
    expect(retrieve).toHaveBeenCalledWith(text.slice(-1500), RETRIEVE_K);
    expect(out).toEqual([
      { citekey: 'vaswani2017attention', title: 'Attention Is All You Need', reason: SUGGEST_REASON_SEMANTIC },
      { citekey: 'ghost2024', title: 'ghost2024', reason: SUGGEST_REASON_SEMANTIC },
    ]);
  });

  it('过滤已引：alreadyCited 中的 citekey 不出现在推荐里', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'a', citekey: 'vaswani2017attention' },
      { paperId: 'b', citekey: 'brown2020language' },
    ]);
    const out = await suggestCitations('text', PAPERS, ['vaswani2017attention'], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['brown2020language']);
  });

  it('过滤无键：citekey 缺失或空串的 chunk 被剔除', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'a' }, // 无 citekey
      { paperId: 'b', citekey: '   ' }, // 空白
      { paperId: 'c', citekey: 'openai2023gpt4' },
    ]);
    const out = await suggestCitations('text', PAPERS, [], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['openai2023gpt4']);
  });

  it('去重：同一 citekey（同篇多 chunk）只保留一条，且保持检索排序', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'c', citekey: 'openai2023gpt4' },
      { paperId: 'a', citekey: 'vaswani2017attention' },
      { paperId: 'c', citekey: 'openai2023gpt4' }, // 重复 citekey
      { paperId: 'c', citekey: 'openai2023gpt4' }, // 重复 paperId
    ]);
    const out = await suggestCitations('text', PAPERS, [], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['openai2023gpt4', 'vaswani2017attention']);
  });

  it('过滤后全空（全部已引）→ 回退路径', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'a', citekey: 'vaswani2017attention' },
    ]);
    const out = await suggestCitations('text', PAPERS, ['vaswani2017attention'], retrieve);
    expect(out.every((s) => s.reason === SUGGEST_REASON_FALLBACK)).toBe(true);
  });
});

describe('suggestCitations · 回退路径', () => {
  it('检索空结果 → papers 按 year 降序取前 5，reason 标注回退', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([]);
    const out = await suggestCitations('text', PAPERS, [], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['openai2023gpt4', 'brown2020language', 'vaswani2017attention']);
    expect(out.every((s) => s.reason === SUGGEST_REASON_FALLBACK)).toBe(true);
  });

  it('retrieve 抛异常 → 不外抛，走回退', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockRejectedValue(new Error('embed down'));
    const out = await suggestCitations('text', PAPERS, [], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['openai2023gpt4', 'brown2020language', 'vaswani2017attention']);
    expect(out.every((s) => s.reason === SUGGEST_REASON_FALLBACK)).toBe(true);
  });

  it('回退排序：year 降序、缺失年份排最后，且最多 FALLBACK_LIMIT 条', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([]);
    const papers = [
      makePaper({ id: 'p1', citekey: 'k1', title: 't1', year: 1998 }),
      makePaper({ id: 'p2', citekey: 'k2', title: 't2' }), // 无年份
      makePaper({ id: 'p3', citekey: 'k3', title: 't3', year: 2024 }),
      makePaper({ id: 'p4', citekey: 'k4', title: 't4', year: 2021 }),
      makePaper({ id: 'p5', citekey: 'k5', title: 't5', year: 2005 }),
      makePaper({ id: 'p6', citekey: 'k6', title: 't6', year: 2010 }),
      makePaper({ id: 'p7', citekey: 'k7', title: 't7', year: 1999 }),
    ];
    const out = await suggestCitations('text', papers, [], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['k3', 'k4', 'k6', 'k5', 'k7']); // k2 无年份垫底被截断
    expect(out).toHaveLength(FALLBACK_LIMIT);
  });

  it('回退同样过滤已引与无 citekey 条目', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([]);
    const papers = [
      makePaper({ id: 'p1', citekey: 'cited', title: 'already cited', year: 2025 }),
      makePaper({ id: 'p2', citekey: '', title: 'no key', year: 2024 }),
      makePaper({ id: 'p3', citekey: 'k3', title: 't3', year: 2020 }),
    ];
    const out = await suggestCitations('text', papers, ['cited'], retrieve);
    expect(out.map((s) => s.citekey)).toEqual(['k3']);
  });

  it('空文本（query 为空）直接回退，不调用 retrieve', async () => {
    const retrieve = vi.fn<RetrieveFn>().mockResolvedValue([
      { paperId: 'a', citekey: 'vaswani2017attention' },
    ]);
    const out = await suggestCitations('', PAPERS, [], retrieve);
    expect(retrieve).not.toHaveBeenCalled();
    expect(out.every((s) => s.reason === SUGGEST_REASON_FALLBACK)).toBe(true);
  });
});
