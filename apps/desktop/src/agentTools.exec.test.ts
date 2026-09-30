import { describe, expect, it, beforeEach } from 'vitest';
import type { ChatEvent, ChatProvider, ChatRequest } from '@scholarforge/agent-hub';
import type { ToolCallRequest } from '@scholarforge/shared';
import { useWorkspaceStore } from './state/workspaceStore';
import { createAppToolExecutor, runAgentTurn, ENABLED_TOOLS } from './agentTools';
import type { ApprovalDecision } from './approval';

function resetWorkspace() {
  useWorkspaceStore.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: { 'main.tex': 'In order to test, we utilize data.', 'refs.bib': '@article{a, title={A}, year={2020}}' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}

const approveNow: (decision: ApprovalDecision) => (p: unknown) => Promise<ApprovalDecision> =
  (decision) => async () => decision;

describe('createAppToolExecutor 写级工具', () => {
  beforeEach(resetWorkspace);

  it('tex.edit + 采纳：find/replace 生效并自动快照', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'c1',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { applied: boolean };
    expect(result.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
  });

  it('tex.edit + 拒绝：文件不变，回传拒绝原因', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: false, note: '不要改' }));
    const result = (await executor.execute({
      id: 'c2',
      tool: 'tex.edit',
      args: { file: 'main.tex', content: 'replaced' },
    })) as { applied: boolean; reason: string };
    expect(result.applied).toBe(false);
    expect(result.reason).toBe('不要改');
    expect(useWorkspaceStore.getState().files['main.tex']).toContain('utilize');
  });

  it('tex.edit find 未命中：结构化失败；空参数被 schema 拦截抛错', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const miss = (await executor.execute({ id: 'c3', tool: 'tex.edit', args: { file: 'main.tex', find: '不存在', replace: 'x' } })) as { applied: boolean; reason: string };
    expect(miss.applied).toBe(false);
    expect(miss.reason).toContain('未命中');
    // file 为必填：空参数在注册表校验层直接抛错（runAgentTurn 会捕获并回传 error）
    await expect(executor.execute({ id: 'c4', tool: 'tex.edit', args: {} })).rejects.toThrow('参数校验失败');
  });

  it('tex.edit diff 模式：unified diff 应用并快照', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'c1b',
      tool: 'tex.edit',
      args: {
        file: 'main.tex',
        diff: ['@@ -1,1 +1,1 @@', '-In order to test, we utilize data.', '+In order to test, we use data.'].join('\n'),
      },
    })) as { applied: boolean };
    expect(result.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
  });

  it('tex.edit diff 不匹配：结构化失败，不动文件', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'c1c',
      tool: 'tex.edit',
      args: { file: 'main.tex', diff: '@@ -1,1 +1,1 @@\n-wrong\n+new' },
    })) as { applied: boolean; reason: string };
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('diff 应用失败');
    expect(useWorkspaceStore.getState().files['main.tex']).toContain('utilize');
  });

  it('citation.add + 采纳：entry 对象协议，条目追加到 refs.bib', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'c5',
      tool: 'citation.add',
      args: {
        entry: { citekey: 'demo2024', title: 'Demo Paper', authors: ['Zhang, Wei', 'Li, Lei'], year: 2024 },
      },
    })) as { applied: boolean; file: string };
    expect(result.applied).toBe(true);
    const bib = useWorkspaceStore.getState().files['refs.bib'] ?? '';
    expect(bib).toContain('@misc{demo2024,');
    expect(bib).toContain('title = {Demo Paper}');
    expect(bib).toContain('Zhang, Wei and Li, Lei');
    expect(bib).toContain('@article{a,');
  });

  it('snapshot.create：默认对当前文件建快照', async () => {
    const executor = createAppToolExecutor();
    const result = (await executor.execute({ id: 'c6', tool: 'snapshot.create', args: { label: '前置快照' } })) as { created: boolean; file: string };
    expect(result.created).toBe(true);
    expect(result.file).toBe('main.tex');
    expect(useWorkspaceStore.getState().snapshots['main.tex']![0]!.label).toBe('前置快照');
  });
});

/** 脚本化假 provider：第一轮发一个 tool-call，第二轮输出最终文本 */
function scriptedProvider(script: ChatEvent[][]): ChatProvider {
  let call = 0;
  return {
    id: 'scripted',
    label: 'scripted',
    async *complete(_req: ChatRequest) {
      const events = script[Math.min(call++, script.length - 1)] ?? [];
      for (const ev of events) yield ev;
    },
  };
}

describe('runAgentTurn 工具循环', () => {
  beforeEach(resetWorkspace);

  it('tool-call → 执行（审批注入）→ 回填 → 第二轮得到最终文本', async () => {
    const toolCall: ToolCallRequest = {
      id: 'tc1',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    };
    const provider = scriptedProvider([
      [{ type: 'tool-call', call: toolCall }, { type: 'done' }],
      [{ type: 'text-delta', delta: '已把 utilize 改为 use。' }, { type: 'done' }],
    ]);

    const toolResults: string[] = [];
    const text = await runAgentTurn({
      provider,
      model: 'test',
      system: 'sys',
      history: [],
      user: '帮我替换',
      tools: ENABLED_TOOLS,
      approval: approveNow({ approved: true, note: '用户已采纳' }),
      onToolResult: (_id, content) => toolResults.push(content),
    });

    expect(text).toBe('已把 utilize 改为 use。');
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toContain('"applied":true');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
  });

  it('拒绝审批时结果回传 applied:false，文件不变', async () => {
    const toolCall: ToolCallRequest = {
      id: 'tc2',
      tool: 'tex.edit',
      args: { file: 'main.tex', content: '全部替换' },
    };
    const provider = scriptedProvider([
      [{ type: 'tool-call', call: toolCall }, { type: 'done' }],
      [{ type: 'text-delta', delta: '好的，我不改了。' }, { type: 'done' }],
    ]);
    const text = await runAgentTurn({
      provider,
      model: 'test',
      system: 'sys',
      history: [],
      user: '替换全文',
      tools: ENABLED_TOOLS,
      approval: approveNow({ approved: false, note: '用户拒绝了修改' }),
    });
    expect(text).toBe('好的，我不改了。');
    expect(useWorkspaceStore.getState().files['main.tex']).toContain('utilize');
  });
});
