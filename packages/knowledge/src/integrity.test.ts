import { describe, expect, it } from 'vitest';
import { extractCitations, sanitizeForExport, validateCitations } from './integrity';

describe('extractCitations', () => {
  it('识别 [citekey] 与 [citekey p.12]', () => {
    const md = '如 [vaswani2017] 所示，另见 [devlin2019 p. 12] 与 [brown2020 p.7]。';
    expect(extractCitations(md)).toEqual([
      { citekey: 'vaswani2017' },
      { citekey: 'devlin2019', page: 12 },
      { citekey: 'brown2020', page: 7 },
    ]);
  });

  it('忽略 markdown 链接 / 双链 / 复选框 / 纯页码标记', () => {
    const md = [
      '打开 [点击这里](https://example.com) 查看。',
      '双链 [[知识图谱]] 与图片 ![fig](a.png)。',
      '- [x] 已完成，- [ ] 未完成',
      '见 [p.33] 那一页。',
    ].join('\n');
    expect(extractCitations(md)).toEqual([]);
  });

  it('保留重复出现（按序）', () => {
    const cites = extractCitations('A [k1] B [k2] C [k1]');
    expect(cites).toHaveLength(3);
    expect(cites[2]).toEqual({ citekey: 'k1' });
  });
});

describe('validateCitations', () => {
  it('全部合法', () => {
    const r = validateCitations('基于 [a2020] 与 [b2021 p.5] 的工作。', ['a2020', 'b2021', 'c2022']);
    expect(r.ok).toBe(true);
    expect(r.invalid).toEqual([]);
    expect(r.usedKeys).toEqual(['a2020', 'b2021']);
  });

  it('幻觉引用全部报出', () => {
    const r = validateCitations('基于 [a2020] 与 [ghost2099 p.3]、[phantom] 的工作。', ['a2020']);
    expect(r.ok).toBe(false);
    expect(r.invalid).toEqual(['ghost2099', 'phantom']);
    expect(r.usedKeys).toEqual(['a2020', 'ghost2099', 'phantom']);
  });

  it('同一非法键只报一次；无引用时空过', () => {
    const r = validateCitations('[x1] 和 [x1]', ['y']);
    expect(r.invalid).toEqual(['x1']);
    const none = validateCitations('没有任何引用。', []);
    expect(none).toEqual({ ok: true, invalid: [], usedKeys: [] });
  });
});

describe('sanitizeForExport', () => {
  it('敏感串替换为 ⟦REDACTED⟧', () => {
    const out = sanitizeForExport('请联系 zhang@example.com 或张三获取数据。', ['zhang@example.com', '张三']);
    expect(out).toBe('请联系 ⟦REDACTED⟧ 或⟦REDACTED⟧获取数据。');
    expect(out).not.toContain('zhang@example.com');
    expect(out).not.toContain('张三');
  });

  it('长串优先，避免子串先替换；空串与未命中原样返回', () => {
    expect(sanitizeForExport('secret secret123 end', ['secret', 'secret123'])).toBe('⟦REDACTED⟧ ⟦REDACTED⟧ end');
    expect(sanitizeForExport('nothing here', [])).toBe('nothing here');
    expect(sanitizeForExport('a b c', [''])).toBe('a b c');
  });
});
