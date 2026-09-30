// @vitest-environment jsdom
/**
 * 编辑器字号调节纯函数测试（EditorArea 导出件）：
 *  - handleFontSizeKey：'=' / '+' 放大、'-' 缩小、'0' 重置 14、其余键 null、边界（10/24）钳制；
 *  - clampFontSize：越界/非有限值钳制与取整；
 *  - loadFontSize / saveFontSize：localStorage 读写往返、缺失/损坏/越界回落。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STORAGE_KEY,
  clampFontSize,
  handleFontSizeKey,
  loadFontSize,
  saveFontSize,
} from './EditorArea';

beforeEach(() => {
  localStorage.clear();
});

describe('handleFontSizeKey · 快捷键处理', () => {
  it("'=' 与 '+' 均放大 1px", () => {
    expect(handleFontSizeKey('=', 14)).toBe(15);
    expect(handleFontSizeKey('+', 14)).toBe(15);
    expect(handleFontSizeKey('=', 19)).toBe(20);
    expect(handleFontSizeKey('+', 10)).toBe(11);
  });

  it("'-' 缩小 1px；'0' 重置为默认 14", () => {
    expect(handleFontSizeKey('-', 14)).toBe(13);
    expect(handleFontSizeKey('-', 11)).toBe(10);
    expect(handleFontSizeKey('0', 22)).toBe(14);
    expect(handleFontSizeKey('0', 10)).toBe(FONT_SIZE_DEFAULT);
  });

  it('其余按键返回 null（不处理，交回默认行为）', () => {
    expect(handleFontSizeKey('x', 14)).toBeNull();
    expect(handleFontSizeKey('9', 14)).toBeNull();
    expect(handleFontSizeKey('Enter', 14)).toBeNull();
    expect(handleFontSizeKey('', 14)).toBeNull();
  });

  it('边界钳制：上限 24 放大不变、下限 10 缩小不变（重置不受钳制影响）', () => {
    expect(handleFontSizeKey('=', 24)).toBe(24);
    expect(handleFontSizeKey('+', 24)).toBe(24);
    expect(handleFontSizeKey('-', 10)).toBe(10);
    expect(handleFontSizeKey('0', 24)).toBe(14);
  });
});

describe('clampFontSize · 钳制', () => {
  it('钳到 [10, 24] 且取整', () => {
    expect(clampFontSize(5)).toBe(10);
    expect(clampFontSize(99)).toBe(24);
    expect(clampFontSize(13.4)).toBe(13);
    expect(clampFontSize(13.5)).toBe(14);
    expect(clampFontSize(14)).toBe(14);
  });

  it('非有限值回落默认 14', () => {
    expect(clampFontSize(Number.NaN)).toBe(14);
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(14);
  });
});

describe('loadFontSize / saveFontSize · localStorage 读写', () => {
  it('无持久化值时返回默认 14', () => {
    expect(loadFontSize()).toBe(14);
  });

  it('save → load 往返一致', () => {
    saveFontSize(18);
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe('18');
    expect(loadFontSize()).toBe(18);

    saveFontSize(12);
    expect(loadFontSize()).toBe(12);
  });

  it('save 持久化钳制后的值（越界写入被夹回）', () => {
    saveFontSize(200);
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe(String(FONT_SIZE_MAX));
    saveFontSize(1);
    expect(localStorage.getItem(FONT_SIZE_STORAGE_KEY)).toBe(String(FONT_SIZE_MIN));
    expect(loadFontSize()).toBe(10);
  });

  it('损坏（非数字）持久化值回落默认', () => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, 'abc');
    expect(loadFontSize()).toBe(14);
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, '');
    expect(loadFontSize()).toBe(14);
  });

  it('越界持久化值读取时被钳制', () => {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, '99');
    expect(loadFontSize()).toBe(24);
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, '2');
    expect(loadFontSize()).toBe(10);
  });
});
