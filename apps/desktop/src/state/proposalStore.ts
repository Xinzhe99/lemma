/**
 * AI 修改提案状态：Agent 面板产出 diff 提案 → 用户审批 → 采纳时由
 * workspaceStore 先快照再写入（设计 5.6：一切 AI 修改皆 diff、可回滚）。
 */

import { create } from 'zustand';

export type ProposalKind = 'polish' | 'draft-section';

export interface EditProposal {
  file: string;
  before: string;
  after: string;
  kind: ProposalKind;
  label: string;
  /** 产生方式：模型名或「规则润色（离线）」 */
  via: string;
}

interface ProposalState {
  proposal: EditProposal | null;
  /** 面板反馈信息（成功/提示） */
  note: string | null;
  setProposal(proposal: EditProposal): void;
  clearProposal(): void;
  setNote(note: string | null): void;
}

export const useProposalStore = create<ProposalState>((set) => ({
  proposal: null,
  note: null,
  setProposal: (proposal) => set({ proposal, note: null }),
  clearProposal: () => set({ proposal: null }),
  setNote: (note) => set({ note }),
}));
