import { describe, expect, it } from 'vitest';
import {
  VENUE_PROFILES,
  findVenueProfile,
  listVenueNames,
  normalizeVenueText,
  venueById,
  type VenueProfile,
} from './venues';

describe('内置档案数据（S1）', () => {
  it('≥10 个场所，id 唯一，必填字段全部非空', () => {
    expect(VENUE_PROFILES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(VENUE_PROFILES.map((v) => v.id)).size).toBe(VENUE_PROFILES.length);
    for (const v of VENUE_PROFILES) {
      for (const key of ['name', 'pageLimit', 'template', 'anonymity', 'supplementary', 'aiPolicy', 'notes'] as const) {
        expect(v[key], `${v.id}.${key}`).toBeTruthy();
      }
      expect(v.scope.length).toBeGreaterThan(0);
    }
  });

  it('NeurIPS 档案含页数上限与双盲匿名规则', () => {
    const n = venueById('neurips');
    expect(n).toBeDefined();
    expect(n!.pageLimit).toContain('9');
    expect(n!.pageLimit).toContain('页');
    expect(n!.anonymity).toContain('双盲');
  });

  it('覆盖 ML/CV/NLP 会议、Nature 系、TPAMI/JMLR 与中文期刊', () => {
    const ids = new Set(VENUE_PROFILES.map((v) => v.id));
    for (const id of ['neurips', 'icml', 'iclr', 'cvpr', 'eccv', 'acl', 'emnlp', 'nature', 'tpami', 'jmlr', 'jos']) {
      expect(ids.has(id), `缺少档案：${id}`).toBe(true);
    }
    expect(listVenueNames()).toContain('软件学报');
  });
});

describe('findVenueProfile 模糊匹配', () => {
  it('id / 全名 / 别名 / 大小写与空白标点不敏感', () => {
    expect(findVenueProfile('NeurIPS')!.id).toBe('neurips');
    expect(findVenueProfile('neurips')!.id).toBe('neurips');
    expect(findVenueProfile('NIPS')!.id).toBe('neurips');
    expect(findVenueProfile('Conference on Computer Vision and Pattern Recognition')!.id).toBe('cvpr');
    expect(findVenueProfile('  ieee   tpami ')!.id).toBe('tpami');
    expect(findVenueProfile('PAMI')!.id).toBe('tpami');
    expect(findVenueProfile('软件学报')!.id).toBe('jos');
    expect(findVenueProfile('nature machine intelligence')!.id).toBe('nature-machine-intelligence');
  });

  it('包含式匹配取最长键，长名不误命中短名', () => {
    // "nature machine intelligence" 不应因包含 "nature" 而命中 Nature 主刊
    expect(findVenueProfile('Nature Machine Intelligence')!.id).toBe('nature-machine-intelligence');
    // 带年份后缀的常见写法
    expect(findVenueProfile('NeurIPS 2026')!.id).toBe('neurips');
    expect(findVenueProfile('CVPR 2025')!.id).toBe('cvpr');
  });

  it('无匹配 / 空查询返回 undefined', () => {
    expect(findVenueProfile('完全未知的刊物')).toBeUndefined();
    expect(findVenueProfile('Journal of Nowhere 123')).toBeUndefined();
    expect(findVenueProfile('')).toBeUndefined();
  });

  it('可注入 mock 档案（S3 单测契约）', () => {
    const mocked: VenueProfile[] = [
      {
        id: 'democonf',
        name: 'Demo Conference on Widgets',
        type: 'conference',
        pageLimit: '12 页',
        template: 'demo.sty',
        anonymity: '双盲',
        supplementary: '允许',
        aiPolicy: '需披露',
        notes: '虚构档案',
        scope: ['widgets'],
      },
    ];
    expect(findVenueProfile('demo conference on widgets', mocked)!.id).toBe('democonf');
    expect(findVenueProfile('DEMOCONF', mocked)!.id).toBe('democonf');
    // 注入档案后查内置场所不可见，证明匹配以注入表为准
    expect(findVenueProfile('NeurIPS', mocked)).toBeUndefined();
  });

  it('normalizeVenueText 归一化空串', () => {
    expect(normalizeVenueText('  IEEE  (T-PAMI) ')).toBe('ieeetpami');
    expect(normalizeVenueText('   ')).toBe('');
  });
});
