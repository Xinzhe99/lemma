/**
 * 阻塞式工具审批桥（设计 5.3 / 5.6 的落地）：
 * agent 调用写级工具（tex.edit / citation.add）时，把 diff 提案推入审批卡，
 * 并以 Promise 阻塞该工具调用，直到用户「采纳 / 放弃」。裁决结果回传给模型继续生成。
 * 会话中止/新请求到来时，未决审批自动按“拒绝”结算，绝不悬空。
 */

import { createId } from '@lemma/shared';
import { useProposalStore, type EditProposal } from './state/proposalStore';

export interface ApprovalDecision {
  approved: boolean;
  note: string;
}

export type ApprovalFn = (proposal: Omit<EditProposal, 'token'>) => Promise<ApprovalDecision>;

interface PendingApproval {
  token: string;
  resolve: (decision: ApprovalDecision) => void;
}

let pending: PendingApproval | null = null;

/** 当前未决审批的 token（UI 高亮“Agent 正在等待”用） */
export function getPendingApprovalToken(): string | null {
  return pending?.token ?? null;
}

/** 请求人工审批：展示 diff 提案并阻塞，直到用户裁决 */
export function requestToolApproval(proposal: Omit<EditProposal, 'token'>): Promise<ApprovalDecision> {
  rejectPendingApproval('被新的审批请求取代');
  const token = createId();
  return new Promise<ApprovalDecision>((resolve) => {
    pending = { token, resolve };
    useProposalStore.getState().setProposal({ ...proposal, token });
  });
}

/** 用户裁决（token 必须匹配当前未决审批）。返回是否结算成功。 */
export function resolveToolApproval(token: string, approved: boolean, note?: string): boolean {
  if (!pending || pending.token !== token) return false;
  const settle = pending;
  pending = null;
  withdrawCard(token);
  settle.resolve({
    approved,
    note: note ?? (approved ? '用户已采纳修改' : '用户拒绝了修改'),
  });
  return true;
}

/** 自动拒绝未决审批（会话中止 / 被新请求取代）。返回是否存在未决审批。 */
export function rejectPendingApproval(note: string): boolean {
  if (!pending) return false;
  const settle = pending;
  pending = null;
  withdrawCard(settle.token);
  settle.resolve({ approved: false, note });
  return true;
}

/**
 * v7.8.0：结算未决审批时撤下它对应的审批卡。此前卡留在面板上（还标着「等待裁决」），
 * 但 token 已失效——用户再点「采纳」只会写盘、回执却传不回任何模型（会话已结束），
 * 界面却提示「已回传给模型」，模型侧收到的却是「已取消」。只撤本次结算的卡，
 * 不碰无 token 的普通提案（润色/起草等）。
 */
function withdrawCard(token: string): void {
  const store = useProposalStore.getState();
  if (store.proposal?.token === token) store.clearProposal();
}
