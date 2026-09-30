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

interface AgentHubState {
  sessions: AgentSession[];
  activeSessionId: string | null;
  runs: AgentRun[];

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
}));
