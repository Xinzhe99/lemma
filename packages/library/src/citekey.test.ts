import { describe, expect, it } from 'vitest';
import type { Paper } from '@lemma/shared';
import { disambiguateCitekey, generateCitekey } from './citekey';

const hinton: Paper = {
  id: 'p1',
  citekey: '',
  title: 'ImageNet Classification with Deep Convolutional Neural Networks',
  authors: [
    { family: 'Hinton', given: 'Geoffrey' },
    { family: 'Krizhevsky', given: 'Alex' },
    { family: 'Sutskever', given: 'Ilya' },
  ],
  year: 2012,
  tags: [],
  collections: [],
  readStatus: 'done',
  addedAt: 1,
};

const single: Paper = {
  ...hinton,
  title: 'Adam: A Method for Stochastic Optimization',
  authors: [{ family: 'Kingma', given: 'Diederik' }],
  year: 2015,
};

describe('generateCitekey', () => {
  it('默认模式 auth:year:shorttitle', () => {
    expect(generateCitekey(hinton)).toBe('hinton:2012:ImageNetClassificationDeep');
  });

  it('shorttitle 跳过虚词，取前 3 个实词并首字母大写', () => {
    expect(generateCitekey(single, 'shorttitle')).toBe('AdamMethodStochastic');
  });

  it('auth3 取前 3 位作者', () => {
    expect(generateCitekey(hinton, 'auth3:year')).toBe('hintonkrizhevskysutskever:2012');
  });

  it('authEtAl：≤2 位取全部，>2 位取首作者 + EtAl', () => {
    expect(generateCitekey(hinton, 'authEtAl:year')).toBe('hintonEtAl:2012');
    expect(generateCitekey(single, 'authEtAl:year')).toBe('kingma:2015');
    const duo: Paper = { ...hinton, authors: hinton.authors.slice(0, 2) };
    expect(generateCitekey(duo, 'authEtAl')).toBe('hintonkrizhevsky');
  });

  it('alpha：首作者首字母 + 年份后两位', () => {
    expect(generateCitekey(hinton, 'alpha')).toBe('H12');
    expect(generateCitekey(single, 'alpha')).toBe('K15');
  });

  it('auth 去除非字母字符；未知片段忽略；缺失字段降级', () => {
    const styled: Paper = { ...single, authors: [{ family: 'van der Aalst' }] };
    expect(generateCitekey(styled, 'auth')).toBe('vanderaalst');
    const accented: Paper = { ...single, authors: [{ family: 'García-López' }] };
    expect(generateCitekey(accented, 'auth')).toBe('garcíalópez');
    expect(generateCitekey(hinton, 'auth:year:bogus:alpha')).toBe('hinton:2012:H12');
    const noYear: Paper = { ...single, year: undefined };
    expect(generateCitekey(noYear, 'year')).toBe('nokey');
    const noAuthor: Paper = { ...single, authors: [] };
    expect(generateCitekey(noAuthor, 'auth:alpha')).toBe('anon:X15');
  });

  it('shorttitle 去掉 LaTeX 非法字符（\\cite{…} 会编译失败、文件名非法）', () => {
    // & _ \ " 等字符在 \cite{…} 参数里非法（& 是对齐符、_ 触发数学模式、% 注释整行）
    const amp: Paper = { ...single, title: 'Q&A: A Study of Retrieval' };
    expect(generateCitekey(amp)).toBe('kingma:2015:QAStudyRetrieval');
    const underscore: Paper = { ...single, title: 'Snake_case Tokenization' };
    expect(generateCitekey(underscore)).toBe('kingma:2015:SnakecaseTokenization');
    const tex: Paper = { ...single, title: String.raw`Caf\'e na\"ive Models` };
    expect(generateCitekey(tex)).toBe('kingma:2015:CafeNaiveModels');
    // 连字符仍保留（LaTeX 与文件名都合法）
    const hyphen: Paper = { ...single, title: 'State-of-the-Art Results' };
    expect(generateCitekey(hyphen)).toBe('kingma:2015:State-of-the-ArtResults');
  });
});

describe('disambiguateCitekey', () => {
  it('不冲突时原样返回', () => {
    expect(disambiguateCitekey('hinton:2012:x', new Set(['other']))).toBe('hinton:2012:x');
  });

  it('冲突时追加 -a、-b…', () => {
    const existing = new Set(['key', 'key-a']);
    expect(disambiguateCitekey('key', existing)).toBe('key-b');
    expect(disambiguateCitekey('key', new Set(['key']))).toBe('key-a');
  });

  it('超过 26 个冲突后进入双字母', () => {
    const existing = new Set(['key', ...Array.from({ length: 26 }, (_, i) => `key-${String.fromCharCode(97 + i)}`)]);
    expect(disambiguateCitekey('key', existing)).toBe('key-aa');
  });
});
