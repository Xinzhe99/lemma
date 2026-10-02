// @vitest-environment jsdom
/**
 * Agent 会话持久化桥测试（v1.2.0 ①）：
 * - hydrateAgentSessions：kv 有数据 → 水合进 store（含 activeId）；无/坏数据 → 不动现状；
 * - attachAgentSessionPersist：变更后防抖落盘；流式会话跳过、finishSession 后落盘；
 *   空态不落盘（启动早期不覆盖既有历史）。
 * kv 走 storage/db 的内存降级实现（jsdom 无 indexedDB），真实链路同一接口契约。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentHubStore, type AgentSession } from '@scholarforge/agent-hub';
import { AGENT_SESSIONS_KEY, hydrateAgentSessions, attachAgentSessionPersist } from './agentSessionPersist';
import { getBigData, setBigData, __resetKvStoreForTests } from '../storage/kvStore';
import { __resetStorageForTests } from '../storage/db';

function resetStore(): void {
  useAgentHubStore.setState({ sessions: [], activeSessionId: null });
}

function mkSession(id: string, over: Partial<AgentSession> = {}): AgentSession {
  return {
    id,
    title: over.title ?? `会话 ${id}`,
    providerId: 'host',
    status: over.status ?? 'idle',
    messages: over.messages ?? [
      { id: `${id}-u`, role: 'user', content: '问', createdAt: 1 },
      { id: `${id}-a`, role: 'assistant', content: '答', createdAt: 2 },
    ],
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetKvStoreForTests();
  __resetStorageForTests(); // 内存后端 Map 同样清空（跨用例隔离）
  resetStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hydrateAgentSessions', () => {
  it('kv 有有效数据 → 水合并恢复 activeId', async () => {
    const a = mkSession('a');
    const b = mkSession('b');
    await setBigData(AGENT_SESSIONS_KEY, { v: 1, activeSessionId: 'b', sessions: [a, b] });
    await hydrateAgentSessions();
    const st = useAgentHubStore.getState();
    expect(st.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(st.activeSessionId).toBe('b');
  });

  it('无数据 / 坏结构 / 空会话数组 → 不动现状', async () => {
    useAgentHubStore.getState().newSession('host');
    await hydrateAgentSessions(); // kv 无该键
    await setBigData(AGENT_SESSIONS_KEY, 'garbage');
    await hydrateAgentSessions();
    await setBigData(AGENT_SESSIONS_KEY, { v: 1, activeSessionId: null, sessions: [] });
    await hydrateAgentSessions();
    expect(useAgentHubStore.getState().sessions).toHaveLength(1);
  });

  it('持久化时 streaming 快照 → 恢复为 error（中断流不假装存活）', async () => {
    await setBigData(AGENT_SESSIONS_KEY, {
      v: 1,
      activeSessionId: 's',
      sessions: [mkSession('s', { status: 'streaming' })],
    });
    await hydrateAgentSessions();
    expect(useAgentHubStore.getState().sessions[0].status).toBe('error');
  });
});

describe('attachAgentSessionPersist（防抖落盘）', () => {
  it('renameSession 触发防抖落盘；窗口内多次变更合并', async () => {
    useAgentHubStore.getState().hydrateSessions([mkSession('a')]);
    const detach = attachAgentSessionPersist();
    try {
      useAgentHubStore.getState().renameSession('a', '新标题一');
      useAgentHubStore.getState().renameSession('a', '新标题二'); // 窗口内合并
      await vi.advanceTimersByTimeAsync(700);
      const saved = await getBigData<{ sessions: { id: string; title: string }[] }>(AGENT_SESSIONS_KEY);
      expect(saved?.sessions[0].title).toBe('新标题二');
    } finally {
      detach();
    }
  });

  it('流式会话不落盘；finishSession(idle) 后的变更落盘', async () => {
    const id = useAgentHubStore.getState().newSession('host');
    useAgentHubStore.getState().sendMessage(id, '你好');
    const detach = attachAgentSessionPersist();
    try {
      useAgentHubStore.getState().appendDelta(id, '回复中');
      await vi.advanceTimersByTimeAsync(700);
      expect(await getBigData(AGENT_SESSIONS_KEY)).toBeUndefined(); // streaming 全程不落盘
      useAgentHubStore.getState().finishSession(id, 'idle');
      await vi.advanceTimersByTimeAsync(700);
      const saved = await getBigData<{ sessions: AgentSession[] }>(AGENT_SESSIONS_KEY);
      expect(saved?.sessions[0].messages[1].content).toBe('回复中');
    } finally {
      detach();
    }
  });

  it('空会话态不落盘（启动早期不覆盖既有历史）', async () => {
    const detach = attachAgentSessionPersist();
    try {
      useAgentHubStore.setState({ sessions: [], activeSessionId: null });
      await vi.advanceTimersByTimeAsync(700);
      expect(await getBigData(AGENT_SESSIONS_KEY)).toBeUndefined();
    } finally {
      detach();
    }
  });

  it('卸载函数停止落盘', async () => {
    useAgentHubStore.getState().hydrateSessions([mkSession('a')]);
    const detach = attachAgentSessionPersist();
    detach();
    useAgentHubStore.getState().renameSession('a', '改名');
    await vi.advanceTimersByTimeAsync(700);
    expect(await getBigData(AGENT_SESSIONS_KEY)).toBeUndefined();
  });
});
