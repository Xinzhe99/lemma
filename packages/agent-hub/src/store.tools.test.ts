import { beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@lemma/shared';
import { useAgentHubStore } from './store';

describe('appendToolResult', () => {
beforeEach(() => {
  useAgentHubStore.setState({
    sessions: [],
    activeSessionId: null,
    runs: [],
  });
});

  it('追加 role=tool 消息并携带 toolCallId', () => {
    const hub = useAgentHubStore.getState();
    const sid = hub.newSession('test');
    const callId = createId();
    hub.sendMessage(sid, '帮我检索');
    hub.appendToolCall(sid, { id: callId, tool: 'library.search_fulltext', args: { query: 'attention' } });
    useAgentHubStore.getState().appendToolResult(sid, callId, JSON.stringify({ hits: 3 }));

    const session = useAgentHubStore.getState().sessions.find((s) => s.id === sid)!;
    const toolMsg = session.messages.filter((m) => m.role === 'tool');
    expect(toolMsg).toHaveLength(1);
    expect(toolMsg[0]!.toolCallId).toBe(callId);
    expect(toolMsg[0]!.content).toContain('hits');
  });

  it('多次回填按序追加，不覆盖此前消息', () => {
    const hub = useAgentHubStore.getState();
    const sid = hub.newSession('test');
    const c1 = createId();
    const c2 = createId();
    hub.sendMessage(sid, '两步');
    hub.appendToolCall(sid, { id: c1, tool: 'project.context', args: {} });
    hub.appendToolCall(sid, { id: c2, tool: 'tex.last_errors', args: {} });
    useAgentHubStore.getState().appendToolResult(sid, c1, 'ctx');
    useAgentHubStore.getState().appendToolResult(sid, c2, '[]');

    const session = useAgentHubStore.getState().sessions.find((s) => s.id === sid)!;
    const toolMsgs = session.messages.filter((m) => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(toolMsgs.map((m) => m.content)).toEqual(['ctx', '[]']);
    // 用户消息与 assistant 占位仍在
    expect(session.messages.some((m) => m.role === 'user' && m.content === '两步')).toBe(true);
  });

  it('同一轮多次调用（宿主逐个 call→result 回填）挂在同一条 assistant 消息上', () => {
    const hub = useAgentHubStore.getState();
    const sid = hub.newSession('test');
    const c1 = createId();
    const c2 = createId();
    hub.sendMessage(sid, '查两篇');
    // 宿主 runAgentTurn 的真实顺序：调用 → 执行 → 回填，再下一个
    hub.appendToolCall(sid, { id: c1, tool: 'library.search', args: { query: 'a' } });
    useAgentHubStore.getState().appendToolResult(sid, c1, 'r1');
    useAgentHubStore.getState().appendToolCall(sid, { id: c2, tool: 'library.search', args: { query: 'b' } });
    useAgentHubStore.getState().appendToolResult(sid, c2, 'r2');

    const session = useAgentHubStore.getState().sessions.find((s) => s.id === sid)!;
    const assistants = session.messages.filter((m) => m.role === 'assistant');
    expect(assistants).toHaveLength(1); // 不再另起空 assistant 气泡
    expect(assistants[0]!.toolCalls?.map((c) => c.id)).toEqual([c1, c2]);
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
  });
});
