/**
 * pdfOutline 纯函数单测：大纲树先序展开、dest → 页码解析（0-based +1、单项失败跳过）、
 * createDestPageResolver 的命名/显式目标适配。不依赖 DOM 与真实 pdfjs。
 */
import { describe, expect, it, vi } from 'vitest';
import { createDestPageResolver, flattenOutline, resolveOutlinePages, type PdfOutlineNode } from './pdfOutline';

const node = (title: string, dest: unknown = null, items?: PdfOutlineNode[]): PdfOutlineNode => ({
  title,
  dest,
  ...(items ? { items } : {}),
});

describe('flattenOutline（先序展开）', () => {
  it('空大纲 → 空数组', () => {
    expect(flattenOutline([])).toEqual([]);
  });

  it('平铺大纲 → 全部 depth 0，顺序保持', () => {
    const flat = flattenOutline([node('A', 'a'), node('B', 'b'), node('C')]);
    expect(flat).toEqual([
      { title: 'A', dest: 'a', depth: 0 },
      { title: 'B', dest: 'b', depth: 0 },
      { title: 'C', dest: null, depth: 0 },
    ]);
  });

  it('嵌套大纲 → 父先于子，depth 逐层 +1', () => {
    const flat = flattenOutline([node('Ch1', 'd1', [node('1.1', 'd2'), node('1.2', 'd3')]), node('Ch2', 'd4')]);
    expect(flat.map(i => [i.title, i.depth])).toEqual([
      ['Ch1', 0],
      ['1.1', 1],
      ['1.2', 1],
      ['Ch2', 0],
    ]);
  });

  it('三层深度嵌套 → 先序遍历且 depth 0/1/2', () => {
    const flat = flattenOutline([
      node('L0', null, [node('L1', null, [node('L2a', 'x'), node('L2b', 'y')]), node('L1b')]),
    ]);
    expect(flat.map(i => `${i.depth}:${i.title}`)).toEqual(['0:L0', '1:L1', '2:L2a', '2:L2b', '1:L1b']);
  });

  it('items 缺省或为空数组 → 不产生子条目', () => {
    expect(flattenOutline([{ title: 'solo', dest: 'd' }])).toEqual([{ title: 'solo', dest: 'd', depth: 0 }]);
    expect(flattenOutline([node('solo', 'd', [])])).toEqual([{ title: 'solo', dest: 'd', depth: 0 }]);
  });
});

describe('resolveOutlinePages（dest → 1-based 页码）', () => {
  it('getPageIndex 返回 0-based → 页码 +1', async () => {
    const flat = flattenOutline([node('A', 'destA'), node('B', 'destB')]);
    const resolved = await resolveOutlinePages(flat, {
      getPageIndex: vi.fn(async (dest: unknown) => (dest === 'destA' ? 0 : 4)),
    });
    expect(resolved.map(i => [i.title, i.page])).toEqual([
      ['A', 1],
      ['B', 5],
    ]);
  });

  it('单个条目解析失败 → 跳过该项，其余按原顺序保留', async () => {
    const flat = flattenOutline([node('A', 'ok1'), node('Bad', 'boom'), node('C', 'ok2')]);
    const resolved = await resolveOutlinePages(flat, {
      getPageIndex: vi.fn(async (dest: unknown) => {
        if (dest === 'boom') throw new Error('resolve failed');
        return dest === 'ok1' ? 1 : 2;
      }),
    });
    expect(resolved.map(i => i.title)).toEqual(['A', 'C']);
    expect(resolved.map(i => i.page)).toEqual([2, 3]);
  });

  it('全部条目失败 / 空输入 → 空数组', async () => {
    const flat = flattenOutline([node('A', 'x'), node('B', 'y')]);
    const resolved = await resolveOutlinePages(flat, {
      getPageIndex: vi.fn(async () => {
        throw new Error('always fails');
      }),
    });
    expect(resolved).toEqual([]);
    await expect(resolveOutlinePages([], { getPageIndex: vi.fn(async () => 0) })).resolves.toEqual([]);
  });

  it('非有限数或负数结果视为失败跳过', async () => {
    const flat = flattenOutline([node('Neg', 'n'), node('NaN', 'nan'), node('Ok', 'ok')]);
    const resolved = await resolveOutlinePages(flat, {
      getPageIndex: vi.fn(async (dest: unknown) => (dest === 'n' ? -1 : dest === 'nan' ? Number.NaN : 3)),
    });
    expect(resolved).toEqual([{ title: 'Ok', dest: 'ok', depth: 0, page: 4 }]);
  });

  it('保留 title/dest/depth 原样并附加 page', async () => {
    const flat = flattenOutline([node('Parent', 'd', [node('Child', 'd2')])]);
    const resolved = await resolveOutlinePages(flat, { getPageIndex: vi.fn(async () => 9) });
    expect(resolved).toEqual([
      { title: 'Parent', dest: 'd', depth: 0, page: 10 },
      { title: 'Child', dest: 'd2', depth: 1, page: 10 },
    ]);
  });
});

describe('createDestPageResolver（pdfjs dest 适配）', () => {
  it('显式目标数组：首元素为页面引用 → getPageIndex(ref)', async () => {
    const getPageIndex = vi.fn(async (ref: { num: number }) => ref.num);
    const resolve = createDestPageResolver({ getDestination: vi.fn(), getPageIndex });
    await expect(resolve([{ num: 7, gen: 0 }, { name: 'Fit' }])).resolves.toBe(7);
    expect(getPageIndex).toHaveBeenCalledWith({ num: 7, gen: 0 });
  });

  it('命名目标字符串 → 先 getDestination 展开再解析', async () => {
    const getDestination = vi.fn(async (name: string) =>
      name === 'chap1' ? [{ num: 3, gen: 0 }, { name: 'Fit' }] : null,
    );
    const getPageIndex = vi.fn(async (ref: { num: number }) => ref.num);
    const resolve = createDestPageResolver({ getDestination, getPageIndex });
    await expect(resolve('chap1')).resolves.toBe(3);
    expect(getDestination).toHaveBeenCalledWith('chap1');
  });

  it('null / 未知命名目标 / 非法结构 → 抛错（交由 resolveOutlinePages 跳过）', async () => {
    const resolve = createDestPageResolver({
      getDestination: vi.fn(async () => null),
      getPageIndex: vi.fn(async () => 0),
    });
    await expect(resolve(null)).rejects.toThrow();
    await expect(resolve('unknown-name')).rejects.toThrow();
    await expect(resolve([{ notARef: true }])).rejects.toThrow();
  });
});
