/**
 * hunks 纯函数测试：splitHunks 的切分/行号/header，applyHunks 的
 * 部分采纳重组。核心不变量：全接受 === after、全拒绝 === before（字节级，
 * 含行尾换行差异）；行携带自身换行符保证拼回无损。
 */
import { describe, expect, it } from 'vitest';
import { applyHunks, splitHunks, toDiffLines, type Hunk } from './hunks';

const all = (hs: Hunk[]) => new Set(hs.map((h) => h.id));

describe('splitHunks', () => {
  it('无差异返回空数组（含完全相同的尾换行）', () => {
    expect(splitHunks('a\nb\nc\n', 'a\nb\nc\n')).toEqual([]);
    expect(splitHunks('', '')).toEqual([]);
  });

  it('单 hunk：中部替换，行数组与 header 正确', () => {
    const hunks = splitHunks('a\nb\nc\n', 'a\nX\nc\n');
    expect(hunks).toHaveLength(1);
    const h = hunks[0];
    expect(h.id).toBe('h1');
    expect(h.header).toBe('@@ -2,1 +2,1 @@');
    expect(h.beforeLines).toEqual(['b\n']);
    expect(h.afterLines).toEqual(['X\n']);
    expect([h.beforeStart, h.beforeEnd]).toEqual([2, 2]);
    expect([h.afterStart, h.afterEnd]).toEqual([2, 2]);
  });

  it('多 hunk：未变行分隔两处修改，id 顺序编号', () => {
    const hunks = splitHunks('a\nb\nc\nd\ne\n', 'A\nb\nc\nD\ne\n');
    expect(hunks.map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(hunks[0].beforeStart).toBe(1);
    expect(hunks[1].beforeStart).toBe(4);
    expect(hunks[0].afterLines).toEqual(['A\n']);
    expect(hunks[1].afterLines).toEqual(['D\n']);
  });

  it('文件开头修改：beforeStart/afterStart 从 1 起', () => {
    const [h] = splitHunks('a\nb\n', 'Z\nb\n');
    expect(h.beforeStart).toBe(1);
    expect(h.afterStart).toBe(1);
    expect(h.beforeEnd).toBe(1);
  });

  it('末尾纯增：beforeLines 空、beforeStart = 旧行数（插在其后）', () => {
    const [h] = splitHunks('x\n', 'x\ny\n');
    expect(h.beforeLines).toEqual([]);
    expect(h.afterLines).toEqual(['y\n']);
    expect(h.beforeStart).toBe(1);
    expect(h.beforeEnd).toBe(1);
    expect(h.header).toBe('@@ -1,0 +2,1 @@');
  });

  it('顶部纯增：beforeStart = 0，header @@ -0,0', () => {
    const [h] = splitHunks('x\n', 'y\nx\n');
    expect(h.beforeLines).toEqual([]);
    expect(h.beforeStart).toBe(0);
    expect(h.header).toBe('@@ -0,0 +1,1 @@');
    expect(h.afterStart).toBe(1);
  });

  it('纯删：afterLines 空，行号区间落在旧文件', () => {
    const hunks = splitHunks('a\nb\nc\n', 'a\nc\n');
    expect(hunks).toHaveLength(1);
    const h = hunks[0];
    expect(h.beforeLines).toEqual(['b\n']);
    expect(h.afterLines).toEqual([]);
    expect(h.beforeStart).toBe(2);
    expect(h.afterStart).toBe(1);
    expect(h.afterEnd).toBe(1);
  });

  it('行号区间长度与行数组一致，且指向原文真实位置', () => {
    const before = 'l1\nl2\nl3\nl4\nl5\nl6\n';
    const after = 'l1\nl2\nL3\nl4\nl5\nL6\n';
    for (const h of splitHunks(before, after)) {
      expect(h.beforeEnd - h.beforeStart + 1).toBe(h.beforeLines.length);
      expect(h.afterEnd - h.afterStart + 1).toBe(h.afterLines.length);
      // 区间首行恰为 before 的对应行
      expect(h.beforeLines[0]).toBe(toDiffLines(before)[h.beforeStart - 1]);
    }
    const [h1, h2] = splitHunks(before, after);
    expect(h1.beforeStart).toBe(3);
    expect(h2.beforeStart).toBe(6);
    expect(h2.afterStart).toBe(6);
  });

  it('相邻增删（无未变行分隔）合并为一个 hunk', () => {
    const hunks = splitHunks('a\nb\nc\n', 'a\nX\nY\nZ\nc\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].beforeLines).toEqual(['b\n']);
    expect(hunks[0].afterLines).toEqual(['X\n', 'Y\n', 'Z\n']);
  });

  it('仅行尾换行差异也产生 hunk（字节级语义）', () => {
    const hunks = splitHunks('a', 'a\n');
    expect(hunks).toHaveLength(1);
    expect(hunks[0].beforeLines).toEqual(['a']);
    expect(hunks[0].afterLines).toEqual(['a\n']);
  });
});

describe('applyHunks', () => {
  const before = 'a\nb\nc\nd\ne\n';
  const after = 'A\nb\nc\nD\ne\n';

  it('全接受 === after（多 hunk）', () => {
    const hunks = splitHunks(before, after);
    expect(applyHunks(before, hunks, all(hunks))).toBe(after);
  });

  it('全拒绝 === before', () => {
    const hunks = splitHunks(before, after);
    expect(applyHunks(before, hunks, new Set())).toBe(before);
  });

  it('混搭：接受一个拒绝一个，空隙照抄', () => {
    const [h1, h2] = splitHunks(before, after);
    expect(applyHunks(before, [h1, h2], new Set([h1.id]))).toBe('A\nb\nc\nd\ne\n');
    expect(applyHunks(before, [h1, h2], new Set([h2.id]))).toBe('a\nb\nc\nD\ne\n');
  });

  it('空接受集 === before', () => {
    const hunks = splitHunks('x\ny\n', 'x\nY2\n');
    expect(applyHunks('x\ny\n', hunks, new Set())).toBe('x\ny\n');
  });

  it('三 hunk 接受中间一个：两侧空隙与拒绝 hunk 原样保留', () => {
    const b = '1\n2\n3\n4\n5\n6\n7\n8\n9\n';
    const a = '1\n2\n三\n4\n5\n6\n七\n8\n九\n';
    const hunks = splitHunks(b, a);
    expect(hunks).toHaveLength(3);
    const [h1, h2, h3] = hunks;
    expect(applyHunks(b, hunks, new Set([h2.id]))).toBe('1\n2\n3\n4\n5\n6\n七\n8\n9\n');
    expect(applyHunks(b, hunks, new Set([h1.id, h3.id]))).toBe('1\n2\n三\n4\n5\n6\n7\n8\n九\n');
  });

  it('含纯插入 hunk：单独接受即精准插入（顶部/末尾）', () => {
    const top = splitHunks('x\n', 'head\nx\n');
    expect(applyHunks('x\n', top, all(top))).toBe('head\nx\n');
    const tail = splitHunks('x\n', 'x\ntail\n');
    expect(applyHunks('x\n', tail, all(tail))).toBe('x\ntail\n');
  });

  it('行尾换行差异：全接受后字节等于 after', () => {
    const hunks = splitHunks('a\nb', 'a\nb\n');
    expect(applyHunks('a\nb', hunks, all(hunks))).toBe('a\nb\n');
    expect(applyHunks('a\nb', hunks, new Set())).toBe('a\nb');
  });

  it('重叠防御：外部构造的重叠 hunk 按顺序应用、起点钳制不越界', () => {
    // 两个 hunk 都想替换旧行 1：按顺序应用——h1 先替换，h2 起点被钳制到
    // 已消费位置，其 beforeLines 被丢弃（旧区间已被消费），仅剩 afterLines 追加。
    const overlapping: Hunk[] = [
      { id: 'h1', header: '', beforeStart: 1, beforeEnd: 1, afterStart: 1, afterEnd: 1, beforeLines: ['a\n'], afterLines: ['X\n'] },
      { id: 'h2', header: '', beforeStart: 1, beforeEnd: 1, afterStart: 2, afterEnd: 2, beforeLines: ['a\n'], afterLines: ['Y\n'] },
    ];
    const merged = applyHunks('a\nb\n', overlapping, new Set(['h1', 'h2']));
    expect(merged).toBe('X\nY\nb\n');
    // 拒绝全部时同样不崩溃：重叠的旧行只保留一次
    expect(applyHunks('a\nb\n', overlapping, new Set())).toBe('a\nb\n');
  });
});
