import { describe, expect, it } from 'vitest';
import {
  getPendingApprovalToken,
  rejectPendingApproval,
  requestToolApproval,
  resolveToolApproval,
} from './approval';
import { useProposalStore } from './state/proposalStore';

function sampleProposal() {
  return {
    file: 'main.tex',
    before: 'old text',
    after: 'new text',
    kind: 'tool-edit' as const,
    label: 'AI 修改稿件（tex.edit）',
    via: 'test',
  };
}

describe('阻塞式审批桥', () => {
  it('采纳：resolve(true) 后 Promise 得到 approved 决议，提案入 store', async () => {
    const p = requestToolApproval(sampleProposal());
    const token = getPendingApprovalToken();
    expect(token).toBeTruthy();
    expect(useProposalStore.getState().proposal?.before).toBe('old text');

    expect(resolveToolApproval(token!, true)).toBe(true);
    const decision = await p;
    expect(decision.approved).toBe(true);
    expect(decision.note).toContain('采纳');
    expect(getPendingApprovalToken()).toBeNull();
  });

  it('拒绝：resolve(false) 回传拒绝原因', async () => {
    const p = requestToolApproval(sampleProposal());
    const token = getPendingApprovalToken()!;
    resolveToolApproval(token, false);
    const decision = await p;
    expect(decision.approved).toBe(false);
    expect(decision.note).toContain('拒绝');
  });

  it('token 不匹配的裁决被忽略（不会误结算）', async () => {
    const p = requestToolApproval(sampleProposal());
    expect(resolveToolApproval('wrong-token', true)).toBe(false);
    expect(getPendingApprovalToken()).not.toBeNull();
    resolveToolApproval(getPendingApprovalToken()!, true);
    expect((await p).approved).toBe(true);
  });

  it('新请求会自动拒绝上一个未决审批', async () => {
    const p1 = requestToolApproval(sampleProposal());
    const p2 = requestToolApproval({ ...sampleProposal(), after: 'another' });
    const d1 = await p1;
    expect(d1.approved).toBe(false);
    expect(d1.note).toContain('取代');
    resolveToolApproval(getPendingApprovalToken()!, true);
    expect((await p2).approved).toBe(true);
  });

  it('rejectPendingApproval 兜底（会话中止场景）', async () => {
    const p = requestToolApproval(sampleProposal());
    expect(rejectPendingApproval('会话已中止')).toBe(true);
    expect((await p).note).toBe('会话已中止');
    expect(rejectPendingApproval('x')).toBe(false);
  });

  // v7.8.0 审计回归：结算后审批卡不能留在面板上「点了也没用」
  it('自动拒绝（会话中止）时撤下审批卡，不留失效的悬空卡', async () => {
    const p = requestToolApproval(sampleProposal());
    const token = getPendingApprovalToken()!;
    expect(useProposalStore.getState().proposal?.token).toBe(token);
    rejectPendingApproval('会话已中止或结束，本次修改未生效');
    await p;
    expect(useProposalStore.getState().proposal).toBeNull();
  });

  it('裁决后撤卡；只撤本次结算的卡，无 token 的普通提案不受影响', async () => {
    const p = requestToolApproval(sampleProposal());
    const token = getPendingApprovalToken()!;
    // 结算前用户又触发了另一张（非 agent）提案卡
    useProposalStore.getState().setProposal({
      file: 'main.tex',
      before: 'a',
      after: 'b',
      kind: 'polish',
      label: 'AI 润色',
      via: '规则润色（离线）',
    });
    resolveToolApproval(token, true);
    await p;
    expect(useProposalStore.getState().proposal?.label).toBe('AI 润色'); // 未被误清

    const p2 = requestToolApproval(sampleProposal());
    useProposalStore.getState().setProposal({ ...sampleProposal(), label: '本次', token: getPendingApprovalToken()! });
    resolveToolApproval(getPendingApprovalToken()!, false);
    await p2;
    expect(useProposalStore.getState().proposal).toBeNull(); // 本次的卡已撤下
  });
});
