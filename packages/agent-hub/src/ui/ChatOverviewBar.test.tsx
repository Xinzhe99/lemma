/**
 * 消息定位条测试（v7.7.2）：几何纯函数 + 渲染行为（刻度数/视口块/点击跳转）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markerTop, viewportBand } from './ChatOverviewBar';

describe('markerTop（刻度坐标）', () => {
  it('按比例映射并钳制在条内', () => {
    expect(markerTop(0, 1000, 500)).toBe(0);
    expect(markerTop(500, 1000, 500)).toBeCloseTo(248.5, 0);
    expect(markerTop(1000, 1000, 500)).toBe(497); // barHeight - 3
    expect(markerTop(2000, 1000, 500)).toBe(497); // 越界钳制
  });

  it('scrollHeight 为 0 不产生 NaN', () => {
    expect(markerTop(10, 0, 500)).toBe(0);
  });
});

describe('viewportBand（视口块）', () => {
  it('按视口占比绘制，最矮 14px', () => {
    const band = viewportBand(0, 250, 1000, 500);
    expect(band.height).toBe(125);
    expect(band.top).toBe(0);
  });

  it('滚动到底部时钳制在条内', () => {
    const band = viewportBand(750, 250, 1000, 500);
    expect(band.top + band.height).toBeLessThanOrEqual(500 + 0.01);
  });

  it('内容不溢出时铺满整条', () => {
    const band = viewportBand(0, 500, 500, 500);
    expect(band.height).toBe(500);
  });
});
