// @vitest-environment jsdom
/**
 * WF-3 A3：completedRuns —— 完成记录置顶、上限截断、localStorage 持久化与 hydration 安全。
 * 需要 jsdom 提供 localStorage；hydration 用例通过 resetModules + 动态 import 重放模块加载。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPLETED_RUNS_LIMIT,
  COMPLETED_RUNS_STORAGE_KEY,
  useAgentHubStore,
  type CompletedRun,
} from './store';

function makeRun(i: number, outputs: Record<string, string> = {}): CompletedRun {
  return {
    id: `run-${i}`,
    workflowId: 'w6-reviewer-sim',
    workflowName: `三审稿人仿真 #${i}`,
    startedAt: 1000 + i,
    endedAt: 2000 + i,
    outputs,
  };
}

function readStored(): CompletedRun[] {
  const raw = localStorage.getItem(COMPLETED_RUNS_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as CompletedRun[]) : [];
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  useAgentHubStore.setState({ completedRuns: [] });
});

describe('completeRun（历史留存）', () => {
  it('置顶插入并按 id 幂等替换', () => {
    const { completeRun } = useAgentHubStore.getState();
    completeRun(makeRun(1));
    completeRun(makeRun(2));
    expect(useAgentHubStore.getState().completedRuns.map((r) => r.id)).toEqual(['run-2', 'run-1']);

    const revised = { ...makeRun(1), workflowName: '三审稿人仿真（重跑）', outputs: { 'meta-review': 'x' } };
    completeRun(revised);
    const runs = useAgentHubStore.getState().completedRuns;
    expect(runs.map((r) => r.id)).toEqual(['run-1', 'run-2']);
    expect(runs[0]).toMatchObject({ workflowName: '三审稿人仿真（重跑）', outputs: { 'meta-review': 'x' } });
  });

  it('上限 10 条：最老的被挤掉', () => {
    const { completeRun } = useAgentHubStore.getState();
    for (let i = 0; i < COMPLETED_RUNS_LIMIT + 5; i++) completeRun(makeRun(i));
    const runs = useAgentHubStore.getState().completedRuns;
    expect(runs).toHaveLength(COMPLETED_RUNS_LIMIT);
    expect(runs[0]?.id).toBe(`run-${COMPLETED_RUNS_LIMIT + 4}`);
    expect(runs[runs.length - 1]?.id).toBe('run-5');
  });

  it('持久化到 sf-agent-runs，模块重载后可恢复', async () => {
    useAgentHubStore.getState().completeRun(makeRun(1, { 'meta-review': '倾向 accept' }));
    expect(readStored()).toHaveLength(1);

    const reloaded = await import('./store');
    const restored = reloaded.useAgentHubStore.getState().completedRuns;
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({ id: 'run-1', outputs: { 'meta-review': '倾向 accept' } });
  });

  it('clearCompletedRuns 清空内存与持久化副本', async () => {
    useAgentHubStore.getState().completeRun(makeRun(1));
    useAgentHubStore.getState().clearCompletedRuns();
    expect(useAgentHubStore.getState().completedRuns).toEqual([]);
    expect(localStorage.getItem(COMPLETED_RUNS_STORAGE_KEY)).toBe('[]');
  });
});

describe('hydration 安全', () => {
  it('坏 JSON / 非数组 / 字段缺失：不崩溃，回退为空', async () => {
    for (const bad of ['{oops', '"just a string"', '42', 'null']) {
      localStorage.setItem(COMPLETED_RUNS_STORAGE_KEY, bad);
      const { useAgentHubStore: store } = await import('./store');
      expect(store.getState().completedRuns).toEqual([]);
    }
  });

  it('结构不符的条目被逐条丢弃，合法条目保留', async () => {
    localStorage.setItem(
      COMPLETED_RUNS_STORAGE_KEY,
      JSON.stringify([
        makeRun(1),
        { id: 'bad-1', workflowId: 123 }, // workflowId 非字符串
        { id: 'bad-2' }, // 缺字段
        null,
        'junk',
        { ...makeRun(2), outputs: { ok: 'x', bad: 42 } }, // outputs 值非字符串
      ]),
    );
    const { useAgentHubStore: store } = await import('./store');
    expect(store.getState().completedRuns.map((r) => r.id)).toEqual(['run-1']);
  });
});
