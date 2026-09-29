import { describe, expect, it } from 'vitest';
import { chunkBySentence, chunkPaper, chunkPlainText, splitSentences } from './chunker';

function makeSentences(count: number, wordsPerSentence = 14): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const words: string[] = [];
    for (let j = 0; j < wordsPerSentence; j++) words.push(`token${i}_${j}`);
    out.push(`Sentence ${i} mentions ${words.join(' ')} attention. `);
  }
  return out.join('');
}

describe('splitSentences', () => {
  it('保留句末标点并切分', () => {
    const s = splitSentences('One. Two? Three! End');
    expect(s).toEqual(['One.', 'Two?', 'Three!', 'End']);
  });

  it('小数点与中英混排', () => {
    const s = splitSentences('The value is 3.14 exactly. 中文句子。Another one!');
    expect(s).toEqual(['The value is 3.14 exactly.', '中文句子。', 'Another one!']);
  });
});

describe('chunkPaper', () => {
  it('短 section 一节一块，携带 heading/page/paperId/sectionId', () => {
    const chunks = chunkPaper({
      id: 'paper-1',
      sections: [
        { id: 'sec-intro', heading: 'Introduction', level: 1, text: 'We study attention.', pageStart: 1 },
        { id: 'sec-method', heading: 'Method', level: 1, text: 'We propose a new encoder.', pageStart: 3 },
      ],
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({
      paperId: 'paper-1',
      sectionId: 'sec-intro',
      heading: 'Introduction',
      page: 1,
      text: 'We study attention.',
    });
    expect(chunks[1]).toMatchObject({ heading: 'Method', page: 3 });
  });

  it('超长 section 按句子边界再切，块间 150 字符重叠且不超上限', () => {
    const longText = makeSentences(30); // 约 3000+ 字符
    expect(longText.length).toBeGreaterThan(1600);
    const chunks = chunkPaper({
      id: 'paper-2',
      sections: [{ id: 'sec-a', heading: 'Related Work', level: 2, text: longText, pageStart: 7 }],
    });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1600);
      expect(c.heading).toBe('Related Work');
      expect(c.page).toBe(7);
    }
    // 相邻块重叠：后一块以前一块的尾部（≤150 字符）开头
    for (let i = 1; i < chunks.length; i++) {
      const tail = chunks[i - 1].text.slice(-150);
      expect(chunks[i].text.startsWith(tail)).toBe(true);
    }
    // 重叠内容不丢句子：所有句号都应出现在块序列里
    const periods = longText.split('.').length - 1;
    const kept = chunks.map((c) => c.text.split('.').length - 1).reduce((a, b) => a + b, 0);
    expect(kept).toBeGreaterThanOrEqual(periods);
  });

  it('块 id 确定：同输入同 id，不同 paper 不同 id', () => {
    const paper = {
      id: 'paper-3',
      sections: [{ id: 's1', heading: 'H', level: 1, text: 'Same text here.', pageStart: 1 }],
    };
    const a = chunkPaper(paper);
    const b = chunkPaper(paper);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    const other = chunkPaper({ ...paper, id: 'paper-4' });
    expect(other[0].id).not.toBe(a[0].id);
  });

  it('无 sections 时用 fallbackText 滑窗切', () => {
    const text = 'ab'.repeat(1200); // 2400 字符，无空白 → 窗口边界可精确核对
    const chunks = chunkPaper({ id: 'paper-5', sections: [] }, text);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(1200);
      expect(c.paperId).toBe('paper-5');
      expect(c.heading).toBeUndefined();
    }
    expect(chunks[0].text.endsWith(chunks[1].text.slice(0, 150))).toBe(true);
  });

  it('无 sections 且无 fallbackText 返回空', () => {
    expect(chunkPaper({ id: 'p', sections: [] })).toEqual([]);
    expect(chunkPaper({ id: 'p' }, '   ')).toEqual([]);
  });
});

describe('chunkPlainText', () => {
  it('默认 size=1200 overlap=150', () => {
    const text = 'ab'.repeat(1000); // 2000 字符，无空白
    const chunks = chunkPlainText(text);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBeLessThanOrEqual(1200);
    // 步长 1050：第二块与第一块重叠 150 字符
    expect(chunks[0].endsWith(chunks[1].slice(0, 150))).toBe(true);
  });

  it('短文本单块，空文本空数组，可自定义参数', () => {
    expect(chunkPlainText('short text')).toEqual(['short text']);
    expect(chunkPlainText('')).toEqual([]);
    const chunks = chunkPlainText('abcdefghij', { size: 4, overlap: 2 });
    expect(chunks).toEqual(['abcd', 'cdef', 'efgh', 'ghij']);
  });
});

describe('chunkBySentence', () => {
  it('单句超长也保留为一块', () => {
    const one = 'x'.repeat(2000);
    expect(chunkBySentence(one)).toEqual([one]);
  });
});
