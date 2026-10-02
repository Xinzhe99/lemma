/**
 * AI 动作层增量单测：一键修编译错误（fixCompileErrors）。
 * 覆盖验收路径：
 *  - parseCompileErrors：诊断行解析（file:line / 无行号）、warning 与杂音忽略、文件去重有序；
 *  - buildFixCompileErrorsContext / buildFixCompileErrorsPrompt：诊断注入、文件上下文注入
 *    （错误行 ±12 窗口、入口/活动 .tex 补充、.tex 扩展名回退）、超 30 条截断标注；
 *  - fixCompileErrors：无 error 诊断时直接返回 note（不发起会话）；
 *  - 演示分支（未配置模型）：prompt 进入会话，关键词「修复以下 LaTeX 编译错误」命中；
 *  - 真实分支（mock fetch SSE）：请求体携带 ENABLED_TOOLS（含 tex.edit → diff 审批闭环），
 *    流式回复落进会话。
 * 全程不依赖真实网络：fetch 以 SSE ReadableStream stub。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIX_L,
  abortPlan,
  buildFixCompileErrorsContext,
  buildFixCompileErrorsPrompt,
  executePlan,
  fixCompileErrors,
  parseCompileErrors,
  pickFix,
  runPlannedTask,
  skipFailedStep,
} from './aiActions';
import { useAgentHubStore } from '@scholarforge/agent-hub';
import { useSettingsStore } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { useProposalStore } from './state/proposalStore';
import { planPhase, useAgentPlansStore } from './state/agentPlans';

// 与 compileAction.logDiagnostics 写入格式一致（真实引擎与模拟引擎共用）
const LOG_ERROR_LINE = '  [error] main.tex:12 Undefined control sequence.';

function seedProject(): void {
  useWorkspaceStore.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'sections/intro.tex': 'line1\nline2\nline3\nbroken here\nline5\n',
    },
    openTabs: ['sections/intro.tex'],
    activeTab: 'sections/intro.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}

describe('parseCompileErrors（compileLog 诊断行解析）', () => {
  it('解析 error 行的 file:line 与 message，无行号行也接受', () => {
    const d = parseCompileErrors([
      '▶ 开始编译 main.tex（模拟引擎）',
      LOG_ERROR_LINE,
      '  [warning] main.tex:3 Something minor.',
      '  [error] sections/intro.tex Citation `x` undefined',
      '▣ 模拟引擎 · 1 趟 · 40ms · 失败',
    ]);
    expect(d.errors).toEqual([
      { file: 'main.tex', line: 12, message: 'Undefined control sequence.' },
      { file: 'sections/intro.tex', line: null, message: 'Citation `x` undefined' },
    ]);
    expect(d.files).toEqual(['main.tex', 'sections/intro.tex']);
  });

  it('非诊断行与 warning 行全部忽略（一键修复只针对 error）', () => {
    const d = parseCompileErrors([
      '▶ 开始编译 main.tex（模拟引擎）',
      '  [warning] refs.bib:1 minor',
      '    ↳ 修复提示：补全引用',
      '▣ 模拟引擎 · 1 趟 · 40ms · 成功',
    ]);
    expect(d.errors).toEqual([]);
    expect(d.files).toEqual([]);
  });

  it('行号为纯数字才解析（防 file:col 误判），空日志返回空清单', () => {
    const d = parseCompileErrors(['  [error] main.tex:abc weird message', '']);
    expect(d.errors).toEqual([{ file: 'main.tex:abc', line: null, message: 'weird message' }]);
    expect(parseCompileErrors([])).toEqual({ errors: [], files: [] });
  });
});

describe('buildFixCompileErrorsContext（相关文件上下文注入）', () => {
  const digest = {
    errors: [
      { file: 'main.tex', line: 2, message: 'e1' },
      { file: 'sections/intro', line: null, message: 'e2' }, // 无扩展名：应回退解析
    ],
    files: ['main.tex', 'sections/intro'],
  };

  it('错误文件按行号窗口输出带行号片段，无行号文件取开头', () => {
    const files: Record<string, string> = {
      'main.tex': ['a', 'b', 'c'].join('\n'),
      'sections/intro.tex': ['x1', 'x2'].join('\n'),
    };
    const ctx = buildFixCompileErrorsContext(digest, files, { entry: 'main.tex', active: null });
    expect(ctx).toContain('### main.tex');
    expect(ctx).toContain('2: b');
    expect(ctx).toContain('### sections/intro.tex'); // .tex 扩展名回退命中
    expect(ctx).toContain('（第 1–2 行）');
  });

  it('入口与活动 .tex 不在错误清单时补充（看到导言区），已含则不重复', () => {
    const files: Record<string, string> = {
      'main.tex': 'preamble\n',
      'sections/intro.tex': 'intro body\n',
      'sections/method.tex': 'method body\n',
    };
    const ctx = buildFixCompileErrorsContext(digest, files, {
      entry: 'main.tex',
      active: 'sections/method.tex',
    });
    expect(ctx).toContain('### sections/method.tex'); // 活动 .tex 补充
    expect(ctx.indexOf('### main.tex')).toBe(0); // 错误文件优先
    expect(ctx.match(/### main\.tex/g)).toHaveLength(1); // 同文件不重复
    // 活动 .tex 非 .tex 后缀时不补充
    const ctx2 = buildFixCompileErrorsContext(
      { errors: [], files: [] },
      files,
      { entry: 'main.tex', active: 'refs.bib' },
    );
    expect(ctx2).not.toContain('refs.bib');
  });

  it('工作区不存在的错误文件跳过（不产出空片段）', () => {
    const ctx = buildFixCompileErrorsContext(
      { errors: [{ file: 'ghost.tex', line: 3, message: 'e' }], files: ['ghost.tex'] },
      { 'main.tex': 'only\n' },
      { entry: 'main.tex', active: null },
    );
    expect(ctx).not.toContain('ghost.tex');
    expect(ctx).toContain('### main.tex');
  });

  it('同文件多个相邻错误合并为一个窗口，不相邻分段', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `L${i + 1}`);
    const ctx = buildFixCompileErrorsContext(
      {
        errors: [
          { file: 'main.tex', line: 20, message: 'a' },
          { file: 'main.tex', line: 25, message: 'b' },
          { file: 'main.tex', line: 90, message: 'c' },
        ],
        files: ['main.tex'],
      },
      { 'main.tex': lines.join('\n') },
      { entry: null, active: null },
    );
    expect(ctx).toContain('（第 8–37 行）'); // 20±12 与 25±12 合并
    expect(ctx).toContain('（第 78–100 行）'); // 独立窗口
    expect(ctx.match(/（第/g)).toHaveLength(2);
  });
});

describe('buildFixCompileErrorsPrompt（prompt 组装）', () => {
  it('首句含演示路由关键词，注入错误清单与文件上下文', () => {
    const digest = parseCompileErrors([LOG_ERROR_LINE, '  [error] sections/intro.tex broken']);
    const prompt = buildFixCompileErrorsPrompt(
      digest,
      {
        'main.tex': '\\documentclass{article}\n\\begin{document}\n\\badcommand\n\\end{document}\n',
        'sections/intro.tex': 'intro\n',
      },
      { entry: 'main.tex', active: 'sections/intro.tex' },
    );
    expect(prompt.startsWith('请修复以下 LaTeX 编译错误')).toBe(true);
    expect(prompt).toContain('1. main.tex:12 — Undefined control sequence.');
    expect(prompt).toContain('2. sections/intro.tex — broken');
    expect(prompt).toContain('## 相关文件上下文');
    expect(prompt).toContain('### main.tex');
    expect(prompt).toContain('tex.edit');
    expect(prompt).toContain('tex.compile');
  });

  it('错误超过 30 条时截断并标注总数', () => {
    const errors = Array.from({ length: 40 }, (_, i) => `  [error] main.tex:${i + 1} e${i}`);
    const digest = parseCompileErrors(errors);
    const prompt = buildFixCompileErrorsPrompt(digest, { 'main.tex': 'x\n' }, { entry: 'main.tex', active: null });
    expect(prompt).toContain('30. main.tex:30 — e29');
    expect(prompt).not.toContain('31. main.tex:31');
    expect(prompt).toContain('共 40 条，仅列出前 30 条');
  });

  it('上下文全空时给出占位说明（模型仍可依日志工作）', () => {
    const digest = parseCompileErrors(['  [error] ghost.tex:1 missing']);
    const prompt = buildFixCompileErrorsPrompt(digest, { 'refs.bib': '@x{y,}\n' }, { entry: null, active: null });
    expect(prompt).toContain('（出错文件不在当前工作区）');
  });
});

describe('fixCompileErrors（无错误 / 演示 / 真实三分支）', () => {
  afterEach(() => {
    useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
    useProposalStore.getState().setNote(null);
    vi.unstubAllGlobals();
  });

  it('无 error 诊断时直接返回 note，不创建会话', async () => {
    seedProject();
    useWorkspaceStore.setState({ compileLog: ['  [warning] main.tex:1 minor', '▣ 成功'] });
    const before = useAgentHubStore.getState().sessions.length;
    await fixCompileErrors();
    expect(useProposalStore.getState().note).toBe(FIX_L.zh.noErrors);
    expect(useAgentHubStore.getState().sessions.length).toBe(before);
  });

  it('en 语言时 note 为英文', async () => {
    seedProject();
    useSettingsStore.setState({ language: 'en' });
    useWorkspaceStore.setState({ compileLog: [] });
    await fixCompileErrors();
    expect(useProposalStore.getState().note).toBe(FIX_L.en.noErrors);
    expect(pickFix('en').noErrors).toBe(FIX_L.en.noErrors);
  });

  it('演示分支（未配置模型）：prompt 进入会话且含路由关键词，回复为演示脚本', async () => {
    seedProject();
    useSettingsStore.setState({ providers: [], activeProviderId: null });
    useWorkspaceStore.setState({ compileLog: [LOG_ERROR_LINE] });
    await fixCompileErrors();
    const s = useAgentHubStore.getState().sessions[0]!;
    const userMsg = [...s.messages].reverse().find((m) => m.role === 'user')!;
    expect(userMsg.content.startsWith('请修复以下 LaTeX 编译错误')).toBe(true);
    expect(userMsg.content).toContain('main.tex:12 — Undefined control sequence.');
    const assistant = [...s.messages].reverse().find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('演示');
  });

  it('真实分支（mock fetch SSE）：请求携带 ENABLED_TOOLS（含 tex.edit），流式回复落进会话', async () => {
    seedProject();
    useSettingsStore.setState({
      providers: [
        {
          id: 'p1',
          label: '测试服务',
          baseUrl: 'https://api.test/v1',
          apiKey: 'sk-test',
          model: 'test-model',
          tier: 'flagship',
        },
      ],
      activeProviderId: 'p1',
    });
    useWorkspaceStore.setState({ compileLog: [LOG_ERROR_LINE] });

    const bodies: string[] = [];
    const sse = [
      'data: {"choices":[{"delta":{"content":"已定位到 \\\\badcommand。"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const fetchMock = vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(sse));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await fixCompileErrors();

    expect(fetchMock).toHaveBeenCalledOnce();
    const body = JSON.parse(bodies[0]!) as {
      messages: { role: string; content: string }[];
      tools?: { function: { name: string } }[];
    };
    // 工具启用：ENABLED_TOOLS 注入请求（tex.edit 在列 → 落 diff 审批卡）
    const toolNames = (body.tools ?? []).map((t) => t.function.name);
    expect(toolNames).toContain('tex.edit');
    expect(toolNames).toContain('tex.compile');
    // 最后一条 user 消息即修复 prompt（诊断注入）
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')!;
    expect(lastUser.content).toContain('修复以下 LaTeX 编译错误');
    expect(lastUser.content).toContain('Undefined control sequence.');
    // 流式回复进入会话
    const s = useAgentHubStore.getState().sessions[0]!;
    const assistant = [...s.messages].reverse().find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('已定位到');
  });
});

// ---------------------------------------------------------------------------
// 计划模式（Plan Mode）：runPlannedTask 规划轮 + executePlan 逐步执行。
// 覆盖验收路径：计划解析成功/失败、批准后逐步状态推进、失败停止、跳过续跑、
// 中止、汇总消息。全程不依赖真实网络：fetch 以 SSE ReadableStream stub，
// 按请求体里的最后一条 user 消息区分规划轮（含「输出执行计划」）与步骤轮。
// ---------------------------------------------------------------------------

const PLAN_STEPS = [
  { id: 's1', title: '检索文献库', detail: '找可压缩段落' },
  { id: 's2', title: '生成删减 diff', usesTools: ['tex.edit'] },
  { id: 's3', title: '编译验证', usesTools: ['tex.compile'] },
];

const PLAN_REPLY =
  '先看任务：\n\n```json\n' +
  JSON.stringify({ goal: '压缩论文到 9 页以内', steps: PLAN_STEPS }) +
  '\n```\n\n以上计划待批准。';

/** SSE 帮手：把一段文本拆成两个 delta 事件 + finish + [DONE] */
function sseOfText(text: string): string {
  const mid = Math.ceil(text.length / 2);
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return [
    `data: {"choices":[{"delta":{"content":"${esc(text.slice(0, mid))}"}}]}\n\n`,
    `data: {"choices":[{"delta":{"content":"${esc(text.slice(mid))}"}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');
}

interface FetchLog {
  url: string;
  body: {
    messages: { role: string; content: string }[];
    tools?: { function: { name: string } }[];
  };
}

/**
 * fetch stub：按最后一条 user 消息内容路由回复。
 * respond(lastUser) 返回 SSE 文本；hangSignal 为 true 时挂起等 abort（中止用例）。
 */
function stubPlanFetch(respond: (lastUser: string) => string | { hang: true }): {
  calls: FetchLog[];
} {
  const calls: FetchLog[] = [];
  const fetchMock = vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as FetchLog['body'];
    calls.push({ url: String(_url), body });
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const result = respond(lastUser);
    const controller = new ReadableStreamDefaultControllerShim();
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        Object.assign(controller, { c });
        if (typeof result === 'string') {
          c.enqueue(new TextEncoder().encode(result));
          c.close();
        }
      },
      cancel() {
        /* abort 时由 signal 监听器收尾 */
      },
    });
    if (typeof result === 'string') return new Response(stream, { status: 200 });
    // hang：不 enqueue 不 close，abort 时补发 [DONE] 收尾
    init?.signal?.addEventListener('abort', () => {
      try {
        controller.c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
        controller.c.close();
      } catch {
        /* 已关闭 */
      }
    });
    return new Response(stream, { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls };
}

/** 浏览器/Node 20.5+ 的 ReadableStreamDefaultController 无法直接构造：以包装器桥接 */
class ReadableStreamDefaultControllerShim {
  c!: ReadableStreamDefaultController<Uint8Array>;
}

function activateRealProvider(): void {
  useSettingsStore.setState({
    providers: [
      { id: 'p1', label: '测试服务', baseUrl: 'https://api.test/v1', apiKey: 'sk-test', model: 'm1', tier: 'cheap' },
    ],
    activeProviderId: 'p1',
  });
}

/** 读取当前会话最后一条 assistant 消息 */
function lastAssistant(): { id: string; content: string } {
  const s = useAgentHubStore.getState().sessions[useAgentHubStore.getState().sessions.length - 1]!;
  const m = [...s.messages].reverse().find((x) => x.role === 'assistant')!;
  return { id: m.id, content: m.content };
}

describe('计划模式 · runPlannedTask（规划轮）', () => {
  beforeEach(() => {
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
    useAgentPlansStore.getState().clear();
  });
  afterEach(() => {
    useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
    useAgentPlansStore.getState().clear();
    vi.unstubAllGlobals();
  });

  it('真实分支：回复含计划 JSON → 流式呈现原文 + agentPlans 登记（键 = assistant 消息 id）', async () => {
    seedProject();
    activateRealProvider();
    const { calls } = stubPlanFetch((lastUser) =>
      lastUser.includes('输出执行计划') ? sseOfText(PLAN_REPLY) : sseOfText('步骤输出'),
    );

    await runPlannedTask('帮我把论文压到 9 页');

    expect(calls).toHaveLength(1);
    // 规划轮：prompt 含路由关键词与用户任务，且不带工具（只规划不执行）
    const planUser = [...calls[0]!.body.messages].reverse().find((m) => m.role === 'user')!;
    expect(planUser.content.startsWith('请为以下任务输出执行计划')).toBe(true);
    expect(planUser.content).toContain('帮我把论文压到 9 页');
    expect(calls[0]!.body.tools).toBeUndefined();
    // 会话：user 消息为用户原话；assistant 消息保留模型原文
    const session = useAgentHubStore.getState().sessions[0]!;
    expect(session.messages[0]!.role).toBe('user');
    expect(session.messages[0]!.content).toBe('帮我把论文压到 9 页');
    expect(lastAssistant().content).toContain(PLAN_REPLY.slice(0, 8));
    // 计划登记：3 步全 pending
    const plans = useAgentPlansStore.getState().plans;
    const exec = plans[lastAssistant().id]!;
    expect(exec).toBeDefined();
    expect(exec.plan.goal).toBe('压缩论文到 9 页以内');
    expect(exec.plan.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    expect(planPhase(exec)).toBe('awaiting');
    expect(session.status).toBe('idle');
  });

  it('真实分支：回复非计划 JSON → 不登记计划，会话正常完结（普通回答）', async () => {
    seedProject();
    activateRealProvider();
    stubPlanFetch(() => sseOfText('这个问题不需要计划，直接回答：压缩相关工作节即可。'));

    await runPlannedTask('随便问问');

    expect(useAgentPlansStore.getState().plans).toEqual({});
    const session = useAgentHubStore.getState().sessions[0]!;
    expect(lastAssistant().content).toContain('直接回答');
    expect(session.status).toBe('idle');
  });

  it('演示分支（未配置模型）：GENERIC_CHAT 无 JSON → 普通回答呈现，不产出计划卡', async () => {
    seedProject();
    useSettingsStore.setState({ providers: [], activeProviderId: null });

    await runPlannedTask('帮我规划论文修改');

    expect(useAgentPlansStore.getState().plans).toEqual({});
    expect(lastAssistant().content).toContain('演示');
  });
});

describe('计划模式 · executePlan（逐步执行）', () => {
  beforeEach(() => {
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
    useAgentPlansStore.getState().clear();
  });
  afterEach(() => {
    useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
    useAgentHubStore.setState({ sessions: [], activeSessionId: null });
    useAgentPlansStore.getState().clear();
    vi.unstubAllGlobals();
  });

  /** 用例公共前置：种子项目 + 激活真实（mock fetch）provider */
  function planForRun(): void {
    seedProject();
    activateRealProvider();
  }

  it('批准后逐步推进：每步带 ENABLED_TOOLS、前步产出进入后续 prompt、全完结追加汇总消息', async () => {
    planForRun();
    const stepTexts: Record<string, string> = { s1: '找到 3 处重复段落', s2: 'diff 已生成待审批', s3: '编译 8.9 页通过' };
    const { calls } = stubPlanFetch((lastUser) => {
      if (lastUser.includes('输出执行计划')) return sseOfText(PLAN_REPLY);
      const m = /\（(s\d)\）/.exec(lastUser);
      return sseOfText(stepTexts[m?.[1] ?? 's1'] ?? 'ok');
    });

    await runPlannedTask('压缩论文');
    const msgId = lastAssistant().id;
    await executePlan(msgId);

    // 4 次调用：1 规划 + 3 步骤；步骤轮带工具（真实 provider）
    expect(calls).toHaveLength(4);
    const stepCalls = calls.slice(1);
    for (const c of stepCalls) {
      expect(c.body.tools?.map((t) => t.function.name)).toContain('tex.edit');
    }
    // 逐步状态推进到位
    const exec = useAgentPlansStore.getState().plans[msgId]!;
    expect(exec.statuses).toEqual({ s1: 'done', s2: 'done', s3: 'done' });
    expect(exec.outputs.s1).toContain('找到 3 处重复段落');
    expect(planPhase(exec)).toBe('finished');
    // 前步产出进入后续步骤 prompt（s3 的 prompt 应含 s1 产出摘要）
    const s3User = [...calls[3]!.body.messages].reverse().find((m) => m.role === 'user')!.content;
    expect(s3User).toContain('逐步骤说明');
    expect(s3User).toContain('找到 3 处重复段落');
    // 汇总消息追加到会话
    expect(lastAssistant().content).toContain('✅ 计划完成：压缩论文到 9 页以内（3 步）');
    const session = useAgentHubStore.getState().sessions[0]!;
    expect(session.status).toBe('idle');
  });

  it('单步失败 → failed 并停：后续步骤不执行、无汇总消息', async () => {
    planForRun();
    const calls: FetchLog[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as FetchLog['body'];
        calls.push({ url: String(_url), body });
        const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (lastUser.includes('输出执行计划')) {
          return new Response(new TextEncoder().encode(sseOfText(PLAN_REPLY)), { status: 200 });
        }
        if (lastUser.includes('（s1）')) {
          return new Response(new TextEncoder().encode(sseOfText('检索完成')), { status: 200 });
        }
        return new Response('server error', { status: 500 }); // s2 起接口 500
      }) as unknown as typeof fetch,
    );

    await runPlannedTask('压缩论文');
    const msgId = lastAssistant().id;
    await executePlan(msgId);

    const exec = useAgentPlansStore.getState().plans[msgId]!;
    expect(exec.statuses.s1).toBe('done');
    expect(exec.statuses.s2).toBe('failed');
    expect(exec.statuses.s3).toBe('pending'); // 失败即停
    expect(lastAssistant().content).not.toContain('✅ 计划完成');
    expect(calls).toHaveLength(3); // 规划 + s1 + s2（失败）
  });

  it('跳过失败步并续跑：s2 skipped、s3 照常执行，汇总含跳过数', async () => {
    planForRun();
    const calls: FetchLog[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as FetchLog['body'];
        calls.push({ url: String(_url), body });
        const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (lastUser.includes('输出执行计划')) {
          return new Response(new TextEncoder().encode(sseOfText(PLAN_REPLY)), { status: 200 });
        }
        if (lastUser.includes('（s1）')) {
          return new Response(new TextEncoder().encode(sseOfText('检索完成')), { status: 200 });
        }
        if (lastUser.includes('（s2）')) return new Response('err', { status: 500 });
        return new Response(new TextEncoder().encode(sseOfText('编译通过 8.9 页')), { status: 200 });
      }) as unknown as typeof fetch,
    );

    await runPlannedTask('压缩论文');
    const msgId = lastAssistant().id;
    await executePlan(msgId); // s1 done, s2 failed 停
    await skipFailedStep(msgId); // 跳过 s2，续跑 s3

    const exec = useAgentPlansStore.getState().plans[msgId]!;
    expect(exec.statuses).toEqual({ s1: 'done', s2: 'skipped', s3: 'done' });
    expect(lastAssistant().content).toContain('✅ 计划完成：压缩论文到 9 页以内（3 步，1 步跳过）');
    // 续跑 s3 的 prompt 概览带 s2 跳过标记
    const s3User = [...calls[calls.length - 1]!.body.messages].reverse().find((m) => m.role === 'user')!.content;
    expect(s3User).toContain('⇣ s2');
  });

  it('重试失败步：executePlan 直接重跑 failed 步骤后继续', async () => {
    planForRun();
    let s2Fails = true;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as FetchLog['body'];
        const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
        if (lastUser.includes('输出执行计划')) {
          return new Response(new TextEncoder().encode(sseOfText(PLAN_REPLY)), { status: 200 });
        }
        if (lastUser.includes('（s1）')) {
          return new Response(new TextEncoder().encode(sseOfText('检索完成')), { status: 200 });
        }
        if (lastUser.includes('（s2）')) {
          if (s2Fails) {
            s2Fails = false;
            return new Response('err', { status: 500 });
          }
          return new Response(new TextEncoder().encode(sseOfText('重试成功，diff 生成')), { status: 200 });
        }
        return new Response(new TextEncoder().encode(sseOfText('编译通过')), { status: 200 });
      }) as unknown as typeof fetch,
    );

    await runPlannedTask('压缩论文');
    const msgId = lastAssistant().id;
    await executePlan(msgId); // s2 失败停
    expect(useAgentPlansStore.getState().plans[msgId]!.statuses.s2).toBe('failed');
    await executePlan(msgId); // 重试 = 再次 executePlan（failed 优先于 pending）

    const exec = useAgentPlansStore.getState().plans[msgId]!;
    expect(exec.statuses).toEqual({ s1: 'done', s2: 'done', s3: 'done' });
    expect(exec.outputs.s2).toContain('重试成功');
  });

  it('中止：步骤挂起时 abortPlan → 当前步 failed（已中止）、会话收到中止标注', async () => {
    planForRun();
    stubPlanFetch((lastUser) => {
      if (lastUser.includes('输出执行计划')) return sseOfText(PLAN_REPLY);
      if (lastUser.includes('（s1）')) return { hang: true }; // s1 永不结束
      return sseOfText('ok');
    });

    await runPlannedTask('压缩论文');
    const msgId = lastAssistant().id;
    const p = executePlan(msgId);
    // 等步骤进入挂起（首次 fetch 返回 hang 流后）
    await new Promise((r) => setTimeout(r, 150));
    abortPlan();
    await p;

    const exec = useAgentPlansStore.getState().plans[msgId]!;
    expect(exec.statuses.s1).toBe('failed');
    expect(exec.outputs.s1).toContain('已中止');
    expect(exec.statuses.s2).toBe('pending');
    expect(lastAssistant().content).toContain('⏹️ 计划已中止');
  });

  it('未知 msgId / 会话缺失：安全 no-op（不抛错、不发请求）', async () => {
    planForRun();
    const fetchMock = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);
    await executePlan('ghost-msg');
    await runPlannedTask('压缩论文'); // 先建会话
    const msgId = lastAssistant().id;
    useAgentHubStore.setState({ sessions: useAgentHubStore.getState().sessions.slice(0, 0) }); // 会话清空 → sessionOfMessage 失败
    await executePlan(msgId);
    // 唯一一次 fetch 来自规划轮；两次无效 executePlan 均未发起请求
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
