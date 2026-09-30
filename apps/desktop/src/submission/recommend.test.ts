import { describe, expect, it } from 'vitest';
import { extractAbstractFromTex, recommendVenues } from './recommend';

const paper = (venueName?: string): { venue?: { name?: string } } => ({
  venue: venueName === undefined ? undefined : { name: venueName },
});

describe('recommendVenues（S5）', () => {
  it('库内 venue 频次是强信号：NeurIPS×2 + ACL×1 → NeurIPS 居首，理由含频次', () => {
    const recs = recommendVenues([paper('NeurIPS'), paper('NeurIPS'), paper('ACL'), paper('arXiv')], '');
    expect(recs.length).toBe(2);
    expect(recs[0]!.venue.id).toBe('neurips');
    expect(recs[1]!.venue.id).toBe('acl');
    expect(recs[0]!.score).toBeGreaterThan(recs[1]!.score);
    expect(recs[0]!.reason).toContain('2 篇');
  });

  it('摘要 scope 重叠：视觉摘要 → CVPR 居首，全部得分 > 0 且不超过 3 个', () => {
    const recs = recommendVenues(
      [],
      'We propose a convolutional network for object detection and image segmentation in computer vision benchmarks.',
    );
    expect(recs.length).toBeLessThanOrEqual(3);
    expect(recs[0]!.venue.id).toBe('cvpr');
    expect(recs[0]!.reason).toContain('scope 关键词');
    for (const r of recs) expect(r.score).toBeGreaterThan(0);
  });

  it('频次与重叠混合：NLP 摘要推荐 NLP 场所，EMNLP 的频次体现在理由里', () => {
    const recs = recommendVenues(
      [paper('EMNLP')],
      'A transformer model for machine translation and question answering.',
    );
    const ids = recs.map((r) => r.venue.id);
    expect(ids).toContain('acl');
    expect(ids).toContain('emnlp');
    const emnlpRec = recs.find((r) => r.venue.id === 'emnlp')!;
    expect(emnlpRec.reason).toContain('1 篇');
    // 摘要无视觉内容时不应推荐 CV 系
    expect(ids).not.toContain('cvpr');
  });

  it('无任何信号返回空数组', () => {
    expect(recommendVenues([], '')).toEqual([]);
    expect(recommendVenues([paper('arXiv'), paper(undefined)], 'lorem ipsum dolor sit amet')).toEqual([]);
  });

  it('lang=en 输出英文理由', () => {
    const [rec] = recommendVenues([paper('NeurIPS')], '', 'en');
    expect(rec!.reason).toMatch(/published here/);
  });
});

describe('extractAbstractFromTex', () => {
  it('抽取 abstract 环境并清理 LaTeX 命令与花括号', () => {
    const files = {
      'main.tex': '\\begin{document}\n\\begin{abstract}\nWe study \\emph{attention}.\n\\end{abstract}\n\\end{document}',
      'refs.bib': '',
    };
    expect(extractAbstractFromTex(files)).toBe('We study attention.');
  });

  it('扫描全部 .tex；无 abstract 返回空串', () => {
    expect(extractAbstractFromTex({ 'sections/a.tex': '\\begin{abstract}Deep learning rocks.\\end{abstract}' })).toBe(
      'Deep learning rocks.',
    );
    expect(extractAbstractFromTex({ 'a.tex': 'no abstract here', 'refs.bib': '' })).toBe('');
  });
});
