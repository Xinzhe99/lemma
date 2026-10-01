/**
 * 页数预算纯函数测试：pdflatex/latexmk 与 tectonic 两种日志模式、
 * 多次编译取最后一次、无匹配 null、venue pageLimit 字符串各种形态解析。
 */
import { describe, expect, it } from 'vitest';
import { parsePageCount, venuePageLimit } from './pageBudget';
import { VENUE_PROFILES, type VenueProfile } from './submission/venues';

describe('parsePageCount（编译日志页数解析）', () => {
  it('pdflatex/latexmk：Output written on … (N pages, bytes)', () => {
    const log = [
      'Latexmk: All targets () are up to date',
      'Output written on main.pdf (9 pages, 348576 bytes).',
    ].join('\n');
    expect(parsePageCount(log)).toBe(9);
  });

  it('单页时 "1 page"（无 s）也能解析', () => {
    expect(parsePageCount('Output written on main.pdf (1 page, 34857 bytes).')).toBe(1);
  });

  it('tectonic：Wrote N pages（含 note: 前缀与写文件变体）', () => {
    expect(parsePageCount('note: Wrote 12 pages')).toBe(12);
    expect(parsePageCount('Wrote 3 pages to main.pdf')).toBe(3);
  });

  it('compileLog 跨多次编译累积时取最后一次出现', () => {
    const log = [
      'Output written on main.pdf (10 pages, 100 bytes).',
      'Output written on main.pdf (11 pages, 110 bytes).',
    ].join('\n');
    expect(parsePageCount(log)).toBe(11);
  });

  it('无匹配 / 空日志返回 null（不做 PDF 大小估算）', () => {
    expect(parsePageCount('')).toBeNull();
    expect(parsePageCount('▣ tectonic（内置） · 3 趟 · 1200ms · 成功')).toBeNull();
    expect(parsePageCount('产品 main.pdf 大小 348576 字节，约 9 页')).toBeNull();
  });
});

describe('venuePageLimit（pageLimit 字符串取首个整数）', () => {
  const venue = (pageLimit: string): VenueProfile => ({
    ...VENUE_PROFILES[0]!,
    pageLimit,
  });

  it('"9 页（含引用）" → 9；"9-10 页" → 9（取首个）', () => {
    expect(venuePageLimit(venue('9 页（含引用）'))).toBe(9);
    expect(venuePageLimit(venue('9-10 页'))).toBe(9);
  });

  it('真实档案：NeurIPS 9、CVPR 8、ICML 8–9 → 8、ECCV 14', () => {
    const byId = (id: string) => VENUE_PROFILES.find((v) => v.id === id)!;
    expect(venuePageLimit(byId('neurips'))).toBe(9);
    expect(venuePageLimit(byId('cvpr'))).toBe(8);
    expect(venuePageLimit(byId('icml'))).toBe(8);
    expect(venuePageLimit(byId('eccv'))).toBe(14);
  });

  it('"No limit" / 无整数 → null；null/undefined 档案 → null', () => {
    expect(venuePageLimit(venue('No limit'))).toBeNull();
    expect(venuePageLimit(venue('以当年 CFP 为准'))).toBeNull();
    expect(venuePageLimit(null)).toBeNull();
    expect(venuePageLimit(undefined)).toBeNull();
  });
});
