import { gzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { lineLocation, parseSynctex, sourceLocation } from './synctex';

/**
 * 手写最小 .synctex 文本 fixture（解析器支持的文档化子集）：
 * 两页（{1} / {2}）、两个输入文件（main.tex / sections/intro.tex）、若干块记录。
 * 块含义：page 页码；锚点 {tag,line} 决定归属；x,y 为左上角，w,h 为宽高（synctex 单位）。
 */
const FIXTURE = [
  'SyncTeX Version:1',
  'Input:1:./main.tex',
  'Input:2:./sections/intro.tex',
  'Content:',
  '{1}',
  '{1,12}',
  'h,x:1000,y:8000,w:4000,h:400',
  '{2,40}',
  'x:1200,y:6000,w:3600,h:400',
  '{1,30}',
  'x:1000,y:2000,w:4000,h:400',
  '{2}',
  '{2,55}',
  'v,x:1000,y:9000,w:4200,h:600',
].join('\n');

const textIndex = parseSynctex(new TextEncoder().encode(FIXTURE));
const gzipIndex = parseSynctex(gzipSync(new TextEncoder().encode(FIXTURE)));

describe('parseSynctex', () => {
  it('文本与 gzip 两种形态解析出等价的索引', () => {
    expect(textIndex.version).toBe(1);
    expect(textIndex.inputs).toEqual([
      { tag: 1, path: 'main.tex' },
      { tag: 2, path: 'sections/intro.tex' },
    ]);
    expect(textIndex.blocks).toHaveLength(4);
    expect(gzipIndex).toEqual(textIndex);
  });
});

describe('sourceLocation（PDF → 源码）', () => {
  it('页 1 命中 main.tex 第 12 行的块', () => {
    expect(sourceLocation(textIndex, 1, 1100, 8100)).toEqual({ file: 'main.tex', line: 12 });
    expect(sourceLocation(gzipIndex, 1, 1100, 8100)).toEqual({ file: 'main.tex', line: 12 });
  });

  it('页 1 命中 intro.tex 第 40 行的块', () => {
    expect(sourceLocation(textIndex, 1, 1300, 6200)).toEqual({ file: 'sections/intro.tex', line: 40 });
  });

  it('页 2 命中 intro.tex 第 55 行的块', () => {
    expect(sourceLocation(textIndex, 2, 1100, 9100)).toEqual({ file: 'sections/intro.tex', line: 55 });
  });

  it('未命中任何块时返回 undefined', () => {
    expect(sourceLocation(textIndex, 1, 99999, 99999)).toBeUndefined();
    expect(sourceLocation(textIndex, 9, 1000, 1000)).toBeUndefined();
  });

  it('命中嵌套块时取面积最小者（更具体）', () => {
    // 在两个重叠块（line 55 大块、构造一个更小的内嵌块）中优先小面积
    const index = parseSynctex(
      new TextEncoder().encode(
        ['SyncTeX Version:1', 'Input:1:./main.tex', '{3}', '{1,7}', 'x:0,y:0,w:1000,h:1000', '{1,9}', 'x:100,y:100,w:50,h:50'].join('\n'),
      ),
    );
    expect(sourceLocation(index, 3, 120, 120)).toEqual({ file: 'main.tex', line: 9 });
  });
});

describe('lineLocation（源码 → PDF）', () => {
  it('精确行命中返回块所在页与左上角坐标', () => {
    expect(lineLocation(textIndex, 'main.tex', 30)).toEqual({ page: 1, x: 1000, y: 2000 });
    expect(lineLocation(textIndex, 'main.tex', 12)).toEqual({ page: 1, x: 1000, y: 8000 });
  });

  it('带 ./ 前缀或按文件名匹配均可命中', () => {
    expect(lineLocation(textIndex, './sections/intro.tex', 40)).toEqual({ page: 1, x: 1200, y: 6000 });
    expect(lineLocation(textIndex, 'intro.tex', 55)).toEqual({ page: 2, x: 1000, y: 9000 });
  });

  it('就近行匹配：请求行取距离最近的块', () => {
    // main.tex 有 12 与 30 两行，请求 25 应命中 30 的块
    expect(lineLocation(textIndex, 'main.tex', 25)).toEqual({ page: 1, x: 1000, y: 2000 });
    expect(lineLocation(textIndex, 'main.tex', 999)).toEqual({ page: 1, x: 1000, y: 2000 });
  });

  it('gzip 索引与文本索引查询结果一致', () => {
    expect(lineLocation(gzipIndex, 'sections/intro.tex', 40)).toEqual(lineLocation(textIndex, 'sections/intro.tex', 40));
  });

  it('未知文件返回 undefined', () => {
    expect(lineLocation(textIndex, 'nope.tex', 1)).toBeUndefined();
  });
});
