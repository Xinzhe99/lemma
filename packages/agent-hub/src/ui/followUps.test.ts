/**
 * v4.3.0 回复后上下文建议：按最后一条 assistant 消息的工具使用推断下一步 chips。
 */
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@lemma/shared';
import { followUpSuggestions } from './followUps';

function msg(over: Partial<AgentMessage>): AgentMessage {
  return {
    id: 'm1',
    role: 'assistant',
    content: 'ok',
    createdAt: 1,
    ...over,
  } as AgentMessage;
}

describe('followUpSuggestions', () => {
  it('空消息 / 无 assistant 消息 → 无建议', () => {
    expect(followUpSuggestions([])).toEqual([]);
    expect(followUpSuggestions([msg({ id: 'u1', role: 'user', content: 'hi' })])).toEqual([]);
  });

  it('改稿工具（tex.edit）→ 编译验证 + 引用检查', () => {
    const out = followUpSuggestions([
      msg({ id: 'u1', role: 'user', content: '改一下' }),
      msg({
        id: 'a1',
        toolCalls: [{ id: 'c1', tool: 'tex.edit', args: {} } as never],
      }),
    ]);
    expect(out.length).toBeGreaterThan(0);
    expect(out[0].label).toContain('编译');
    expect(out.some((c) => c.label.includes('引用'))).toBe(true);
  });

  it('paper.read → 总结论文方法', () => {
    const out = followUpSuggestions([
      msg({ id: 'a1', toolCalls: [{ id: 'c1', tool: 'paper.read', args: {} } as never] }),
    ]);
    expect(out.some((c) => c.label.includes('总结'))).toBe(true);
  });

  it('web.search_scholar → 导入文献建议', () => {
    const out = followUpSuggestions([
      msg({ id: 'a1', toolCalls: [{ id: 'c1', tool: 'web.search_scholar', args: {} } as never] }),
    ]);
    expect(out.some((c) => c.label.includes('导入'))).toBe(true);
    expect(out[0].text).toContain('BibTeX');
  });

  it('library.search_fulltext 且未读原文 → 引导 paper.read', () => {
    const out = followUpSuggestions([
      msg({ id: 'a1', toolCalls: [{ id: 'c1', tool: 'library.search_fulltext', args: {} } as never] }),
    ]);
    expect(out.some((c) => c.text.includes('paper.read'))).toBe(true);
  });

  it('无工具回复 → 通用「继续 / 应用到稿件」', () => {
    const out = followUpSuggestions([msg({ id: 'a1' })]);
    expect(out.map((c) => c.label)).toContain('▶️ 继续');
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('建议数上限 3', () => {
    const out = followUpSuggestions([
      msg({
        id: 'a1',
        toolCalls: [
          { id: 'c1', tool: 'tex.edit', args: {} } as never,
          { id: 'c2', tool: 'tex.compile', args: {} } as never,
          { id: 'c3', tool: 'paper.read', args: {} } as never,
          { id: 'c4', tool: 'web.search_scholar', args: {} } as never,
        ],
      }),
    ]);
    expect(out.length).toBeLessThanOrEqual(3);
  });
});
