/**
 * 各节进度测试（v1.9.0 ①）：sectionProgressForFile——
 * 多级嵌套节的范围切分（同级截断）、TeX 感知字数、状态阈值。
 */

import { describe, expect, it } from 'vitest';
import { sectionProgressForFile, statusForWords } from './sectionProgress';
import type { OutlineNode } from '@scholarforge/editor';

const DOC = [
  '\section{Introduction}',
  'This is the introduction with some content about the paper.',
  'It has multiple sentences with enough words to count.',
  '\section{Method}',
  'The method section describes our approach in detail here.',
  'More explanation about how the system works and why.',
  'Even more text to make this section have more words.',
  'Additional content to push the word count higher.',
  'Yet more content for the method section to be solid.',
  '\subsection{Data}',
  'Short data description.',
  '\section{Results}',
  'Results are here.',
].join('\n');

const NODES: OutlineNode[] = [
  { level: 1, title: 'Introduction', line: 1, command: 'section' },
  { level: 1, title: 'Method', line: 4, command: 'section' },
  { level: 2, title: 'Data', line: 11, command: 'subsection' },
  { level: 1, title: 'Results', line: 13, command: 'section' },
];

describe('sectionProgressForFile', () => {
  const out = sectionProgressForFile(NODES, DOC);

  it('返回与节点等长', () => {
    expect(out).toHaveLength(4);
  });

  it('Introduction：到下一个 \section 前的范围', () => {
    expect(out[0]!.words).toBeGreaterThan(10);
    expect(out[0]!.words).toBeLessThan(30);
  });

  it('Method：到 \subsection 前的范围（不含 Data 小节）', () => {
    // Method 的范围是行 5-10（到 subsection 前），不含 Data 内容
    expect(out[1]!.words).toBeGreaterThan(out[0]!.words); // method 比 intro 长
  });

  it('Data 小节：短内容 → draft 或 empty', () => {
    expect(['empty', 'draft']).toContain(out[2]!.status);
  });

  it('Results：到文件尾', () => {
    expect(out[3]!.status).toBe('empty'); // 只有 3 个词
  });
});

describe('statusForWords', () => {
  it('阈值边界', () => {
    expect(statusForWords(0)).toBe('empty');
    expect(statusForWords(49)).toBe('empty');
    expect(statusForWords(50)).toBe('draft');
    expect(statusForWords(199)).toBe('draft');
    expect(statusForWords(200)).toBe('solid');
    expect(statusForWords(499)).toBe('solid');
    expect(statusForWords(500)).toBe('mature');
  });
});
