/**
 * Agent 中枢 UI 状态（zustand）。
 *
 * 重要：store 只管状态，不做网络发送。
 * 宿主（apps/desktop）订阅本 store：sendMessage 触发后由宿主驱动 ChatProvider，
 * 把流式事件通过 appendDelta / appendToolCall / finishSession 写回。
 */
import { create } from 'zustand';
import { createId, type AgentMessage, type AgentRun, type ToolCallRequest } from '@scholarforge/shared';

export type AgentSessionStatus = 'idle' | 'streaming' | 'error';

export interface AgentSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  providerId: string;
  status: AgentSessionStatus;
}

/** 已完成工作流的留存记录（WF-3 A3）：刷新页面后可从历史恢复查看产物 */
export interface CompletedRun {
  id: string;
  workflowId: string;
  workflowName: string;
  startedAt: number;
  endedAt: number;
  /** stepId → 步骤最终输出（markdown 文本） */
  outputs: Record<string, string>;
}

/** localStorage 持久化 key（sf-agent-runs） */
export const COMPLETED_RUNS_STORAGE_KEY = 'sf-agent-runs';
/** 历史上限：最多保留 10 条（新的在前） */
export const COMPLETED_RUNS_LIMIT = 10;

/** 宽容校验单条持久化记录：字段类型不符时丢弃，避免脏数据进入 store */
function isCompletedRun(v: unknown): v is CompletedRun {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.workflowId === 'string' &&
    typeof o.workflowName === 'string' &&
    typeof o.startedAt === 'number' &&
    typeof o.endedAt === 'number' &&
    typeof o.outputs === 'object' &&
    o.outputs !== null &&
    Object.values(o.outputs).every((x) => typeof x === 'string')
  );
}

/** 从 localStorage 安全恢复（解析失败 / 结构不符 / 环境无 localStorage 均回退为空） */
function loadCompletedRuns(): CompletedRun[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(COMPLETED_RUNS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isCompletedRun).slice(0, COMPLETED_RUNS_LIMIT);
  } catch {
    return [];
  }
}

function persistCompletedRuns(runs: CompletedRun[]): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(COMPLETED_RUNS_STORAGE_KEY, JSON.stringify(runs));
    }
  } catch {
    /* 持久化失败不打断 UI（如隐私模式/配额满） */
  }
}

interface AgentHubState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  runs: AgentRun[];
  /** 最近完成的工作流（新的在前，上限 COMPLETED_RUNS_LIMIT，localStorage 持久化） */
  completedRuns: CompletedRun[];

  /** 新建会话并激活，返回会话 id */
  newSession(providerId: string): string;
  setActiveSession(sessionId: string): void;
  /** 乐观插入 user 消息 + assistant 占位（状态置为 streaming），等待宿主回填 */
  sendMessage(sessionId: string, text: string): void;
  appendDelta(sessionId: string, text: string): void;
  appendToolCall(sessionId: string, call: ToolCallRequest): void;
  /** 回填工具执行结果（role=tool，携带 toolCallId 供 UI 折叠展示与协议续传） */
  appendToolResult(sessionId: string, callId: string, content: string): void;
  finishSession(sessionId: string, status: AgentSessionStatus): void;
  /** upsert 一条 AgentRun（按 id 替换或置顶插入） */
  updateRun(run: AgentRun): void;
  /** 记录一条已完成的工作流 run（置顶、截断到上限并持久化） */
  completeRun(run: CompletedRun): void;
  /** 清空历史（含持久化副本） */
  clearCompletedRuns(): void;
}

function patchSession(
  sessions: AgentSession[],
  sessionId: string,
  patch: (s: AgentSession) => AgentSession,
): AgentSession[] {
  return sessions.map((s) => (s.id === sessionId ? patch(s) : s));
}

export const useAgentHubStore = create<AgentHubState>((set) => ({
  sessions: [],
  activeSessionId: null,
  runs: [],
  completedRuns: loadCompletedRuns(),

  newSession: (providerId) => {
    const id = createId();
    set((state) => ({
      sessions: [
        ...state.sessions,
        { id, title: '新会话', messages: [], providerId, status: 'idle' },
      ],
      activeSessionId: id,
    }));
    return id;
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  sendMessage: (sessionId, text) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => {
        const now = Date.now();
        const isFirstUserMessage = !s.messages.some((m) => m.role === 'user');
        return {
          ...s,
          title: isFirstUserMessage && text.trim() ? text.trim().slice(0, 24) : s.title,
          status: 'streaming',
          messages: [
            ...s.messages,
            { id: createId(), role: 'user', content: text, createdAt: now },
            { id: createId(), role: 'assistant', content: '', createdAt: now + 1 },
          ],
        };
      }),
    })),

  appendDelta: (sessionId, text) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => {
        const messages = [...s.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            messages[i] = { ...messages[i], content: messages[i].content + text };
            return { ...s, messages };
          }
          break; // 最后一条不是 assistant：不再向前寻找，避免污染历史消息
        }
        return {
          ...s,
          messages: [...messages, { id: createId(), role: 'assistant', content: text, createdAt: Date.now() }],
        };
      }),
    })),

  appendToolCall: (sessionId, call) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => {
        const messages = [...s.messages];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'assistant') {
            messages[i] = { ...messages[i], toolCalls: [...(messages[i].toolCalls ?? []), call] };
            return { ...s, messages };
          }
          break;
        }
        return {
          ...s,
          messages: [
            ...messages,
            { id: createId(), role: 'assistant', content: '', toolCalls: [call], createdAt: Date.now() },
          ],
        };
      }),
    })),

  appendToolResult: (sessionId, callId, content) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => ({
        ...s,
        messages: [
          ...s.messages,
          {
            id: createId(),
            role: 'tool' as const,
            toolCallId: callId,
            content,
            createdAt: Date.now(),
          },
        ],
      })),
    })),

  finishSession: (sessionId, status) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => ({ ...s, status })),
    })),

  updateRun: (run) =>
    set((state) => {
      const idx = state.runs.findIndex((r) => r.id === run.id);
      const runs = [...state.runs];
      if (idx >= 0) runs[idx] = run;
      else runs.unshift(run);
      return { runs };
    }),

  completeRun: (run) =>
    set((state) => {
      // 同 id 幂等：替换旧记录而非重复置顶
      const rest = state.completedRuns.filter((r) => r.id !== run.id);
      const completedRuns = [run, ...rest].slice(0, COMPLETED_RUNS_LIMIT);
      persistCompletedRuns(completedRuns);
      return { completedRuns };
    }),

  clearCompletedRuns: () => {
    persistCompletedRuns([]);
    set({ completedRuns: [] });
  },
}));
