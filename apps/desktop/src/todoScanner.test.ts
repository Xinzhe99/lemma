/**
 * 稿件待办扫描器测试（v1.3.0）：注释 TODO/FIXME（冒号变体）、todonotes、
 * `\%` 转义不误报、非 .tex 忽略、多文件排序聚合、上限截断。
 */

import { describe, expect, it } from 'vitest';
import { countTodos, PER_FILE_LIMIT, scanTodos, TOTAL_LIMIT } from './todoScanner';

describe('scanTodos', () => {
  it('识别 % TODO / % FIXME（含全角冒号与无冒号）与 \\todo{}，行号 1-based', () => {
    const files = {
      'main.tex': [
        '\\section{Intro}',          // 1
        '% TODO: 补充相关工作',       // 2
        'Text here.',                // 3
        '% FIXME：术语不一致',        // 4
        '%todo 无冒号也识别',         // 5
        'We plan \\todo{补实验} here.', // 6
      ].join('\n'),
    };
    const items = scanTodos(files);
    expect(items).toEqual([
      { file: 'main.tex', line: 2, kind: 'todo', text: '补充相关工作' },
      { file: 'main.tex', line: 4, kind: 'fixme', text: '术语不一致' },
      { file: 'main.tex', line: 5, kind: 'todo', text: '无冒号也识别' },
      { file: 'main.tex', line: 6, kind: 'todonotes', text: '补实验' },
    ]);
  });

  it('\\% 转义不产生误报；正文中的 todo 单词不算', () => {
    const files = { 'a.tex': '100\\% TODO\\% done\ntodo is a word\n\\todo[] {带选项}' };
    const items = scanTodos(files);
    // 第 1 行：`% TODO\% done` —— 转义 \% 之后没有新的未转义 %，整行不匹配
    // 第 3 行：\todo[]{带选项} 识别
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'todonotes', text: '带选项' });
  });

  it('忽略非 .tex 文件；多文件按文件名排序、行号升序', () => {
    const files = {
      'b.tex': '% TODO: b1',
      'refs.bib': '% TODO: not counted',
      'a.tex': '% TODO: a2\nx\n% TODO: a1',
    };
    expect(scanTodos(files).map((t) => `${t.file}:${t.text}`)).toEqual([
      'a.tex:a2',
      'a.tex:a1',
      'b.tex:b1',
    ]);
  });

  it('单文件上限与全局上限截断；countTodos 一致', () => {
    const many = Array.from({ length: PER_FILE_LIMIT + 30 }, (_, i) => `% TODO: t${i}`).join('\n');
    const single = scanTodos({ 'a.tex': many });
    expect(single).toHaveLength(PER_FILE_LIMIT);
    const multi: Record<string, string> = {};
    for (let f = 0; f < 5; f++) multi[`f${f}.tex`] = many;
    expect(scanTodos(multi).length).toBeLessThanOrEqual(TOTAL_LIMIT);
    expect(countTodos(multi)).toBe(scanTodos(multi).length);
  });

  it('前一个文件打满单文件上限后，后续文件仍被扫描（v7.8.0 修复：此前整批丢失）', () => {
    const many = Array.from({ length: PER_FILE_LIMIT + 5 }, (_, i) => `% TODO: t${i}`).join('\n');
    const out = scanTodos({ 'a.tex': many, 'z.tex': '% TODO: 最后一份文件的待办也要收进来' });
    expect(out.filter((t) => t.file === 'a.tex')).toHaveLength(PER_FILE_LIMIT);
    expect(out.filter((t) => t.file === 'z.tex')).toEqual([
      { file: 'z.tex', line: 1, kind: 'todo', text: '最后一份文件的待办也要收进来' },
    ]);
  });

  it('空工程 → 空列表', () => {
    expect(scanTodos({})).toEqual([]);
  });
});
