/**
 * 学术风格分析测试（v1.3.0）：预处理 / 分句（缩写不切）/ 被动语态启发式 /
 * 长句与定位 / 模糊限定词 / 段落 / FK 年级口径 / 空与纯命令文本边界。
 */

import { describe, expect, it } from 'vitest';
import {
  analyzeStyle,
  findPassiveHits,
  findSentenceLine,
  prepareText,
  splitSentences,
  LONG_SENTENCE_WORDS,
} from './styleReport';

describe('prepareText', () => {
  it('去掉注释（保留 \\% 转义）、无义命令与命令 token，数学替换占位', () => {
    const tex = [
      'The method is fast. % TODO 检查',
      'It beats \\cite{a2020,b2021} and \\ref{fig:1}.',
      '100\\% accuracy with $x^2$ and \\textbf{bold}.',
    ].join('\n');
    const out = prepareText(tex);
    expect(out).not.toContain('TODO');
    expect(out).not.toContain('cite');
    expect(out).not.toContain('ref{');
    expect(out).toContain('100% accuracy');
    expect(out).toContain('MATH');
    expect(out).toContain('bold');
  });
});

describe('splitSentences', () => {
  it('句号切分；缩写（e.g. / et al. / Fig. / vs.）自身句点不切分', () => {
    const text = 'We test on CIFAR. E.g. images are small. Smith et al. report this. See Fig. 2 for vs. baseline comparison. Done!';
    const sents = splitSentences(text).map((s) => s.text);
    expect(sents).toHaveLength(5);
    expect(sents[0]).toBe('We test on CIFAR.');
    expect(sents[1]).toBe('E.g. images are small.'); // E.g. 的句点没有把句子切碎
    expect(sents[2]).toBe('Smith et al. report this.'); // et al. 不切
    expect(sents[3]).toBe('See Fig. 2 for vs. baseline comparison.'); // Fig. / vs. 不切
    expect(sents[4]).toBe('Done!');
  });

  it('多标点（?!）与行尾句点均正确收尾', () => {
    const sents = splitSentences('Really? Yes! It works.').map((s) => s.text);
    expect(sents).toEqual(['Really?', 'Yes!', 'It works.']);
  });
});

describe('findPassiveHits', () => {
  it('be 动词 + 过去分词（规则 -ed 与不规则）命中；主动语态不命中', () => {
    const sents = [
      'The model is trained on ImageNet.',
      'Results were reported by two baselines.',
      'The data has been collected.',
      'We train the model actively.',
      'This is a broken promise kept.',
    ];
    const hits = findPassiveHits(sents);
    expect(hits.length).toBeGreaterThanOrEqual(3);
    expect(hits.some((h) => h.text.includes('is trained'))).toBe(true);
    expect(hits.some((h) => h.text.includes('were reported'))).toBe(true);
    expect(hits.some((h) => h.text.includes('been collected'))).toBe(true);
  });

  it('每句至多一条命中', () => {
    const hits = findPassiveHits(['It is done and was made again.']);
    expect(hits).toHaveLength(1);
  });
});

describe('findSentenceLine', () => {
  it('句首探针回查源码行；不可命中返回 undefined', () => {
    const tex = 'line one here.\nsecond line starts the sentence we seek here.\nthird.';
    expect(findSentenceLine(tex, 'second line starts the sentence we seek here.')).toBe(2);
    expect(findSentenceLine(tex, 'zzz not present')).toBeUndefined();
    expect(findSentenceLine(tex, 'short')).toBeUndefined(); // 探针过短
  });
});

describe('analyzeStyle（全文集成）', () => {
  const longWords = Array.from({ length: LONG_SENTENCE_WORDS + 5 }, (_, i) => `w${i}`).join(' ');
  const tex = [
    '\\section{Intro}',
    'We present a method. The method is evaluated on benchmarks.',
    `% TODO: fix\n${longWords}.`,
    'It is worth noting that some results are very good.',
    '',
    'Second paragraph here. With two sentences.',
  ].join('\n');

  const r = analyzeStyle(tex);

  it('句子/词数/句长统计合理，长句入清单并可定位', () => {
    expect(r.sentences).toBeGreaterThanOrEqual(4);
    expect(r.words).toBeGreaterThan(40);
    expect(r.avgSentenceWords).toBeGreaterThan(0);
    const long = r.longSentences[0];
    expect(long).toBeDefined();
    expect(long!.words).toBeGreaterThan(LONG_SENTENCE_WORDS);
    expect(long!.line).toBe(4); // % TODO 行之后的第 4 行
  });

  it('被动语态占比、第一人称、模糊限定词（含短语）', () => {
    expect(r.passiveHits.some((h) => h.text.includes('is evaluated'))).toBe(true);
    expect(r.passivePct).toBeGreaterThan(0);
    expect(r.firstPersonCount).toBeGreaterThanOrEqual(1); // "We"
    expect(r.weaselCounts.some((w) => w.word === 'very' && w.count >= 1)).toBe(true);
    expect(r.weaselCounts.some((w) => w.word === 'it is worth noting that')).toBe(true);
  });

  it('段落统计与 FK 年级非负有限', () => {
    expect(r.paragraphs).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(r.fkGrade)).toBe(true);
    expect(r.fkGrade).toBeGreaterThanOrEqual(0);
  });

  it('被动比例按全量命中计算（回归：不再因 12 条展示上限而低估）', () => {
    // 20 句全被动：清单截断到 12 条，但占比应为 100%
    const all = Array.from({ length: 20 }, (_, i) => `The result ${i} is computed by our method.`).join(' ');
    const rep = analyzeStyle(all);
    expect(rep.sentences).toBe(20);
    expect(rep.passiveHits).toHaveLength(12); // 展示清单仍截断
    expect(rep.passivePct).toBe(100);
  });

  it('空文本 / 纯命令文本 → 零报告（sentences=0）不抛错', () => {
    const empty = analyzeStyle('');
    expect(empty.sentences).toBe(0);
    expect(empty.fkGrade).toBe(0);
    expect(analyzeStyle('\\cite{a}\\ref{b}').sentences).toBe(0);
  });
});
