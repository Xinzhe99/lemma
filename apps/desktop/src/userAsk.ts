/**
 * 结构化提问桥（v7.5.0，对齐 agent-foundation UserInteractionCapability /
 * ask_user_question）：AI 在任务中途遇到必须由人拍板的分叉时，经 user.ask
 * 工具弹出一道选项式提问卡，Promise 阻塞该工具调用直到用户作答；答案回传
 * 模型继续生成。与 approval.ts 同一模式：会话中止/被新问题取代时自动结算，
 * 绝不悬空。
 */
import { create } from 'zustand';
import { createId } from '@lemma/shared';

export interface AskOption {
  label: string;
  description?: string;
}

export interface PendingAsk {
  token: string;
  question: string;
  options: AskOption[];
  allowCustom: boolean;
}

interface UserAskState {
  pending: PendingAsk | null;
  setPending: (p: PendingAsk | null) => void;
}

export const useUserAskStore = create<UserAskState>((set) => ({
  pending: null,
  setPending: (pending) => set({ pending }),
}));

let resolver: ((answer: string | null) => void) | null = null;

/** 发起提问并阻塞；resolve 为用户答案，null = 未作答（中止/被取代） */
export function requestUserAnswer(question: string, options: AskOption[], allowCustom = true): Promise<string | null> {
  rejectPendingUserAnswer();
  const token = createId();
  return new Promise<string | null>((resolve) => {
    resolver = resolve;
    useUserAskStore.getState().setPending({ token, question, options, allowCustom });
  });
}

/** 用户作答（token 必须匹配当前未决提问）。返回是否结算成功。 */
export function resolveUserAnswer(token: string, answer: string): boolean {
  const p = useUserAskStore.getState().pending;
  if (!p || p.token !== token || !resolver) return false;
  const settle = resolver;
  resolver = null;
  useUserAskStore.getState().setPending(null);
  settle(answer);
  return true;
}

/** 自动作废未决提问（会话中止 / 被新提问取代）。返回是否存在。 */
export function rejectPendingUserAnswer(): boolean {
  if (!resolver) return false;
  const settle = resolver;
  resolver = null;
  useUserAskStore.getState().setPending(null);
  settle(null);
  return true;
}
