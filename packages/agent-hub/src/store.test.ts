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

// ---------------------------------------------------------------------------
// v1.2.0 会话持久化：serialize/parse 纯函数 + hydrate/rename/delete/上限
// ---------------------------------------------------------------------------

import {
  SESSIONS_LIMIT,
  serializeSessionsForPersist,
  parsePersistedSessions,
  type AgentSession,
} from './store';

function mkSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: overrides.id ?? 's1',
    title: overrides.title ?? '会话',
    providerId: 'host',
    status: overrides.status ?? 'idle',
    messages:
      overrides.messages ?? [
        { id: 'm1', role: 'user', content: '你好', createdAt: 1 },
        { id: 'm2', role: 'assistant', content: '你好！', createdAt: 2 },
      ],
  };
}

describe('会话持久化纯函数', () => {
  it('serializeSessionsForPersist：streaming 落盘为 idle，消息深拷贝（不与内存共享引用）', () => {
    const s = mkSession({ status: 'streaming' });
    const out = serializeSessionsForPersist([s]);
    expect(out[0].status).toBe('idle');
    expect(s.status).toBe('streaming'); // 原对象不变
    out[0].messages[0].content = 'mutated';
    expect(s.messages[0].content).toBe('你好'); // 深拷贝隔离
  });

  it('parsePersistedSessions：坏记录丢弃、streaming 恢复为 error、截断到上限', () => {
    const bad = { id: 1, title: 'x' }; // 缺字段
    const good = mkSession({ id: 'good' });
    const streaming = mkSession({ id: 'st', status: 'streaming' });
    const many = Array.from({ length: SESSIONS_LIMIT + 5 }, (_, i) => mkSession({ id: `s${i}` }));
    expect(parsePersistedSessions('not-array')).toEqual([]);
    expect(parsePersistedSessions(null)).toEqual([]);
    const parsed = parsePersistedSessions([bad, good, streaming]);
    expect(parsed.map((p) => p.id)).toEqual(['good', 'st']);
    expect(parsed[1].status).toBe('error');
    const capped = parsePersistedSessions(many);
    expect(capped).toHaveLength(SESSIONS_LIMIT);
    expect(capped[capped.length - 1].id).toBe(`s${SESSIONS_LIMIT + 4}`); // 保留最新
  });
});

describe('会话管理 actions（v1.2.0）', () => {
  it('hydrateSessions：整体替换、activeId 缺失回落首个', () => {
    useAgentHubStore.getState().newSession('host'); // 预置一条，应被水合替换
    const a = mkSession({ id: 'a' });
    const b = mkSession({ id: 'b' });
    useAgentHubStore.getState().hydrateSessions([a, b], 'ghost');
    expect(useAgentHubStore.getState().sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(useAgentHubStore.getState().activeSessionId).toBe('a');
    useAgentHubStore.getState().hydrateSessions([a, b], 'b');
    expect(useAgentHubStore.getState().activeSessionId).toBe('b');
  });

  it('renameSession：裁剪空白与长度；空标题不改', () => {
    const a = mkSession({ id: 'a', title: '旧标题' });
    useAgentHubStore.getState().hydrateSessions([a]);
    useAgentHubStore.getState().renameSession('a', '  新标题  ');
    expect(useAgentHubStore.getState().sessions[0].title).toBe('新标题');
    useAgentHubStore.getState().renameSession('a', '   ');
    expect(useAgentHubStore.getState().sessions[0].title).toBe('新标题');
    const long = 'x'.repeat(100);
    useAgentHubStore.getState().renameSession('a', long);
    expect(useAgentHubStore.getState().sessions[0].title).toHaveLength(60);
  });

  it('deleteSession：删活跃会话 → 激活剩余最新；删尽 → activeId 置空', () => {
    const a = mkSession({ id: 'a' });
    const b = mkSession({ id: 'b' });
    useAgentHubStore.getState().hydrateSessions([a, b], 'b');
    useAgentHubStore.getState().deleteSession('b');
    expect(useAgentHubStore.getState().sessions.map((s) => s.id)).toEqual(['a']);
    expect(useAgentHubStore.getState().activeSessionId).toBe('a');
    useAgentHubStore.getState().deleteSession('a');
    expect(useAgentHubStore.getState().sessions).toEqual([]);
    expect(useAgentHubStore.getState().activeSessionId).toBeNull();
  });

  it(`newSession 超过 SESSIONS_LIMIT（${SESSIONS_LIMIT}）时淘汰最旧非新会话`, () => {
    const seed = Array.from({ length: SESSIONS_LIMIT }, (_, i) => mkSession({ id: `old${i}` }));
    useAgentHubStore.getState().hydrateSessions(seed, 'old0');
    const newId = useAgentHubStore.getState().newSession('host');
    const sessions = useAgentHubStore.getState().sessions;
    expect(sessions).toHaveLength(SESSIONS_LIMIT);
    expect(sessions.some((s) => s.id === newId)).toBe(true);
    expect(sessions.some((s) => s.id === 'old0')).toBe(false); // 最旧被淘汰
  });
});

// ---------------------------------------------------------------------------
// v1.6.0 ③：会话项目隔离（projectName 字段随会话持久化）
// ---------------------------------------------------------------------------

describe('会话项目隔离', () => {
  it('newSession 携带 projectName；序列化/解析往返保留', () => {
    const id = useAgentHubStore.getState().newSession('host', 'demo-paper');
    const s = useAgentHubStore.getState().sessions.find((x) => x.id === id);
    expect(s?.projectName).toBe('demo-paper');
    const snap = serializeSessionsForPersist(useAgentHubStore.getState().sessions);
    const restored = parsePersistedSessions(snap);
    expect(restored[0]?.projectName).toBe('demo-paper');
    // 旧格式（无 projectName）仍可解析
    const legacy = parsePersistedSessions([{ ...mkSession(), projectName: undefined }]);
    expect(legacy[0]?.projectName).toBeUndefined();
  });

  it('坏类型 projectName（数字）被宽容丢弃', () => {
    const bad = { ...mkSession(), projectName: 42 };
    expect(parsePersistedSessions([bad])).toEqual([]);
  });
});
