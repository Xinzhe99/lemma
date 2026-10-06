/**
 * Agent 中枢 UI 状态（zustand）。
 *
 * 重要：store 只管状态，不做网络发送。
 * 宿主（apps/desktop）订阅本 store：sendMessage 触发后由宿主驱动 ChatProvider，
 * 把流式事件通过 appendDelta / appendToolCall / finishSession 写回。
 */
import { create } from 'zustand';
import { createId, type AgentMessage, type AgentRun, type ToolCallRequest } from '@lemma/shared';

export type AgentSessionStatus = 'idle' | 'streaming' | 'error';

export interface AgentSession {
  id: string;
  title: string;
  messages: AgentMessage[];
  providerId: string;
  status: AgentSessionStatus;
  /** 归属项目名（v1.6.0 ③：多项目会话隔离；旧会话无此字段 = 「全部」可见） */
  projectName?: string;
  /** 会话产物（v5.9.0，Codex 式）：AI 在本会话创建/修改过的文件清单（含时间与方式） */
  artifacts?: SessionArtifact[];
}

/** 一条会话产物记录：file 为项目内相对路径 */
export interface SessionArtifact {
  file: string;
  /** edit = 修改既有文件；create = 新建 */
  kind: 'edit' | 'create';
  at: number;
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
  newSession(providerId: string, projectName?: string): string;
  setActiveSession(sessionId: string): void;
  /** 水合（宿主启动时从持久层恢复）：整体替换并截断到上限；activeId 不在列表时回落首个 */
  hydrateSessions(sessions: AgentSession[], activeSessionId?: string | null): void;
  /** 重命名会话标题 */
  renameSession(sessionId: string, title: string): void;
  /** v5.9.0：记录会话产物（同一文件重复改动只保留最新一条） */
  recordArtifact(sessionId: string, file: string, kind: 'edit' | 'create'): void;
  /** 删除会话；删的是活跃会话时激活剩余最新一条（无剩余则置空） */
  deleteSession(sessionId: string): void;
  /** 乐观插入 user 消息 + assistant 占位（状态置为 streaming），等待宿主回填 */
  sendMessage(sessionId: string, text: string, images?: string[]): void;
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

// ---------------------------------------------------------------------------
// 会话持久化（v1.2.0）：纯函数层 —— 宿主负责落盘（IndexedDB），本包不依赖存储实现
// ---------------------------------------------------------------------------

/** 会话保留上限（新的在后；超出时从最旧的非活跃会话开始淘汰） */
export const SESSIONS_LIMIT = 30;

/**
 * 持久化前的安全化快照：流式中的会话落盘为 idle（中断的流重启后不假装还在流），
 * 深拷贝消息数组（落盘方可能异步持有该快照，避免与后续内存变更共享引用）。
 */
export function serializeSessionsForPersist(sessions: AgentSession[]): AgentSession[] {
  return sessions.map((s) => ({
    ...s,
    status: s.status === 'streaming' ? ('idle' as const) : s.status,
    // images（dataUrl）只留内存：持久化剥离防兆级膨胀；content 里的「[图片 ×N]」标记保留语义
    messages: s.messages.map((m) => {
      const { images: _images, ...rest } = m;
      return { ...rest };
    }),
  }));
}

function isAgentMessage(v: unknown): v is AgentMessage {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    (o.role === 'user' || o.role === 'assistant' || o.role === 'system' || o.role === 'tool') &&
    typeof o.content === 'string' &&
    typeof o.createdAt === 'number'
  );
}

function isAgentSession(v: unknown): v is AgentSession {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.title === 'string' &&
    Array.isArray(o.messages) &&
    o.messages.every(isAgentMessage) &&
    typeof o.providerId === 'string' &&
    (o.status === 'idle' || o.status === 'streaming' || o.status === 'error') &&
    (o.projectName === undefined || typeof o.projectName === 'string')
  );
}

/** 水合校验（宽容）：坏记录丢弃，恢复时 streaming 视为 error（流被重启打断），截断到上限 */
export function parsePersistedSessions(raw: unknown): AgentSession[] {
  const list = Array.isArray(raw) ? raw.filter(isAgentSession) : [];
  return list
    .slice(-SESSIONS_LIMIT)
    .map((s) => ({ ...s, status: s.status === 'streaming' ? ('error' as const) : s.status }));
}

export const useAgentHubStore = create<AgentHubState>((set) => ({
  sessions: [],
  activeSessionId: null,
  runs: [],
  completedRuns: loadCompletedRuns(),

  newSession: (providerId, projectName) => {
    const id = createId();
    set((state) => {
      let sessions = [
        ...state.sessions,
        { id, title: '新会话', messages: [], providerId, status: 'idle' as const, projectName },
      ];
      // 上限淘汰：从最旧开始移除非本会话/非流式中的记录
      // v7.0.0 修复：此前只保护新会话 id——正在流式的旧会话被淘汰后，
      // 后续 appendDelta/finishSession 全部静默 no-op，整条回复蒸发并被持久化固化
      while (sessions.length > SESSIONS_LIMIT) {
        const idx = sessions.findIndex((s) => s.id !== id && s.status !== 'streaming');
        if (idx < 0) break;
        sessions = sessions.filter((_, i) => i !== idx);
      }
      return { sessions, activeSessionId: id };
    });
    return id;
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  hydrateSessions: (sessions, activeSessionId) =>
    set(() => {
      const list = sessions.slice(-SESSIONS_LIMIT);
      const active =
        activeSessionId && list.some((s) => s.id === activeSessionId) ? activeSessionId : (list[0]?.id ?? null);
      return { sessions: list, activeSessionId: active };
    }),

  recordArtifact: (sessionId, file, kind) =>
    set((state) => ({
      sessions: state.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        const rest = (s.artifacts ?? []).filter((a) => a.file !== file);
        return { ...s, artifacts: [...rest, { file, kind, at: Date.now() }] };
      }),
    })),

  renameSession: (sessionId, title) =>
    set((state) => ({
      sessions: patchSession(state.sessions, sessionId, (s) => ({
        ...s,
        title: title.trim() ? title.trim().slice(0, 60) : s.title,
      })),
    })),

  deleteSession: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== sessionId);
      const activeSessionId =
        state.activeSessionId === sessionId
          ? (sessions[sessions.length - 1]?.id ?? null)
          : state.activeSessionId;
      return { sessions, activeSessionId };
    }),

  sendMessage: (sessionId, text, images) =>
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
            {
              id: createId(),
              role: 'user',
              content: text,
              ...(images && images.length > 0 ? { images } : {}),
              createdAt: now,
            },
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
