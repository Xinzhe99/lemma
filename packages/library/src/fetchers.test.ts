import { describe, expect, it } from 'vitest';
import { fetchByArxiv, fetchByDoi, type Http } from './fetchers';

function mockHttp(body: string, init: { status?: number; contentType?: string } = {}): Http & { urls: string[] } {
  const urls: string[] = [];
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url);
      return new Response(body, {
        status: init.status ?? 200,
        headers: { 'content-type': init.contentType ?? 'text/plain' },
      });
    },
  };
}

const CROSSREF_FIXTURE = JSON.stringify({
  status: 'ok',
  message: {
    DOI: '10.1145/3065386',
    type: 'journal-article',
    title: ['ImageNet Classification with Deep Convolutional Neural Networks'],
    author: [
      { given: 'Alex', family: 'Krizhevsky', ORCID: 'http://orcid.org/0000-0002-6789-0123' },
      { given: 'Ilya', family: 'Sutskever' },
    ],
    'container-title': ['Communications of the ACM'],
    issued: { 'date-parts': [[2017, 6, 12]] },
    volume: '60',
    issue: '6',
    page: '84-90',
    abstract: '<jats:p>We review <jats:italic>AlexNet</jats:italic> &amp; its impact.</jats:p>',
  },
});

const ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query" rel="self" type="application/atom+xml"/>
  <title>ArXiv Query</title>
  <id>http://arxiv.org/api/query</id>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:58:59-04:00</published>
    <title>Attention Is All You Need</title>
    <summary>The dominant sequence transduction models are based on
      recurrent neural networks.</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.5555/3294771.3294856</arxiv:doi>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.AI" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

describe('fetchByDoi', () => {
  it('请求 Crossref 并映射为 Paper', async () => {
    const http = mockHttp(CROSSREF_FIXTURE, { contentType: 'application/json' });
    const paper = await fetchByDoi('10.1145/3065386', http);

    expect(http.urls[0]).toBe('https://api.crossref.org/works/10.1145%2F3065386');
    expect(paper.title).toBe('ImageNet Classification with Deep Convolutional Neural Networks');
    expect(paper.citekey).toBe('');
    expect(paper.year).toBe(2017);
    expect(paper.authors).toEqual([
      { family: 'Krizhevsky', given: 'Alex', orcid: '0000-0002-6789-0123' },
      { family: 'Sutskever', given: 'Ilya' },
    ]);
    expect(paper.venue?.type).toBe('journal');
    expect(paper.venue?.name).toBe('Communications of the ACM');
    expect(paper.venue?.volume).toBe('60');
    expect(paper.venue?.pages).toBe('84-90');
    expect(paper.doi).toBe('10.1145/3065386');
    expect(paper.abstract).toBe('We review AlexNet & its impact.');
  });

  it('带 URL 前缀的 DOI 会被归一化', async () => {
    const http = mockHttp(CROSSREF_FIXTURE, { contentType: 'application/json' });
    await fetchByDoi('https://doi.org/10.1145/3065386', http);
    expect(http.urls[0]).toBe('https://api.crossref.org/works/10.1145%2F3065386');
  });

  it('非 2xx 响应抛出中文错误', async () => {
    const http = mockHttp('not found', { status: 404 });
    await expect(fetchByDoi('10.9999/missing', http)).rejects.toThrow('HTTP 404');
  });
});

describe('fetchByArxiv', () => {
  it('请求 arXiv Atom API 并映射为 Paper', async () => {
    const http = mockHttp(ARXIV_FIXTURE, { contentType: 'application/atom+xml' });
    const paper = await fetchByArxiv('1706.03762', http);

    expect(http.urls[0]).toBe('https://export.arxiv.org/api/query?id_list=1706.03762');
    expect(paper.title).toBe('Attention Is All You Need');
    expect(paper.citekey).toBe('');
    expect(paper.year).toBe(2017);
    expect(paper.authors).toEqual([
      { family: 'Vaswani', given: 'Ashish' },
      { family: 'Shazeer', given: 'Noam' },
    ]);
    expect(paper.abstract).toContain('recurrent neural networks');
    expect(paper.arxivId).toBe('1706.03762v7');
    expect(paper.doi).toBe('10.5555/3294771.3294856');
    expect(paper.venue?.type).toBe('preprint');
    expect(paper.tags).toEqual(['cs.CL', 'cs.AI']);
  });

  it('非 2xx 响应抛出中文错误', async () => {
    const http = mockHttp('boom', { status: 500 });
    await expect(fetchByArxiv('9999.99999', http)).rejects.toThrow('HTTP 500');
  });

  it('空结果（无 entry）抛出中文错误', async () => {
    const http = mockHttp(
      '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>ArXiv Query</title></feed>',
    );
    await expect(fetchByArxiv('0000.00000', http)).rejects.toThrow('未返回有效条目');
  });
});
