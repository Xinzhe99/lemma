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

  // v7.8.0 审计回归
  it('纯插入 hunk（旧行数为 0）：插在第 N 行之后，不是之前', () => {
    // @@ -2,0 +3,1 @@ = 在第 2 行之后插入
    const mid = applyUnifiedDiff(BEFORE, ['@@ -2,0 +3,1 @@', '+INSERTED'].join('\n'));
    expect(mid.ok && mid.text.split('\n')).toEqual(['line1', 'line2', 'INSERTED', 'line3', 'line4', 'line5']);

    // 头部插入（-0,0）语义不变
    const top = applyUnifiedDiff(BEFORE, ['@@ -0,0 +1,1 @@', '+HEAD'].join('\n'));
    expect(top.ok && top.text.split('\n')).toEqual(['HEAD', 'line1', 'line2', 'line3', 'line4', 'line5']);

    // 末尾追加（-5,0）
    const tail = applyUnifiedDiff(BEFORE, ['@@ -5,0 +6,1 @@', '+TAIL'].join('\n'));
    expect(tail.ok && tail.text.split('\n')).toEqual(['line1', 'line2', 'line3', 'line4', 'line5', 'TAIL']);

    // 与上下文行混排时，两种写法结果一致
    const withCtx = applyUnifiedDiff(BEFORE, ['@@ -2,1 +2,2 @@', ' line2', '+INSERTED'].join('\n'));
    expect(withCtx.ok && withCtx.text).toBe(mid.ok ? mid.text : '');
  });

  it('容忍尾部/ hunk 之间的空行（模型常在 diff 末尾多带一个换行）', () => {
    const trailing = applyUnifiedDiff(BEFORE, ['@@ -1,1 +1,1 @@', '-line1', '+NEW1', '', ''].join('\n'));
    expect(trailing.ok).toBe(true);
    if (trailing.ok) expect(trailing.text.split('\n')[0]).toBe('NEW1');

    const between = applyUnifiedDiff(
      BEFORE,
      ['@@ -1,1 +1,1 @@', '-line1', '+NEW1', '', '@@ -5,1 +5,1 @@', '-line5', '+NEW5'].join('\n'),
    );
    expect(between.ok).toBe(true);
    if (between.ok) {
      expect(between.text.split('\n')).toEqual(['NEW1', 'line2', 'line3', 'line4', 'NEW5']);
    }
  });
});
