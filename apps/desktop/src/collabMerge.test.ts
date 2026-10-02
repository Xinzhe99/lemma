/**
 * CRDT 协作合并测试（v1.5.0 B）：
 * 补丁文件往返、单向同步（我未动 → 结果=对端）、并发双侧编辑合并
 * （不同区域共存 / 同句变体共存不丢字 / 删除+编辑并存）、坏补丁抛错。
 */

import { describe, expect, it } from 'vitest';
import { applyCollabPatch, makePatchFile, parsePatchFile } from './collabMerge';

describe('补丁文件头', () => {
  it('makePatchFile / parsePatchFile 往返（meta 完整）', () => {
    const file = makePatchFile('base', 'changed', { file: 'main.tex', author: '甲' });
    const parsed = parsePatchFile(file);
    expect(parsed.v).toBe(1);
    expect(parsed.base).toBe('base');
    expect(parsed.text).toBe('changed');
    expect(parsed.meta).toMatchObject({ file: 'main.tex', author: '甲' });
  });

  it('坏 JSON / 缺字段抛错', () => {
    expect(() => parsePatchFile('not json')).toThrow();
    expect(() => parsePatchFile('{"v":2,"base":"a","text":"b"}')).toThrow();
    expect(() => parsePatchFile('{"v":1,"base":"a"}')).toThrow();
  });
});

describe('CRDT 合并', () => {
  const BASE = [
    'SECTION Introduction',
    'Large language models have changed how researchers write.',
    'We present ScholarForge, a local-first writing workstation.',
    'SECTION Method',
    'The system uses a blocking approval protocol.',
  ].join('\n');

  it('单向同步：我未改动 → 合并结果 = 对端全文', () => {
    const theirs = BASE.replace('changed', 'reshaped');
    const patch = makePatchFile(BASE, theirs, {});
    expect(applyCollabPatch(BASE, patch).merged).toBe(theirs);
  });

  it('并发编辑不同区域：双方改动共存', () => {
    const aText = BASE.replace('changed how researchers write', 'reshaped academic writing') + '\nSECTION Acknowledgments\nThanks.';
    const bText = BASE.replace('blocking approval protocol', 'CRDT-based merge protocol');
    const patch = makePatchFile(BASE, aText, {});
    const { merged } = applyCollabPatch(bText, patch);
    expect(merged).toContain('reshaped academic writing');
    expect(merged).toContain('CRDT-based merge protocol');
    expect(merged).toContain('Acknowledgments');
  });

  it('同句双侧变体共存（字符级收敛，不丢任何一方文字）', () => {
    const aText = BASE.replace('We present', 'We carefully present');
    const bText = BASE.replace('We present', 'We now present');
    const patch = makePatchFile(BASE, aText, {});
    const { merged } = applyCollabPatch(bText, patch);
    expect(merged).toContain('carefully');
    expect(merged).toContain('now');
    expect(merged).toContain('present ScholarForge');
  });

  it('A 删除段落 + B 编辑另一段：删除生效、B 的编辑保留', () => {
    const aText = BASE.replace('We present ScholarForge, a local-first writing workstation.\n', '');
    const bText = BASE.replace('blocking approval protocol', 'review-first approval protocol');
    const patch = makePatchFile(BASE, aText, {});
    const { merged } = applyCollabPatch(bText, patch);
    expect(merged).not.toContain('local-first writing workstation');
    expect(merged).toContain('review-first approval protocol');
  });

  it('我未动 + 对端未动 → 结果 = 原文（幂等）', () => {
    const patch = makePatchFile(BASE, BASE, {});
    expect(applyCollabPatch(BASE, patch).merged).toBe(BASE);
  });
});
