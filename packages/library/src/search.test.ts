import { describe, expect, it } from 'vitest';
import { buildArxivQuery, mergeSearchHits, searchArxiv, searchCrossref, type PaperSearchHit } from './search';
import type { Http } from './fetchers';

function mockHttp(body: string, init: { status?: number; contentType?: string } = {}): Http {
  return {
    fetch: async () =>
      new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'text/plain' },
      }),
  };
}

const ARXIV_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>http://arxiv.org/abs/2303.08774v1</id>
    <published>2023-03-14T17:21:20-04:00</published>
    <title>GPT-4 Technical Report</title>
    <summary>We report the development of GPT-4, a large-scale, multimodal model.</summary>
    <author><name>OpenAI</name></author>
    <author><name>Autor, Bete</name></author>
    <category term="cs.CL" />
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.5555/gpt4</arxiv:doi>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T15:48:14-04:00</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on recurrent networks.</summary>
    <author><name>Vaswani, Ashish</name></author>
    <category term="cs.CL" />
  </entry>
</feed>`;

const CROSSREF_JSON = JSON.stringify({
  status: 'ok',
  message: {
    items: [
      {
        DOI: '10.1000/demo-1',
        type: 'journal-article',
        title: ['A Demo Paper on  <i>Writing</i> Tools'],
        author: [
          { family: 'Zhang', given: 'Wei' },
          { name: 'Some Institute' },
        ],
        'container-title': ['Journal of Demo Studies'],
        issued: { 'date-parts': [[2021, 5]] },
        abstract: '<p>An <b>abstract</b> with tags.</p>',
      },
      {
        DOI: '10.1000/demo-2',
        type: 'proceedings-article',
        title: ['Second Hit'],
        'container-title': ['DemoConf 2020'],
        issued: { 'date-parts': [[2020]] },
      },
    ],
  },
});

describe('searchArxiv', () => {
  it('解析 Atom 命中并映射字段', async () => {
    const hits = await searchArxiv('gpt-4 technical report', mockHttp(ARXIV_ATOM, { contentType: 'application/atom+xml' }), 10);
    expect(hits).toHaveLength(2);
    const first = hits[0]!;
    expect(first.source).toBe('arxiv');
    expect(first.title).toBe('GPT-4 Technical Report');
    expect(first.arxivId).toBe('2303.08774v1');
    expect(first.year).toBe(2023);
    expect(first.doi).toBe('10.5555/gpt4');
    expect(first.tags).toContain('cs.CL');
    expect(first.authors[0]).toEqual({ family: 'OpenAI' });
    expect(first.authors[1]).toEqual({ family: 'Autor', given: 'Bete' });
    expect(first.abstract).toContain('large-scale');
  });

  it('空检索词抛错；HTTP 失败抛错并带状态码', async () => {
    await expect(searchArxiv('  ', mockHttp(''))).rejects.toThrow('检索词不能为空');
    await expect(searchArxiv('x', mockHttp('nope', { status: 500 }))).rejects.toThrow('HTTP 500');
  });

  it('buildArxivQuery 组装 AND 查询', () => {
    expect(buildArxivQuery('video generation')).toBe('all:video+AND+all:generation');
  });
});

describe('searchCrossref', () => {
  it('解析 JSON 命中：作者/年份/venue 类型/摘要剥标签', async () => {
    const hits = await searchCrossref('writing tools', mockHttp(CROSSREF_JSON, { contentType: 'application/json' }), 10);
    expect(hits).toHaveLength(2);
    const [a, b] = hits;
    expect(a!.source).toBe('crossref');
    expect(a!.title).toBe('A Demo Paper on Writing Tools');
    expect(a!.authors).toEqual([
      { family: 'Zhang', given: 'Wei' },
      { family: 'Some Institute' },
    ]);
    expect(a!.year).toBe(2021);
    expect(a!.venue?.type).toBe('journal');
    expect(a!.venue?.name).toBe('Journal of Demo Studies');
    expect(a!.abstract).toBe('An abstract with tags.');
    expect(b!.venue?.type).toBe('conference');
    expect(b!.year).toBe(2020);
  });

  it('HTTP 失败抛中文错误', async () => {
    await expect(searchCrossref('x', mockHttp('', { status: 503 }))).rejects.toThrow('HTTP 503');
  });
});

describe('mergeSearchHits', () => {
  const base = { authors: [], tags: [] };
  it('按 doi / arxivId / 标题去重', () => {
    const hits: PaperSearchHit[] = [
      { ...base, source: 'arxiv', title: 'Same Paper', doi: '10.1/x', arxivId: '2401.00001' },
      { ...base, source: 'crossref', title: 'Same Paper (Journal Version)', doi: '10.1/x' },
      { ...base, source: 'arxiv', title: 'Another', arxivId: '2401.00002' },
      { ...base, source: 'arxiv', title: 'Another', arxivId: '2401.00002' },
      { ...base, source: 'crossref', title: 'No Id Paper' },
      { ...base, source: 'arxiv', title: 'no id paper' },
    ];
    const merged = mergeSearchHits(hits);
    // doi 去重(1) + arxivId 去重(1) + 标题去重（大小写不敏感，两条合一）= 3
    expect(merged).toHaveLength(3);
    expect(merged[0]!.title).toBe('Same Paper');
    expect(merged[1]!.title).toBe('Another');
    expect(merged[2]!.title).toBe('No Id Paper');
  });
});
