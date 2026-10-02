/**
 * Agent 会话持久化桥（v1.2.0）：
 *  - hydrateAgentSessions()：启动时从 IndexedDB 恢复会话（宽容校验 + 上限截断）；
 *  - attachAgentSessionPersist()：订阅 store，防抖落盘——流式中的快照不落盘
 *    （每个 delta 都触发订阅，且半截回复没有恢复价值），流结束（finishSession）后
 *    的那次变更才真正写 kv。
 *
 * 存储走 setBigData / getBigData（IndexedDB 优先、写入串行队列、永不抛错打断 UI），
 * 与文献库等大数据同一通道；store 本体（agent-hub 包）保持零存储依赖。
 */

import { useAgentHubStore, parsePersistedSessions, serializeSessionsForPersist } from '@scholarforge/agent-hub';
import { getBigData, setBigData } from '../storage/kvStore';

/** kv 键（版本化：结构不兼容时换 v2 键平滑失效） */
export const AGENT_SESSIONS_KEY = 'sf-agent-sessions-v1';
/** 防抖窗口：连续变更（流式/连点）合并为一次落盘 */
const PERSIST_DEBOUNCE_MS = 600;

interface PersistedShape {
  v: 1;
  activeSessionId: string | null;
  sessions: unknown;
}

/** 启动恢复：无持久数据 / 全部坏记录 → 保持现状（空 store 不覆盖为空） */
export async function hydrateAgentSessions(): Promise<void> {
  const raw = await getBigData<PersistedShape>(AGENT_SESSIONS_KEY);
  if (!raw || typeof raw !== 'object') return;
  const sessions = parsePersistedSessions(raw.sessions);
  if (sessions.length === 0) return;
  useAgentHubStore.getState().hydrateSessions(sessions, raw.activeSessionId ?? null);
}

/**
 * 挂接自动落盘（App 挂载时调用一次，返回卸载函数）：
 * 任一变更后防抖保存；存在流式会话时跳过本次（流结束的 finishSession 会再触发）。
 */
export function attachAgentSessionPersist(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = (): void => {
    const { sessions, activeSessionId } = useAgentHubStore.getState();
    if (sessions.length === 0) return; // 空态不落盘：避免启动早期覆盖既有历史
    if (sessions.some((s) => s.status === 'streaming')) return;
    void setBigData(AGENT_SESSIONS_KEY, {
      v: 1,
      activeSessionId,
      sessions: serializeSessionsForPersist(sessions),
    } satisfies PersistedShape);
  };
  const unsub = useAgentHubStore.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(save, PERSIST_DEBOUNCE_MS);
  });
  return () => {
    unsub();
    clearTimeout(timer);
  };
}
