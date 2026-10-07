import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { ChatEvent, ChatProvider, ChatRequest } from '@lemma/agent-hub';
import { useAgentHubStore } from '@lemma/agent-hub';
import type { ToolCallRequest } from '@lemma/shared';
import { useWorkspaceStore } from './state/workspaceStore';
import { useLibraryStore } from './state/libraryStore';
import { useSettingsStore } from './state/settingsStore';
import { createAppToolExecutor, runAgentTurn, ENABLED_TOOLS } from './agentTools';
import type { ApprovalDecision, ApprovalFn } from './approval';

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

describe('submission.checklist 工具（WF-1 投稿档案查询）', () => {
  it('已加入 ENABLED_TOOLS 暴露给模型（只读权限）', () => {
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('submission.checklist');
  });

  it('传 "NeurIPS"：返回含页数与匿名字段的完整档案', async () => {
    const executor = createAppToolExecutor();
    const result = (await executor.execute({
      id: 'sc1',
      tool: 'submission.checklist',
      args: { journal: 'NeurIPS' },
    })) as {
      matched: boolean;
      query: string;
      venue: {
        id: string;
        name: string;
        pageLimit: string;
        template: string;
        anonymity: string;
        supplementary: string;
        aiPolicy: string;
        notes: string;
      };
    };
    expect(result.matched).toBe(true);
    expect(result.query).toBe('NeurIPS');
    expect(result.venue.id).toBe('neurips');
    expect(result.venue.pageLimit).toContain('9');
    expect(result.venue.anonymity).toContain('双盲');
    expect(result.venue.template).toBeTruthy();
    expect(result.venue.supplementary).toBeTruthy();
    expect(result.venue.aiPolicy).toBeTruthy();
    expect(result.venue.notes).toBeTruthy();
  });

  it('模糊匹配：别名、大小写、venue 参数名均可命中', async () => {
    const executor = createAppToolExecutor();
    const nips = (await executor.execute({
      id: 'sc2a',
      tool: 'submission.checklist',
      args: { journal: 'nips' },
    })) as { matched: boolean; venue: { id: string } };
    expect(nips.matched).toBe(true);
    expect(nips.venue.id).toBe('neurips');

    // 注册表必填字段为 journal；传空串时回退读 venue（WF-1 契约的 args.venue）
    const iclr = (await executor.execute({
      id: 'sc2b',
      tool: 'submission.checklist',
      args: { journal: '', venue: 'ICLR' },
    })) as { matched: boolean; venue: { id: string } };
    expect(iclr.matched).toBe(true);
    expect(iclr.venue.id).toBe('iclr');

    const tpami = (await executor.execute({
      id: 'sc2c',
      tool: 'submission.checklist',
      args: { journal: 'IEEE TPAMI' },
    })) as { venue: { id: string } };
    expect(tpami.venue.id).toBe('tpami');
  });

  it('无匹配：matched=false 并返回内置候选列表', async () => {
    const executor = createAppToolExecutor();
    const result = (await executor.execute({
      id: 'sc3',
      tool: 'submission.checklist',
      args: { journal: 'Journal of Nowhere 123' },
    })) as { matched: boolean; candidates: string[]; note: string };
    expect(result.matched).toBe(false);
    expect(result.candidates.length).toBeGreaterThanOrEqual(10);
    expect(result.candidates).toContain('NeurIPS');
    expect(result.note).toContain('未匹配');
  });

  it('缺 journal 参数被注册表 schema 拦截（runAgentTurn 会捕获并回传 error）', async () => {
    const executor = createAppToolExecutor();
    await expect(executor.execute({ id: 'sc4', tool: 'submission.checklist', args: {} })).rejects.toThrow(
      '参数校验失败',
    );
  });
});

describe('library.search_fulltext 参数契约（v7.8.0）', () => {
  beforeEach(resetWorkspace);

  it('按注册表声明的 limit 取条数；旧的 k 仍兼容；缺省为 10', async () => {
    const calls: Array<{ q: string; k: number | undefined }> = [];
    const orig = useLibraryStore.getState().searchKnowledge;
    // 只替换检索函数（其余 store 行为保持真实）
    useLibraryStore.setState({
      searchKnowledge: (async (q: string, k?: number) => {
        calls.push({ q, k });
        return [];
      }) as typeof orig,
    });
    try {
      const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));

      await executor.execute({
        id: 'ls1',
        tool: 'library.search_fulltext',
        args: { query: 'attention', limit: 20 },
      });
      expect(calls.at(-1)).toEqual({ q: 'attention', k: 20 });

      // 回归：此前 handler 只读 args.k，模型按声明传 limit 时被静默忽略（固定 5 条）
      await executor.execute({ id: 'ls2', tool: 'library.search_fulltext', args: { query: 'attention' } });
      expect(calls.at(-1)?.k).toBe(10);

      await executor.execute({
        id: 'ls3',
        tool: 'library.search_fulltext',
        args: { query: 'attention', k: 3 },
      });
      expect(calls.at(-1)?.k).toBe(3);

      // 越界值被钳制（防止模型传 0 / 负数 / 巨值打爆上下文）
      await executor.execute({
        id: 'ls4',
        tool: 'library.search_fulltext',
        args: { query: 'attention', limit: 9999 },
      });
      expect(calls.at(-1)?.k).toBe(50);
      await executor.execute({
        id: 'ls5',
        tool: 'library.search_fulltext',
        args: { query: 'attention', limit: 0 },
      });
      expect(calls.at(-1)?.k).toBe(1);
    } finally {
      useLibraryStore.setState({ searchKnowledge: orig });
    }
  });
});

// ---------------------------------------------------------------------------
// v7.8.0 审计回归：审批卡采纳路径（先落盘、后回传 token）+ citation.add 建库
// ---------------------------------------------------------------------------

/** 模拟 AgentPanel DiffApprovalCard2.onAccept：先按用户裁决落盘，再回传 approved */
function uiApprove(
  transform?: (proposal: { file: string; before: string; after: string }) => string,
): ApprovalFn {
  return async (p) => {
    const next = transform ? transform(p) : p.after;
    const ws = useWorkspaceStore.getState();
    ws.snapshotFile(p.file, '审批前快照');
    ws.updateFile(p.file, next);
    return { approved: true, note: '用户已采纳全部修改' };
  };
}

describe('tex.edit：审批卡已落盘时不再二次写入、也不谎报「被取消」（v7.8.0）', () => {
  beforeEach(resetWorkspace);

  it('审批卡采纳（已落盘 after）：回传 applied:true，文件恰为 after', async () => {
    const executor = createAppToolExecutor(uiApprove());
    const result = (await executor.execute({
      id: 'u1',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { applied: boolean; reason?: string; note: string };
    // 回归：此前陈旧覆盖防护把它判成「审批期间被其他修改」→ applied:false + 请重试
    expect(result.applied).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
  });

  it('部分采纳（审批卡写入 hunk 子集）：不被整份提案覆盖，并明确告知内容与提案不一致', async () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': '一\n二\n三\n四\n五\n' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
    });
    const executor = createAppToolExecutor(
      uiApprove(() => '一\n二\n三\n四\n五\n六\n'), // 用户只采纳了「末尾加一行」这一处
    );
    const result = (await executor.execute({
      id: 'u2',
      tool: 'tex.edit',
      args: { file: 'main.tex', content: '一\n二\n三\n四\n五\n六\n七\n' },
    })) as { applied: boolean; note: string };
    expect(result.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('一\n二\n三\n四\n五\n六\n');
    expect(result.note).toContain('不完全一致');
  });

  it('审批函数未落盘（测试注入/无 UI 形态）：执行器自己写入并快照', async () => {
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'u3',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { applied: boolean };
    expect(result.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
  });

  it('find/replace 的替换文本按字面处理：$$ / $& 不被当作替换模式', async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': '公式在此。\n' }, activeTab: 'main.tex' });
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    await executor.execute({
      id: 'u4',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: '公式在此。', replace: '$$E = mc^2$$ 与 $&' },
    });
    // 回归：此前 $$ 塌缩为 $、$& 替换回原文
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('$$E = mc^2$$ 与 $&\n');
  });

  it('注册表声明的 summary 进入审批卡标题（此前被静默丢弃）', async () => {
    let label = '';
    const capture = (async (p: { label: string }) => {
      label = p.label;
      return { approved: false, note: '拒绝' };
    }) as unknown as ApprovalFn;
    const executor = createAppToolExecutor(capture);
    await executor.execute({
      id: 'u5',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use', summary: '统一用词：utilize→use' },
    });
    expect(label).toContain('统一用词：utilize→use');

    // 未带 summary 时回落默认标题
    const executor2 = createAppToolExecutor(capture);
    await executor2.execute({
      id: 'u6',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    });
    expect(label).toBe('AI 修改稿件（tex.edit）');
  });

  it('审批期间文件被删除/工作区切换：如实失败，不谎报 applied', async () => {
    const wipe = (async () => {
      useWorkspaceStore.setState({ files: {}, activeTab: null });
      return { approved: true, note: 'ok' };
    }) as unknown as ApprovalFn;

    const editor = createAppToolExecutor(wipe);
    const edit = (await editor.execute({
      id: 'w1',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { applied: boolean; reason: string };
    expect(edit.applied).toBe(false);
    expect(edit.reason).toContain('被删除');

    useWorkspaceStore.setState({ files: { 'main.tex': 'x\n', 'refs.bib': '@article{a,}\n' }, activeTab: 'main.tex' });
    const adder = createAppToolExecutor(wipe);
    const add = (await adder.execute({
      id: 'w2',
      tool: 'citation.add',
      args: { entry: { citekey: 'gone2024', title: 'Gone' } },
    })) as { applied: boolean; reason: string };
    expect(add.applied).toBe(false);
    expect(add.reason).toContain('被删除');
    expect(useWorkspaceStore.getState().files['refs.bib']).toBeUndefined(); // 没凭空重建
  });
});

describe('citation.add：项目没有 .bib 时也能建库写入（v7.8.0）', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projectName: 'test',
      entry: 'main.tex',
      files: { 'main.tex': 'hi\n' }, // 无任何 .bib
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
      compileLog: [],
      compileStatus: 'idle',
    });
  });

  it('无 .bib：应用后创建 refs.bib 并写入条目（此前误报「审批期间被修改，已取消」）', async () => {
    // 激活一个会话，验证产物清单把这一步记为「新建」而非「修改」
    useAgentHubStore.setState({
      sessions: [{ id: 's1', title: 't', messages: [], providerId: 'host', status: 'idle' }],
      activeSessionId: 's1',
    });
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'b1',
      tool: 'citation.add',
      args: { entry: { citekey: 'first2024', title: 'First Paper' } },
    })) as { applied: boolean; file: string; reason?: string };
    expect(result.reason).toBeUndefined();
    expect(result.applied).toBe(true);
    expect(result.file).toBe('refs.bib');
    expect(useWorkspaceStore.getState().files['refs.bib']).toContain('@misc{first2024,');
    expect(useAgentHubStore.getState().sessions[0]!.artifacts).toEqual([
      expect.objectContaining({ file: 'refs.bib', kind: 'create' }),
    ]);
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
  });

  it('已存在但为空的 .bib：写入条目（此前 createFile 不覆盖 → 报成功却什么都没写）', async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'hi\n', 'refs.bib': '' } });
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'b2',
      tool: 'citation.add',
      args: { entry: { citekey: 'second2024', title: 'Second Paper' } },
    })) as { applied: boolean };
    expect(result.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['refs.bib']).toContain('@misc{second2024,');
  });

  it('审批卡已落盘：不再二次追加（条目只出现一次）', async () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': 'hi\n', 'refs.bib': '@article{a, title={A}}\n' },
    });
    const executor = createAppToolExecutor(uiApprove());
    const result = (await executor.execute({
      id: 'b3',
      tool: 'citation.add',
      args: { entry: { citekey: 'third2024', title: 'Third Paper' } },
    })) as { applied: boolean };
    expect(result.applied).toBe(true);
    const bib = useWorkspaceStore.getState().files['refs.bib']!;
    expect(bib.match(/@misc\{third2024,/g)).toHaveLength(1);
    expect(bib.match(/@article\{a,/g)).toHaveLength(1);
  });
});

describe('tex.create_file / project.find_in_files / citation.validate 边界（v7.8.0）', () => {
  beforeEach(resetWorkspace);

  it('tex.edit diff 头指向另一个项目文件：拒绝，避免改错文件', async () => {
    useWorkspaceStore.setState({
      files: {
        'main.tex': 'line1\nline2\n',
        'sections/intro.tex': 'line1\nline2\n', // 与 main.tex 内容相同 → 不设防就会改错
      },
      activeTab: 'main.tex',
    });
    const executor = createAppToolExecutor(approveNow({ approved: true, note: 'ok' }));
    const result = (await executor.execute({
      id: 'd1',
      tool: 'tex.edit',
      args: {
        file: 'main.tex',
        diff: ['--- a/sections/intro.tex', '+++ b/sections/intro.tex', '@@ -1,1 +1,1 @@', '-line1', '+LINE1'].join('\n'),
      },
    })) as { applied: boolean; reason: string };
    expect(result.applied).toBe(false);
    expect(result.reason).toContain('sections/intro.tex');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('line1\nline2\n');

    // 头指向目标文件（git a/ b/ 前缀）→ 正常应用
    const ok = (await executor.execute({
      id: 'd2',
      tool: 'tex.edit',
      args: {
        file: 'main.tex',
        diff: ['--- a/main.tex', '+++ b/main.tex', '@@ -1,1 +1,1 @@', '-line1', '+LINE1'].join('\n'),
      },
    })) as { applied: boolean };
    expect(ok.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('LINE1\nline2\n');

    // 占位头（不在工作区里）不判定，照常应用
    const placeholder = (await executor.execute({
      id: 'd3',
      tool: 'tex.edit',
      args: {
        file: 'main.tex',
        diff: ['--- 原始', '+++ 修改后', '@@ -2,1 +2,1 @@', '-line2', '+LINE2'].join('\n'),
      },
    })) as { applied: boolean };
    expect(placeholder.applied).toBe(true);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('LINE1\nLINE2\n');
  });

  it('tex.create_file：审批期间同名文件已存在 → 如实失败，不谎报 created', async () => {
    const executor = createAppToolExecutor(
      (async () => {
        useWorkspaceStore.getState().createFile('new.tex', '别人写的');
        return { approved: true, note: 'ok' };
      }) as never,
    );
    const result = (await executor.execute({
      id: 'c1',
      tool: 'tex.create_file',
      args: { path: 'new.tex', content: '我要写的' },
    })) as { created: boolean; reason?: string };
    expect(result.created).toBe(false);
    expect(result.reason).toContain('已存在');
    expect(useWorkspaceStore.getState().files['new.tex']).toBe('别人写的');
  });

  it('project.find_in_files：命中超过上限时显式标注截断', async () => {
    const many = Array.from({ length: 60 }, (_, i) => `hit ${i}`).join('\n');
    useWorkspaceStore.setState({ files: { 'main.tex': many }, activeTab: 'main.tex' });
    const executor = createAppToolExecutor();
    const result = (await executor.execute({
      id: 'f1',
      tool: 'project.find_in_files',
      args: { query: 'hit' },
    })) as { totalHits: number; truncated: boolean; note?: string; hits: unknown[] };
    expect(result.hits).toHaveLength(50);
    expect(result.truncated).toBe(true);
    expect(result.note).toContain('仅返回前 50 条');

    // 未超上限时不标注
    useWorkspaceStore.setState({ files: { 'main.tex': 'hit 1\nhit 2\n' } });
    const small = (await executor.execute({
      id: 'f2',
      tool: 'project.find_in_files',
      args: { query: 'hit' },
    })) as { truncated: boolean; note?: string };
    expect(small.truncated).toBe(false);
    expect(small.note).toBeUndefined();
  });

  it('citation.validate：1 字符键不再假通过；claim 如实标注未评估', async () => {
    const executor = createAppToolExecutor();
    const bad = (await executor.execute({
      id: 'v1',
      tool: 'citation.validate',
      args: { key: 'q', claim: '某主张' },
    })) as { ok: boolean; invalid: string[]; claimChecked: boolean; note: string };
    expect(bad.ok).toBe(false);
    expect(bad.invalid).toEqual(['q']);
    expect(bad.claimChecked).toBe(false);
    expect(bad.note).toContain('未做判断');

    const good = (await executor.execute({
      id: 'v2',
      tool: 'citation.validate',
      args: { key: 'a', claim: '某主张' },
    })) as { ok: boolean };
    expect(good.ok).toBe(true); // refs.bib 中的 @article{a}
  });
});

describe('权限模式（v7.9.0：readonly 拦截 / full 免审批）', () => {
  beforeEach(() => {
    resetWorkspace();
    useSettingsStore.setState({ permissionMode: 'balanced' });
  });

  it('readonly：tex.edit 在闸门被拦（不触发审批、不落盘），错误附可行动指引', async () => {
    useSettingsStore.setState({ permissionMode: 'readonly' });
    const neverAsk = vi.fn(async () => {
      throw new Error('readonly 下不应触发审批');
    }) as unknown as ApprovalFn;
    const executor = createAppToolExecutor(neverAsk);
    const result = (await executor.execute({
      id: 'pm1',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { error: string };
    expect(result.error).toContain('仅可查看');
    expect(result.error).toContain('切换');
    expect(useWorkspaceStore.getState().files['main.tex']).toContain('utilize');
    expect(neverAsk).not.toHaveBeenCalled();
  });

  it('full：tex.edit 免审批直接应用（审批回调绝不触发），仍自动快照', async () => {
    useSettingsStore.setState({ permissionMode: 'full' });
    const neverAsk = vi.fn(async () => {
      throw new Error('full 模式不应触发审批');
    }) as unknown as ApprovalFn;
    const executor = createAppToolExecutor(neverAsk);
    const result = (await executor.execute({
      id: 'pm2',
      tool: 'tex.edit',
      args: { file: 'main.tex', find: 'utilize', replace: 'use' },
    })) as { applied: boolean; note: string };
    expect(result.applied).toBe(true);
    expect(result.note).toContain('完全权限');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('In order to test, we use data.');
    expect(neverAsk).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
  });
});

