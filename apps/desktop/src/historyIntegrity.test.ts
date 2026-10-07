/**
 * historyIntegrity 单测（v7.8.0 审计补充）：
 * sanitizeAgentMessages 的输出必须是「严格网关可接受」的序列——
 * 每条 tool 消息都能对应到它**之前**的 assistant(tool_calls)，
 * 且保留 tool_calls 的 assistant 的每个调用都有唯一结果。
 * 覆盖：顺序错位的结果、部分应答的块、重复结果、合法序列原样保留。
 */
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@lemma/shared';
import { sanitizeAgentMessages } from './historyIntegrity';

const msg = (patch: Partial<AgentMessage> & { role: AgentMessage['role'] }): AgentMessage => ({
  id: `m-${Math.random().toString(36).slice(2, 8)}`,
  content: '',
  createdAt: 1,
  ...patch,
});

/** 严格网关校验：tool 消息必须跟随声明它的 assistant；保留的 tool_calls 结果必须齐全 */
function assertWireValid(seq: AgentMessage[]): void {
  const open = new Set<string>();
  for (const m of seq) {
    if (m.role === 'assistant' && m.toolCalls?.length) {
      for (const tc of m.toolCalls) {
        expect(open.has(tc.id)).toBe(false); // 同一调用不重复声明
        open.add(tc.id);
      }
    } else if (m.role === 'tool' && m.toolCallId) {
      expect(open.has(m.toolCallId)).toBe(true); // 无孤儿
      open.delete(m.toolCallId);
    }
  }
  expect([...open]).toEqual([]); // 无悬空 tool_calls
}

describe('sanitizeAgentMessages（v7.8.0）', () => {
  it('工具结果排在声明它的 assistant 之前 → 视为孤儿丢弃（旧实现会保留）', () => {
    const seq: AgentMessage[] = [
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'tool', content: '{"x":1}', toolCallId: 'tc1' }),
      msg({ role: 'assistant', content: '我调工具', toolCalls: [{ id: 'tc1', tool: 'tex.edit', args: {} }] }),
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out.some((m) => m.role === 'tool')).toBe(false);
    assertWireValid(out);
  });

  it('部分应答的块：toolCalls 与其部分结果一并剥离（旧实现会留下孤儿 tool 消息）', () => {
    const seq: AgentMessage[] = [
      msg({ role: 'user', content: '改两处' }),
      msg({
        role: 'assistant',
        content: '我调两个工具',
        toolCalls: [
          { id: 'a', tool: 'tex.edit', args: {} },
          { id: 'b', tool: 'tex.compile', args: {} },
        ],
      }),
      msg({ role: 'tool', content: '{"applied":true}', toolCallId: 'a' }), // b 的结果缺失
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out).toHaveLength(2);
    expect(out[1]!.toolCalls).toBeUndefined();
    expect(out[1]!.content).toBe('我调两个工具');
    assertWireValid(out);
  });

  it('结果齐全的块原样保留；重复结果只留第一份', () => {
    const seq: AgentMessage[] = [
      msg({ role: 'user', content: '改两处' }),
      msg({
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'a', tool: 'tex.edit', args: {} },
          { id: 'b', tool: 'tex.compile', args: {} },
        ],
      }),
      msg({ role: 'tool', content: 'A1', toolCallId: 'a' }),
      msg({ role: 'tool', content: 'A2', toolCallId: 'a' }), // 重复
      msg({ role: 'tool', content: 'B1', toolCallId: 'b' }),
      msg({ role: 'assistant', content: '完成' }),
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual(['A1', 'B1']);
    assertWireValid(out);
  });

  it('无 toolCalls 的普通消息一律保留（含 system）', () => {
    const seq: AgentMessage[] = [
      msg({ role: 'system', content: 'sys' }),
      msg({ role: 'user', content: 'u' }),
      msg({ role: 'assistant', content: 'a' }),
    ];
    expect(sanitizeAgentMessages(seq)).toEqual(seq);
  });
});
