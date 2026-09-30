import { describe, expect, it } from 'vitest';
import { parseReviewSections, scoreTone } from './reviewParser';

const MD_EN = `## Summary
The paper proposes a demo pipeline.
It has three stages.

## Strengths
- Clear writing
- Solid evaluation

## Weaknesses
1. Missing ablation
2. No variance reported

## Questions
- What baseline is used?

Score band: borderline accept`;

const MD_ZH = `**总评**
本文提出了一个面向科研写作的智能体工作流。

**优点**
- 结构清晰

**缺点**
- 实验不足
- 缺少对比

**问题**
复现细节是否完整？`;

describe('parseReviewSections', () => {
  it('英文 ## 标题 + 行内 score 提取', () => {
    const r = parseReviewSections(MD_EN);
    expect(r.summary).toContain('three stages');
    expect(r.strengths).toContain('Clear writing');
    expect(r.weaknesses).toContain('Missing ablation');
    expect(r.questions).toContain('baseline');
    expect(r.score).toBe('borderline accept');
    expect(scoreTone(r.score)).toBe('good'); // accept 且无 reject
  });

  it('中文 **粗体** 标题', () => {
    const r = parseReviewSections(MD_ZH);
    expect(r.summary).toContain('智能体工作流');
    expect(r.strengths).toContain('结构清晰');
    expect(r.weaknesses).toContain('实验不足');
    expect(r.questions).toContain('复现');
  });

  it('行内式标题「Weaknesses: xxx」与无结构文本降级', () => {
    const r = parseReviewSections('Weaknesses: 1) bad baseline 2) no ablation\n其他叙述文字');
    expect(r.weaknesses).toContain('bad baseline');
    const plain = parseReviewSections('这是一段没有结构的审稿文字。');
    expect(plain.summary).toBeUndefined();
    expect(plain.score).toBeUndefined();
  });

  it('scoreTone 分类', () => {
    expect(scoreTone('strong reject')).toBe('bad');
    expect(scoreTone('borderline')).toBe('mid');
    expect(scoreTone(undefined)).toBe('unknown');
  });
});
