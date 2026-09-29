import { describe, expect, it } from 'vitest';
import { checkConsistency, extractGlossary } from './glossary';

const mlText = [
  'Deep learning has reshaped computer vision and natural language processing in the past decade.',
  'A Convolutional Neural Network (CNN) extracts hierarchical spatial features from images.',
  'We compare against Recurrent Neural Network (RNN) baselines and Graph Neural Networks (GNNs).',
  'Training minimizes the Mean Squared Error (MSE) with the Adam optimizer.',
  'See Figure 4 (Top) and Table 2 (Right) for details.',
].join(' ');

describe('extractGlossary', () => {
  it('抽取 ML 风格文本中的定义', () => {
    const terms = extractGlossary(mlText);
    const byAbbr = new Map(terms.map((t) => [t.abbr, t]));
    expect(byAbbr.get('CNN')).toMatchObject({ term: 'Convolutional Neural Network' });
    expect(byAbbr.get('RNN')).toMatchObject({ term: 'Recurrent Neural Network' });
    expect(byAbbr.get('GNNs')).toMatchObject({ term: 'Graph Neural Networks' });
    expect(byAbbr.get('MSE')).toMatchObject({ term: 'Mean Squared Error' });
    expect(terms.length).toBeGreaterThanOrEqual(4);
    for (const t of terms) expect(t.id).toMatch(/^glo-/);
  });

  it('括号内非缩写词的常见排版不误报', () => {
    const terms = extractGlossary(mlText);
    expect(terms.find((t) => /figure|table|top|right|see/i.test(t.term))).toBeUndefined();
  });

  it('首个定义为准、按缩写去重', () => {
    const text = [
      'A Convolutional Neural Network (CNN) is a model.',
      'Another Convolutional Neural Network (CNN) appears later.',
    ].join(' ');
    const terms = extractGlossary(text);
    expect(terms.filter((t) => t.abbr === 'CNN')).toHaveLength(1);
    // 相同文本重复抽取结果一致（确定性 id）
    expect(extractGlossary(text)).toEqual(terms);
  });

  it('definition 取定义后的说明片段', () => {
    const terms = extractGlossary('A Convolutional Neural Network (CNN) is a kind of deep model for images.');
    const cnn = terms.find((t) => t.abbr === 'CNN');
    expect(cnn?.definition).toContain('a kind of deep model for images');
  });
});

describe('checkConsistency', () => {
  it('三类问题：定义前使用 / 重复定义不一致 / 全称冗余提示', () => {
    const messy = [
      'We first train a CNN backbone on ImageNet for pretraining.',
      'A Convolutional Neural Network (CNN) stacks convolutional layers with nonlinear activations.',
      'Later, the Convolutional Neural Network is fine-tuned end to end.',
      'Some prior work models sequences with Recurrent Neural Network (RNN) cells.',
      'A Convolutional Neural Net (CNN) variant uses depthwise kernels.',
    ].join('\n');
    const issues = checkConsistency(messy, extractGlossary(messy));

    const beforeDef = issues.find((i) => i.message.includes('之前即被使用'));
    expect(beforeDef?.severity).toBe('error');
    expect(beforeDef?.abbr).toBe('CNN');

    const dup = issues.find((i) => i.message.includes('重复定义为不同全称'));
    expect(dup?.severity).toBe('error');
    expect(dup?.message).toContain('Convolutional Neural Network');
    expect(dup?.message).toContain('Convolutional Neural Net');

    const full = issues.find((i) => i.severity === 'hint');
    expect(full?.message).toContain('再次以全称出现');
  });

  it('文中定义与术语表锁定全称不一致时报 error', () => {
    const issues = checkConsistency(
      'A Convolutional Neural Net (CNN) is used here.',
      [{ id: 'g1', term: 'Convolutional Neural Network', abbr: 'CNN' }],
    );
    const mismatch = issues.find((i) => i.message.includes('与术语表锁定'));
    expect(mismatch?.severity).toBe('error');
  });

  it('缩写从未定义时报 error；正常文本无问题', () => {
    const undefinedAbbr = checkConsistency('The CNN is trained for ten epochs.', [
      { id: 'g1', term: 'Convolutional Neural Network', abbr: 'CNN' },
    ]);
    expect(undefinedAbbr.some((i) => i.severity === 'error' && i.message.includes('从未以'))).toBe(true);

    const clean = checkConsistency(
      'A Recurrent Neural Network (RNN) processes sequences step by step. The RNN converges fast.',
      [{ id: 'g1', term: 'Recurrent Neural Network', abbr: 'RNN' }],
    );
    expect(clean).toEqual([]);
  });
});
