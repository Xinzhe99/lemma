// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SUBMIT_STORAGE_KEY,
  SUBMISSION_STATUSES,
  deadlineCountdown,
  readPersistedSubmit,
  useSubmitStore,
} from './submitStore';

beforeEach(() => {
  localStorage.clear();
});

describe('submitStore localStorage 持久化', () => {
  it('未持久化时 deadline 为 null', async () => {
    localStorage.clear();
    vi.resetModules();
    const mod = await import('./submitStore');
    expect(mod.useSubmitStore.getState().deadline).toBeNull();
    expect(mod.readPersistedSubmit().deadline).toBeNull();
  });

  it('setDeadline 写入并持久化；置空清除', () => {
    useSubmitStore.getState().setDeadline('2026-12-31');
    expect(useSubmitStore.getState().deadline).toBe('2026-12-31');
    expect(readPersistedSubmit().deadline).toBe('2026-12-31');

    useSubmitStore.getState().setDeadline(null);
    expect(useSubmitStore.getState().deadline).toBeNull();
    expect(readPersistedSubmit().deadline).toBeNull();
  });

  it('重新加载时从 sf-submit 通道恢复 deadline（旧格式缺字段回落 null）', async () => {
    localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify({ venueId: 'acl', lastExportAt: 1, deadline: '2026-10-01' }));
    vi.resetModules();
    const mod = await import('./submitStore');
    expect(mod.useSubmitStore.getState().deadline).toBe('2026-10-01');
    expect(mod.useSubmitStore.getState().venueId).toBe('acl');

    localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify({ venueId: null, lastExportAt: null }));
    vi.resetModules();
    const mod2 = await import('./submitStore');
    expect(mod2.useSubmitStore.getState().deadline).toBeNull();
  });

  it('venue 导出时间等既有字段与 deadline 共存于同一快照', () => {
    useSubmitStore.getState().setVenueId('neurips');
    useSubmitStore.getState().setDeadline('2026-05-20');
    useSubmitStore.getState().markExported();
    const persisted = readPersistedSubmit();
    expect(persisted.venueId).toBe('neurips');
    expect(persisted.deadline).toBe('2026-05-20');
    expect(typeof persisted.lastExportAt).toBe('number');
  });
});

describe('deadlineCountdown 纯函数', () => {
  const now = new Date(2026, 8, 30, 15, 30); // 2026-09-30 15:30（自然日按 09-30 计）

  it('无效字符串返回 null', () => {
    expect(deadlineCountdown('not-a-date', now)).toBeNull();
    expect(deadlineCountdown('', now)).toBeNull();
  });

  it('当天截止：days 0，label 含 ⚠', () => {
    const r = deadlineCountdown('2026-09-30', now);
    expect(r).not.toBeNull();
    expect(r!.days).toBe(0);
    expect(r!.label).toContain('⚠');
  });

  it('1–2 天（<3 天）：days 正数，label 含 ⚠', () => {
    const one = deadlineCountdown('2026-10-01', now);
    expect(one!.days).toBe(1);
    expect(one!.label).toContain('⚠');
    const two = deadlineCountdown('2026-10-02', now);
    expect(two!.days).toBe(2);
    expect(two!.label).toContain('⚠');
  });

  it('3–14 天：正常倒计时，无 ⚠（区间边界 3 与 14）', () => {
    const three = deadlineCountdown('2026-10-03', now);
    expect(three!.days).toBe(3);
    expect(three!.label).not.toContain('⚠');
    const fourteen = deadlineCountdown('2026-10-14', now);
    expect(fourteen!.days).toBe(14);
    expect(fourteen!.label).not.toContain('⚠');
    expect(fourteen!.label).toContain('14');
  });

  it('超过 14 天：剩余天数正确', () => {
    const r = deadlineCountdown('2026-10-31', now);
    expect(r!.days).toBe(31);
    expect(r!.label).not.toContain('⚠');
  });

  it('已过期：days 为负数，label 为「已过期 N 天」', () => {
    const r = deadlineCountdown('2026-09-25', now);
    expect(r!.days).toBe(-5);
    expect(r!.label).toBe('已过期 5 天');
    expect(r!.label).not.toContain('⚠');
  });

  it('跨月/跨年按自然日计算', () => {
    expect(deadlineCountdown('2026-10-01', new Date(2026, 8, 30))!.days).toBe(1);
    expect(deadlineCountdown('2027-01-01', new Date(2026, 11, 31))!.days).toBe(1);
  });

  it('缺省 now 使用当前系统时间（不抛错）', () => {
    const future = new Date();
    future.setDate(future.getDate() + 20);
    const iso = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const r = deadlineCountdown(iso);
    expect(r!.days).toBeGreaterThanOrEqual(19);
  });
});

describe('submitStore 多轮投稿追踪（SubmissionRound）', () => {
  beforeEach(() => {
    useSubmitStore.setState({ venueId: null, lastExportAt: null, deadline: null, rounds: [] });
  });

  it('addRound：追加一轮（id 自动生成、status 默认 submitted、venue/note 去空格）并持久化', () => {
    useSubmitStore.getState().addRound({ venue: ' NeurIPS ', submittedAt: '2026-05-01', note: '  第 2 稿  ' });
    const rounds = useSubmitStore.getState().rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.venue).toBe('NeurIPS');
    expect(rounds[0]!.submittedAt).toBe('2026-05-01');
    expect(rounds[0]!.status).toBe('submitted');
    expect(rounds[0]!.note).toBe('第 2 稿');
    expect(typeof rounds[0]!.id).toBe('string');
    expect(rounds[0]!.id.length).toBeGreaterThan(0);
    expect(readPersistedSubmit().rounds).toEqual(rounds);
  });

  it('addRound：多轮按投出先后追加（最新在末尾）；空 note 落 undefined', () => {
    const { addRound } = useSubmitStore.getState();
    addRound({ venue: 'ACL', submittedAt: '2026-01-10' });
    addRound({ venue: 'EMNLP', submittedAt: '2026-04-02', note: '   ' });
    const rounds = useSubmitStore.getState().rounds;
    expect(rounds.map((r) => r.venue)).toEqual(['ACL', 'EMNLP']);
    expect(rounds[0]!.id).not.toBe(rounds[1]!.id);
    expect(rounds[0]!.note).toBeUndefined();
    expect(rounds[1]!.note).toBeUndefined();
  });

  it('updateRoundStatus：六态可改并持久化；不带 extra 时 respondedAt/note 原样保留', () => {
    useSubmitStore.getState().addRound({ venue: 'ICLR', submittedAt: '2026-02-01', note: '一轮意见 3 条' });
    const id = useSubmitStore.getState().rounds[0]!.id;
    useSubmitStore.getState().updateRoundStatus(id, 'under-review');
    expect(useSubmitStore.getState().rounds[0]!.status).toBe('under-review');
    expect(useSubmitStore.getState().rounds[0]!.note).toBe('一轮意见 3 条');
    expect(readPersistedSubmit().rounds[0]!.status).toBe('under-review');

    for (const status of SUBMISSION_STATUSES) {
      useSubmitStore.getState().updateRoundStatus(id, status);
      expect(useSubmitStore.getState().rounds[0]!.status).toBe(status);
    }
  });

  it('updateRoundStatus：extra 可一并写 respondedAt 与 note（显式覆盖）', () => {
    useSubmitStore.getState().addRound({ venue: 'AAAI', submittedAt: '2026-03-01' });
    const id = useSubmitStore.getState().rounds[0]!.id;
    useSubmitStore.getState().updateRoundStatus(id, 'major-revision', {
      respondedAt: '2026-06-15',
      note: '大修：补实验',
    });
    const r = useSubmitStore.getState().rounds[0]!;
    expect(r.status).toBe('major-revision');
    expect(r.respondedAt).toBe('2026-06-15');
    expect(r.note).toBe('大修：补实验');
    expect(readPersistedSubmit().rounds[0]!.respondedAt).toBe('2026-06-15');
  });

  it('updateRoundStatus / removeRound：对不存在的 id 无副作用、不抛错', () => {
    useSubmitStore.getState().addRound({ venue: 'CVPR', submittedAt: '2026-03-05' });
    const before = useSubmitStore.getState().rounds;
    expect(() => useSubmitStore.getState().updateRoundStatus('ghost', 'accepted')).not.toThrow();
    expect(() => useSubmitStore.getState().removeRound('ghost')).not.toThrow();
    expect(useSubmitStore.getState().rounds).toEqual(before);
  });

  it('removeRound：删除指定轮并持久化（其余轮不受影响）', () => {
    const { addRound } = useSubmitStore.getState();
    addRound({ venue: 'ACL', submittedAt: '2026-01-10' });
    addRound({ venue: 'EMNLP', submittedAt: '2026-04-02' });
    const [first] = useSubmitStore.getState().rounds;
    useSubmitStore.getState().removeRound(first!.id);
    const rounds = useSubmitStore.getState().rounds;
    expect(rounds.map((r) => r.venue)).toEqual(['EMNLP']);
    expect(readPersistedSubmit().rounds.map((r) => r.venue)).toEqual(['EMNLP']);
  });

  it('持久化往返：重新加载从 sf-submit 通道恢复 rounds（六态字段完整）', async () => {
    useSubmitStore.getState().addRound({ venue: 'NeurIPS', submittedAt: '2026-05-01' });
    const id = useSubmitStore.getState().rounds[0]!.id;
    useSubmitStore.getState().updateRoundStatus(id, 'minor-revision', { respondedAt: '2026-07-20' });
    vi.resetModules();
    const mod = await import('./submitStore');
    const restored = mod.useSubmitStore.getState().rounds;
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      id,
      venue: 'NeurIPS',
      submittedAt: '2026-05-01',
      status: 'minor-revision',
      respondedAt: '2026-07-20',
    });
  });

  it('坏数据回退：rounds 非数组回落 []；数组内坏条目丢弃、好条目保留', async () => {
    localStorage.setItem(SUBMIT_STORAGE_KEY, JSON.stringify({ venueId: 'acl', rounds: 'nope' }));
    vi.resetModules();
    const mod1 = await import('./submitStore');
    expect(mod1.useSubmitStore.getState().rounds).toEqual([]);

    localStorage.setItem(
      SUBMIT_STORAGE_KEY,
      JSON.stringify({
        venueId: 'acl',
        rounds: [
          { id: 'ok-1', venue: 'ACL', submittedAt: '2026-01-10', status: 'rejected' }, // 合法
          { venue: '无 id', submittedAt: '2026-01-11', status: 'submitted' }, // 缺 id
          { id: 'no-venue', submittedAt: '2026-01-12', status: 'submitted' }, // 缺 venue
          { id: 'no-date', venue: 'ICML', status: 'submitted' }, // 缺 submittedAt
          { id: 'bad-status', venue: 'ICML', submittedAt: '2026-01-13', status: 'accepted-with-honor' }, // 非法状态
          'not-an-object', // 非对象
          null, // null
        ],
      }),
    );
    vi.resetModules();
    const mod2 = await import('./submitStore');
    const rounds = mod2.useSubmitStore.getState().rounds;
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.id).toBe('ok-1');
    expect(rounds[0]!.status).toBe('rejected');
    // 既有字段照常恢复，不受坏 rounds 影响
    expect(mod2.useSubmitStore.getState().venueId).toBe('acl');
  });

  it('rounds 与 venue/deadline/导出时间共存于同一 sf-submit 快照', () => {
    const s = useSubmitStore.getState();
    s.setVenueId('neurips');
    s.setDeadline('2026-05-20');
    s.markExported();
    s.addRound({ venue: 'NeurIPS', submittedAt: '2026-05-01' });
    const persisted = readPersistedSubmit();
    expect(persisted.venueId).toBe('neurips');
    expect(persisted.deadline).toBe('2026-05-20');
    expect(typeof persisted.lastExportAt).toBe('number');
    expect(persisted.rounds).toHaveLength(1);
    expect(persisted.rounds[0]!.venue).toBe('NeurIPS');
  });
});
