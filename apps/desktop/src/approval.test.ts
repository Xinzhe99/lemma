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
});
