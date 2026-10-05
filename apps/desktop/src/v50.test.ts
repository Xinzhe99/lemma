// @vitest-environment jsdom
/**
 * v5.0.0 S2：AI 改动定位链路——firstDiffLine + synctexBridge 的排队/flush。
 */
import { describe, expect, it, vi } from 'vitest';
import { firstDiffLine } from './agentTools';

describe('firstDiffLine', () => {
  it('相同文本返回 null', () => {
    expect(firstDiffLine('a\nb', 'a\nb')).toBeNull();
  });
  it('首行差异返回 1', () => {
    expect(firstDiffLine('x\nb', 'y\nb')).toBe(1);
  });
  it('中间差异返回对应行号', () => {
    expect(firstDiffLine('a\nb\nc\nd', 'a\nb\nC\nd')).toBe(3);
  });
  it('纯追加返回追加起始行', () => {
    expect(firstDiffLine('a\nb', 'a\nb\nc')).toBe(3);
  });
  it('纯删除返回删除起始行', () => {
    expect(firstDiffLine('a\nb\nc', 'a\nb')).toBe(3);
  });
});

describe('synctexBridge 排队定位', () => {
  it('queueSourceGoto → 编译成功 flush 后跳转且只跳一次', async () => {
    // 动态导入避免模块级副作用；lineLocation 依赖真实索引，此处注入假索引对象
    vi.doMock('@lemma/compile', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@lemma/compile')>();
      return {
        ...actual,
        lineLocation: (_i: unknown, file: string, line: number) => ({ file, line, page: 7, y: 100 }),
        sourceLocation: actual.sourceLocation,
      };
    });
    vi.resetModules();
    const bridge = await import('./synctexBridge');
    const { setSynctexIndex } = bridge;
    const gotos: Array<{ page: number; y?: number }> = [];
    const detach = bridge.onPdfGoto((g) => gotos.push(g));

    // 无索引时 queue+flush：静默不跳（保留排队？按实现：flush 时无索引直接丢弃）
    bridge.queueSourceGoto('main.tex', 5);
    bridge.flushQueuedSourceGoto();
    expect(gotos).toHaveLength(0);

    // 有索引：跳到对应位置
    setSynctexIndex({} as never);
    bridge.queueSourceGoto('sections/intro.tex', 12);
    bridge.flushQueuedSourceGoto();
    expect(gotos).toHaveLength(1);
    expect(gotos[0]).toEqual({ page: 7, y: 100 });

    // 只跳一次（flush 后清空）
    bridge.flushQueuedSourceGoto();
    expect(gotos).toHaveLength(1);

    detach();
    vi.doUnmock('@lemma/compile');
    vi.resetModules();
  });
});
