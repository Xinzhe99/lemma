let hydrated = false;

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

import { useAgentHubStore, parsePersistedSessions, serializeSessionsForPersist } from '@lemma/agent-hub';
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
  // 空数组不动现状（无论是否已水合——防旧覆盖新）；删除的持久化由 save 侧落盘
  if (sessions.length === 0) return;
  useAgentHubStore.getState().hydrateSessions(sessions, raw.activeSessionId ?? null);
  hydrated = true;
}

/**
 * 挂接自动落盘（App 挂载时调用一次，返回卸载函数）：
 * 任一变更后防抖保存；存在流式会话时跳过本次（流结束的 finishSession 会再触发）。
 */
export function attachAgentSessionPersist(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const save = (): void => {
    const { sessions, activeSessionId } = useAgentHubStore.getState();
    // v7.0.0 修复：空态在 hydrate 完成后也要落盘——此前永不落空，
    // 用户删光会话后重启全部复活；启动早期（未水合）仍防覆盖
    if (sessions.length === 0 && !hydrated) return;
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

/** 测试辅助：重置水合标志（跨用例隔离） */
export function __resetSessionPersistForTests(): void {
  hydrated = false;
}
