import { describe, expect, it } from 'vitest';
import { analyzeStyle, splitTextSentences } from './style';

describe('splitTextSentences', () => {
  it('忽略缩写句点与小数点', () => {
    const s = splitTextSentences(
      'The encoder, e.g. its self-attention part, was slow (see Fig. 3). It handles 3.14 million tokens quickly! Does it converge? Yes.',
    );
    expect(s).toEqual([
      'The encoder, e.g. its self-attention part, was slow (see Fig. 3).',
      'It handles 3.14 million tokens quickly!',
      'Does it converge?',
      'Yes.',
    ]);
  });
});

describe('analyzeStyle', () => {
  it('被动句比例显著高于主动句文本', () => {
    const passive = 'The model was trained on ImageNet. The samples were collected by hand. The results are shown in Table 1. The baseline was evaluated three times.';
    const active = 'We trained the model on ImageNet. We collected the samples by hand. We show the results in Table 1. We evaluated the baseline three times.';
    const p = analyzeStyle(passive);
    const a = analyzeStyle(active);
    expect(p.passiveRatio).toBeGreaterThanOrEqual(0.75);
    expect(a.passiveRatio).toBeLessThanOrEqual(0.25);
    expect(p.passiveRatio).toBeGreaterThan(a.passiveRatio);
  });

  it('长句文本：均值与 P90 偏大并给出中文建议', () => {
    const longWords = Array.from({ length: 32 }, (_, i) => `w${i}`).join(' ');
    const text = `${longWords}. ${longWords}. ${longWords}.`;
    const s = analyzeStyle(text);
    expect(s.sentenceLenMean).toBeCloseTo(32, 5);
    expect(s.sentenceLenP90).toBeGreaterThanOrEqual(32);
    expect(s.notes.some((n) => n.includes('平均句长偏长') && n.includes('建议拆分'))).toBe(true);
  });

  it('短句文本：均值小且无拆分建议', () => {
    const s = analyzeStyle('Cats sleep. Dogs run. Birds fly away every morning!');
    expect(s.sentenceLenMean).toBeLessThan(6);
    expect(s.notes.some((n) => n.includes('平均句长偏长'))).toBe(false);
  });

  it('hedging 密度：hedged 文本高于平实文本', () => {
    const hedged = 'The result may be roughly correct and might suggest a potentially promising trend, though we cannot be certain.';
    const plain = 'The result is correct. The trend is real. We verified every number twice.';
    expect(analyzeStyle(hedged).hedgingDensity).toBeGreaterThan(analyzeStyle(plain).hedgingDensity);
    expect(analyzeStyle(hedged).hedgingDensity).toBeGreaterThan(100);
    expect(analyzeStyle(plain).hedgingDensity).toBeLessThan(30);
  });

  it('空文本不产生 NaN', () => {
    const s = analyzeStyle('   ');
    expect(Number.isFinite(s.sentenceLenMean)).toBe(true);
    expect(s.sentenceLenMean).toBe(0);
    expect(s.notes.some((n) => n.includes('未检测到有效句子'))).toBe(true);
  });
});
