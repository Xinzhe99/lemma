/**
 * Provider 统一对话接口（L2 Agent 接入层）。
 * 无论 OpenAI 兼容 API、本地 CLI agent 还是 MCP，都被拉平为同一套流式事件协议。
 */
import type { AgentMessage, ToolCallRequest, ToolDef } from '@scholarforge/shared';

export interface ChatRequest {
  messages: AgentMessage[];
  /** 本次对话暴露给模型的工具；缺省 = 纯文本对话 */
  tools?: ToolDef[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface ChatUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export type ChatEvent =
  | { type: 'text-delta'; delta: string }
  | { type: 'tool-call'; call: ToolCallRequest }
  | { type: 'done'; usage?: ChatUsage }
  | { type: 'error'; message: string };

/** 所有模型/agent 后端的统一适配器 */
export interface ChatProvider {
  readonly id: string;
  readonly label: string;
  complete(req: ChatRequest): AsyncIterable<ChatEvent>;
}
