import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentHubStore } from './store';

function fresh() {
  useAgentHubStore.setState({ sessions: [], activeSessionId: null, runs: [] });
}

beforeEach(fresh);

describe('useAgentHubStore', () => {
  it('newSession：创建并激活会话', () => {
    const id = useAgentHubStore.getState().newSession('deepseek');
    const s = useAgentHubStore.getState().sessions;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ id, title: '新会话', providerId: 'deepseek', status: 'idle', messages: [] });
    expect(useAgentHubStore.getState().activeSessionId).toBe(id);
  });

  it('sendMessage：乐观插入 user 消息 + assistant 占位，状态 streaming，标题取首条用户消息', () => {
    const { newSession, sendMessage } = useAgentHubStore.getState();
    const id = newSession('glm');
    sendMessage(id, '帮我润色引言');
    const session = useAgentHubStore.getState().sessions[0];
    expect(session.status).toBe('streaming');
    expect(session.title).toBe('帮我润色引言');
    expect(session.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(session.messages[1].content).toBe('');
  });

  it('appendDelta / appendToolCall 回填 assistant 占位', () => {
    const { newSession, sendMessage, appendDelta, appendToolCall } = useAgentHubStore.getState();
    const id = newSession('kimi');
    sendMessage(id, '查文献');
    appendDelta(id, '正在');
    appendDelta(id, '检索…');
    appendToolCall(id, { id: 'call_1', tool: 'library.search', args: { query: 'diffusion' } });

    const session = useAgentHubStore.getState().sessions[0];
    const assistant = session.messages[1];
    expect(assistant.content).toBe('正在检索…');
    expect(assistant.toolCalls).toEqual([{ id: 'call_1', tool: 'library.search', args: { query: 'diffusion' } }]);

    // 再次流式追加不影响 toolCalls
    appendDelta(id, '完成');
    expect(useAgentHubStore.getState().sessions[0].messages[1].content).toBe('正在检索…完成');
  });

  it('finishSession：正常结束与出错', () => {
    const { newSession, sendMessage, finishSession } = useAgentHubStore.getState();
    const id = newSession('echo');
    sendMessage(id, 'hi');
    expect(useAgentHubStore.getState().sessions[0].status).toBe('streaming');
    finishSession(id, 'idle');
    expect(useAgentHubStore.getState().sessions[0].status).toBe('idle');
    sendMessage(id, 'again');
    finishSession(id, 'error');
    expect(useAgentHubStore.getState().sessions[0].status).toBe('error');
  });

  it('updateRun：插入、按 id 更新、多条共存', () => {
    const { updateRun } = useAgentHubStore.getState();
    const base = { id: 'run-1', provider: 'deepseek', startedAt: 1 };
    updateRun({ ...base, status: 'running' });
    updateRun({ ...base, status: 'done', costUsd: 0.05, endedAt: 2 });
    updateRun({ id: 'run-2', provider: 'glm', status: 'running', startedAt: 3 });
    const runs = useAgentHubStore.getState().runs;
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.id === 'run-1')).toMatchObject({ status: 'done', costUsd: 0.05 });
    expect(runs.find((r) => r.id === 'run-2')).toMatchObject({ status: 'running' });
  });

  it('未知会话的操作不崩溃也不产生脏数据', () => {
    const { sendMessage, appendDelta, appendToolCall, finishSession } = useAgentHubStore.getState();
    expect(() => {
      sendMessage('ghost', 'x');
      appendDelta('ghost', 'y');
      appendToolCall('ghost', { id: 'c', tool: 't', args: {} });
      finishSession('ghost', 'idle');
    }).not.toThrow();
    expect(useAgentHubStore.getState().sessions).toHaveLength(0);
  });
});
