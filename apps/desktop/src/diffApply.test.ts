import { describe, expect, it } from 'vitest';
import { applyUnifiedDiff } from './diffApply';

const BEFORE = ['line1', 'line2', 'line3', 'line4', 'line5'].join('\n');

describe('applyUnifiedDiff', () => {
  it('单个 hunk：替换一行', () => {
    const diff = ['--- a/main.tex', '+++ b/main.tex', '@@ -2,1 +2,1 @@', '-line2', '+LINE TWO'].join('\n');
    const result = applyUnifiedDiff(BEFORE, diff);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.split('\n')).toEqual(['line1', 'LINE TWO', 'line3', 'line4', 'line5']);
    }
  });

  it('多个 hunk：偏移正确累计', () => {
    const diff = [
      '@@ -1,2 +1,3 @@',
      ' line1',
      '+inserted',
      ' line2',
      '@@ -4,1 +5,1 @@',
      '-line4',
      '+LINE FOUR',
    ].join('\n');
    const result = applyUnifiedDiff(BEFORE, diff);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.split('\n')).toEqual(['line1', 'inserted', 'line2', 'line3', 'LINE FOUR', 'line5']);
    }
  });

  it('带上下文行的纯插入/删除', () => {
    const del = ['@@ -1,3 +1,2 @@', ' line1', '-line2', ' line3'].join('\n');
    const r1 = applyUnifiedDiff(BEFORE, del);
    expect(r1.ok && r1.text.split('\n')).toEqual(['line1', 'line3', 'line4', 'line5']);

    const add = ['@@ -5,1 +5,2 @@', ' line5', '+line6'].join('\n');
    const r2 = applyUnifiedDiff(BEFORE, add);
    expect(r2.ok && r2.text.split('\n')).toEqual(['line1', 'line2', 'line3', 'line4', 'line5', 'line6']);
  });

  it('容忍 \\ No newline 标记', () => {
    const diff = ['@@ -1,1 +1,1 @@', '-line1', '+new1', '\\ No newline at end of file'].join('\n');
    const result = applyUnifiedDiff(BEFORE, diff);
    expect(result.ok).toBe(true);
  });

  it('上下文不匹配时整体失败并给出行级原因', () => {
    const diff = ['@@ -1,2 +1,2 @@', '-wrong', '-context', '+x', '+y'].join('\n');
    const result = applyUnifiedDiff(BEFORE, diff);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('不匹配');
  });

  it('无 hunk / 坏行报错', () => {
    expect(applyUnifiedDiff(BEFORE, '--- a\n+++ b').ok).toBe(false);
    expect(applyUnifiedDiff(BEFORE, '@@ -1,1 +1,1 @@\ngarbage line').ok).toBe(false);
  });
});
