/**
 * 稿件各节进度（v1.9.0 ①）：从大纲 + 文件内容计算每节的可见字数与状态。
 *
 * 口径：
 *  - 节的文本范围 = 本节起始行到下一个同级或更高级标题的前一行（跨文件不计——
 *    大纲项按文件分组，每节范围限于所在文件内）；
 *  - 字数 = countTexWords（TeX 感知：剔除命令骨架/注释/数学）；
 *  - 状态：<50 空、50–200 草稿、200–500 充实、>500 成熟。
 * 纯函数无 store 依赖，OutlinePanel / Dashboard / 命令面板共用。
 */

import { countTexWords } from './components/StatusBar';
import type { OutlineNode } from '@scholarforge/editor';

export type SectionStatus = 'empty' | 'draft' | 'solid' | 'mature';

export interface SectionProgress {
  /** 由此可见字数（countTexWords 口径） */
  words: number;
  status: SectionStatus;
}

export const SECTION_THRESHOLDS: Readonly<Record<SectionStatus, [number, number]>> = {
  empty: [0, 50],
  draft: [50, 200],
  solid: [200, 500],
  mature: [500, Number.POSITIVE_INFINITY],
};

/** 字数 → 状态 */
export function statusForWords(words: number): SectionStatus {
  if (words < 50) return 'empty';
  if (words < 200) return 'draft';
  if (words < 500) return 'solid';
  return 'mature';
}

/**
 * 计算一个文件内各大纲节的进度。
 * items 为该文件的 (node, index) 序列；content 为该文件全文。
 * 返回与 items 等长的数组。
 */
export function sectionProgressForFile(
  nodes: OutlineNode[],
  content: string,
): SectionProgress[] {
  const lines = content.split('\n');
  return nodes.map((node, i) => {
    const startLine = node.line; // 1-based
    // 找下一个同级或更高级标题（在本文件内）
    let endLine = lines.length;
    for (let j = i + 1; j < nodes.length; j++) {
      const next = nodes[j]!;
      if (next.level <= node.level) {
        endLine = next.line - 1;
        break;
      }
    }
    const text = lines.slice(startLine, endLine).join('\n'); // 标题行的下一行到节尾
    const words = countTexWords(text);
    return { words, status: statusForWords(words) };
  });
}
