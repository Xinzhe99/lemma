/**
 * 消息定位条测试（v7.7.2）：几何纯函数 + 渲染行为（刻度数/视口块/点击跳转）。
 */
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { markerTop, rowContentTop, viewportBand } from './ChatOverviewBar';

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

describe('rowContentTop（刻度与视口块同源的坐标换算，v7.8.0）', () => {
  it('未滚动时等于行相对滚动容器顶部的距离', () => {
    // 容器顶部在视口 y=100，行在 y=112 → 内容偏移 12（与容器上方有什么无关）
    expect(rowContentTop(112, 100, 0)).toBe(12);
  });

  it('滚动后按 scrollTop 补偿（行随滚动上移，内容偏移不变）', () => {
    expect(rowContentTop(62, 100, 50)).toBe(12);
  });

  it('行被滚出容器顶部时钳制为 0，不产生负刻度', () => {
    expect(rowContentTop(40, 100, 0)).toBe(0);
  });

  it('与视口块共用同一坐标系：容器顶部对齐的首行落在 scrollTop 对应的刻度上', () => {
    const scrollHeight = 1000;
    const clientHeight = 250;
    const barHeight = 500;
    // 滚动到 250 处、容器顶部在视口 y=100：该处行 rect.top = 100，内容偏移 = 250
    const contentTop = rowContentTop(100, 100, 250);
    expect(contentTop).toBe(250);
    // 刻度位置与同一 scrollTop 的视口块顶边一致（同一比例基准；刻度另有 3px 高度余量）
    const bandTop = viewportBand(250, clientHeight, scrollHeight, barHeight).top;
    expect(Math.abs(markerTop(contentTop, scrollHeight, barHeight) - bandTop)).toBeLessThanOrEqual(1);
  });
});
