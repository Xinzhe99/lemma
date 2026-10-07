/**
 * SyncTeX 桥单测（WS-2）：手造 SynctexIndex fixture，验证
 * - 无索引：hasSynctexIndex 为 false，双向查询均返回 false（静默不可用）；
 * - 源码 → PDF：file+line → page 命中并广播 onPdfGoto；未命中不广播；
 * - PDF → 源码：page+x+y → file+line 命中并经 editorJump.jumpTo 跳源码。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SynctexIndex } from '@lemma/compile';
import {
  hasSynctexIndex,
  jumpPdfToSource,
  jumpSourceToPdf,
  onPdfGoto,
  setSynctexIndex,
} from './synctexBridge';
import { setJumpHandler } from './editorJump';

// v7.9.5：jumpPdfToSource 会把 synctex 路径解析回工作区文件——mock 工作区键
const workspaceMock = vi.hoisted(() => ({
  files: {
    'main.tex': 'main',
    'sections/intro.tex': 'intro',
  } as Record<string, string>,
}));
vi.mock('./state/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ files: workspaceMock.files }) },
}));

/** 手造索引（坐标为 synctex 单位，与解析器 fixture 同构）：两页、两个输入文件 */
const INDEX: SynctexIndex = {
  version: 1,
  inputs: [
    { tag: 1, path: 'main.tex' },
    { tag: 2, path: 'sections/intro.tex' },
  ],
  blocks: [
    { page: 1, tag: 1, line: 12, x: 1000, y: 8000, w: 4000, h: 400 },
    { page: 1, tag: 2, line: 40, x: 1200, y: 6000, w: 3600, h: 400 },
    { page: 2, tag: 2, line: 55, x: 1000, y: 9000, w: 4200, h: 600 },
  ],
};

afterEach(() => {
  setSynctexIndex(null);
  setJumpHandler(null);
});

describe('无索引（浏览器 / 模拟编译）', () => {
  it('hasSynctexIndex 为 false，双向查询均返回 false', () => {
    setSynctexIndex(null);
    expect(hasSynctexIndex()).toBe(false);
    expect(jumpSourceToPdf('main.tex', 12)).toBe(false);
    expect(jumpPdfToSource(1, 1100, 8100)).toBe(false);
  });

  it('置 null 清除旧索引', () => {
    setSynctexIndex(INDEX);
    expect(hasSynctexIndex()).toBe(true);
    setSynctexIndex(null);
    expect(hasSynctexIndex()).toBe(false);
  });
});

describe('源码 → PDF（jumpSourceToPdf）', () => {
  it('file+line 命中：广播 {page, y} 并返回 true', () => {
    setSynctexIndex(INDEX);
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    expect(jumpSourceToPdf('main.tex', 12)).toBe(true);
    off();
    expect(gotos).toEqual([{ page: 1, y: 8000 }]);
  });

  it('按文件名（不带目录）亦可命中', () => {
    setSynctexIndex(INDEX);
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    expect(jumpSourceToPdf('intro.tex', 55)).toBe(true);
    off();
    expect(gotos).toEqual([{ page: 2, y: 9000 }]);
  });

  it('就近行匹配：请求行取距离最近的块', () => {
    setSynctexIndex(INDEX);
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    expect(jumpSourceToPdf('main.tex', 999)).toBe(true);
    off();
    expect(gotos).toEqual([{ page: 1, y: 8000 }]);
  });

  it('未知文件未命中：返回 false 且不广播', () => {
    setSynctexIndex(INDEX);
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    expect(jumpSourceToPdf('nope.tex', 1)).toBe(false);
    off();
    expect(gotos).toEqual([]);
  });

  it('onPdfGoto 返回的退订函数生效', () => {
    setSynctexIndex(INDEX);
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    off();
    expect(jumpSourceToPdf('main.tex', 12)).toBe(true);
    expect(gotos).toEqual([]);
  });
});

describe('PDF → 源码（jumpPdfToSource）', () => {
  it('page+x+y 命中：经 editorJump.jumpTo 跳转源码并返回 true', async () => {
    setSynctexIndex(INDEX);
    const jumps: { file: string; line: number }[] = [];
    setJumpHandler((t) => jumps.push(t));
    expect(jumpPdfToSource(1, 1100, 8100)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // 动态 import editorJump
    expect(jumps).toEqual([{ file: 'main.tex', line: 12 }]);
  });

  it('命中 sections/intro.tex 的块', async () => {
    setSynctexIndex(INDEX);
    const jumps: { file: string; line: number }[] = [];
    setJumpHandler((t) => jumps.push(t));
    expect(jumpPdfToSource(2, 1100, 9100)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jumps).toEqual([{ file: 'sections/intro.tex', line: 55 }]);
  });

  it('未命中（坐标落在块外）返回 false 且不跳转', async () => {
    setSynctexIndex(INDEX);
    const jumps: { file: string; line: number }[] = [];
    setJumpHandler((t) => jumps.push(t));
    expect(jumpPdfToSource(1, 99999, 99999)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jumps).toEqual([]);
  });

  it('v7.9.5 反查路径解析：绝对物化路径映射回工作区键；完全陌生的路径不跳（不开空标签）', async () => {
    // 绝对物化路径（basename 命中工作区键）→ 解析为 main.tex 再跳
    const INDEX_ABS: SynctexIndex = {
      version: 1,
      inputs: [{ tag: 1, path: 'C:/Users/dell/AppData/Roaming/com.lemma.desktop/main.tex' }],
      blocks: [{ page: 1, tag: 1, line: 12, x: 1000, y: 8000, w: 4000, h: 400 }],
    };
    setSynctexIndex(INDEX_ABS);
    const jumps: { file: string; line: number }[] = [];
    setJumpHandler((t) => jumps.push(t));
    expect(jumpPdfToSource(1, 1100, 8100)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jumps).toEqual([{ file: 'main.tex', line: 12 }]);

    // 完全陌生的路径（basename 不在工作区）→ 解析失败，不跳、不开空的同名标签
    const INDEX_FOREIGN: SynctexIndex = {
      version: 1,
      inputs: [{ tag: 1, path: 'C:/somewhere/else/ghost.tex' }],
      blocks: [{ page: 1, tag: 1, line: 3, x: 1000, y: 8000, w: 4000, h: 400 }],
    };
    setSynctexIndex(INDEX_FOREIGN);
    expect(jumpPdfToSource(1, 1100, 8100)).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(jumps).toEqual([{ file: 'main.tex', line: 12 }]);
  });
});
