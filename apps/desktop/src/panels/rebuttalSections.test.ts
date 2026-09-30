/**
 * WF-3 A4：splitRebuttalSections 纯函数单测——W7 finalize 输出按审稿人分段
 * （R1/R2/R3/Meta 或中文标记标题），标题前内容作总述段；无分段标记返回 null。
 */
import { describe, expect, it } from 'vitest';
import { countChars, splitRebuttalSections } from './ReviewPanel';

const MD_MIXED = `感谢三位审稿人的意见。以下是逐条回复与修改概览。

## R1: 方法部分
R1.1 已补充推导（见附录 A.1）。
R1.2 采用 argue 策略，补充了两组对照实验。

**Reviewer 2: 相关工作**
R2.1 补充了 3 篇引用。

【审稿人三】
R3.1 报告了随机种子与方差。

# Meta-Review
整体修改清单见文末。`;

describe('splitRebuttalSections', () => {
  it('R1/Reviewer 2/【审稿人三】/Meta-Review 四种标题形态都能分段，标题前内容为总述段', () => {
    const segments = splitRebuttalSections(MD_MIXED);
    expect(segments).not.toBeNull();
    expect(segments!.map((s) => s.title)).toEqual([
      null,
      'R1: 方法部分',
      'Reviewer 2: 相关工作',
      '审稿人三',
      'Meta-Review',
    ]);
    expect(segments![0]!.body).toContain('感谢三位审稿人');
    expect(segments![1]!.body).toContain('R1.1');
    expect(segments![1]!.body).toContain('R1.2');
    expect(segments![3]!.body).toContain('R3.1');
  });

  it('无分段标记 → null（降级原文）', () => {
    expect(splitRebuttalSections('一段没有任何标题的自由文本 rebuttal。')).toBeNull();
    expect(splitRebuttalSections('')).toBeNull();
  });

  it('无总述时首段即审稿人段', () => {
    const segments = splitRebuttalSections('## R1\n第一条回复。');
    expect(segments!.map((s) => s.title)).toEqual(['R1']);
  });
});

describe('countChars', () => {
  it('去空白计数（中英文）', () => {
    expect(countChars('  hello \n world  ')).toBe(10);
    expect(countChars('你好 世界')).toBe(4); // 空格不计
    expect(countChars('')).toBe(0);
  });
});
