/**
 * v7.5.0（对齐 agent-foundation 剩余可落地能力）：
 *  F1 projectInstructions（AGENTS.md / LEMMA.md 注入）
 *  F2 runtimeContext（时间/上下文规模/预算投影）
 *  F3 historyIntegrity（消息清理 + 400 自愈判定 + runAgentTurn 自愈重试）
 *  F4 compactHistoryForSend（摘要式压缩：阈值/缓存复用/失败回退）
 *  F5 userAsk（阻塞提问桥：作答/取代/作废）
 *  F6 cacheKey 透传 + provider prompt_cache_key
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent, ChatProvider, ChatRequest } from '@lemma/agent-hub';
import { OpenAICompatibleProvider } from '@lemma/agent-hub';
import type { AgentMessage, ToolCallRequest } from '@lemma/shared';
import { useWorkspaceStore } from './state/workspaceStore';
import {
  findInstructionsFile,
  renderInstructionsBlock,
  AGENTS_MD_TEMPLATE,
  INSTRUCTIONS_LIMIT,
} from './projectInstructions';
import { buildRuntimeContextBlock } from './runtimeContext';
import { isRepairableRequestError, sanitizeAgentMessages } from './historyIntegrity';
import {
  requestUserAnswer,
  resolveUserAnswer,
  rejectPendingUserAnswer,
  useUserAskStore,
} from './userAsk';
import { buildCompactionPrompt, compactHistoryForSend, resetCompactionCache } from './aiActions';
import { runAgentTurn } from './agentTools';

function msg(partial: Partial<AgentMessage> & { role: AgentMessage['role'] }): AgentMessage {
  return { id: `m-${Math.random().toString(36).slice(2, 8)}`, content: '', createdAt: 0, ...partial };
}

// ---------------------------------------------------------------------------
// F1：项目指令文件
// ---------------------------------------------------------------------------
describe('projectInstructions（F1 AGENTS.md）', () => {
  it('优先 AGENTS.md，其次 LEMMA.md；空文件跳过', () => {
    expect(findInstructionsFile({ 'LEMMA.md': '# 约定' })).toBe('LEMMA.md');
    expect(findInstructionsFile({ 'AGENTS.md': '# a', 'LEMMA.md': '# b' })).toBe('AGENTS.md');
    expect(findInstructionsFile({ 'AGENTS.md': '   \n  ' })).toBeNull();
    expect(findInstructionsFile({ 'main.tex': '' })).toBeNull();
  });

  it('renderInstructionsBlock 截断到上限并带标题', () => {
    const block = renderInstructionsBlock('x'.repeat(INSTRUCTIONS_LIMIT + 500));
    expect(block).toContain('AGENTS.md');
    expect(block).toContain('已截断');
    expect(block.length).toBeLessThan(INSTRUCTIONS_LIMIT + 200);
  });

  it('模板可直接落盘（非空且含必要段落）', () => {
    expect(AGENTS_MD_TEMPLATE.trim().length).toBeGreaterThan(100);
    expect(AGENTS_MD_TEMPLATE).toContain('禁止事项');
  });
});

// ---------------------------------------------------------------------------
// F2：运行时上下文
// ---------------------------------------------------------------------------
describe('runtimeContext（F2）', () => {
  it('注入当前时间与上下文规模', () => {
    const block = buildRuntimeContextBlock({
      now: new Date(2026, 9, 1, 9, 5),
      historyMessages: 12,
      historyChars: 8000,
    });
    expect(block).toContain('2026 年 10 月 1 日');
    expect(block).toContain('09:05');
    expect(block).toContain('12 条历史消息');
    expect(block).toContain('4000 token');
  });

  it('预算用量接近上限时提示收敛', () => {
    const warn = buildRuntimeContextBlock({ sessionBudgetTokens: 10000, sessionUsedTokens: 9000 });
    expect(warn).toContain('9000 / 10000');
    expect(warn).toContain('接近上限');
    const calm = buildRuntimeContextBlock({ sessionBudgetTokens: 10000, sessionUsedTokens: 1000 });
    expect(calm).not.toContain('接近上限');
  });

  it('无附加信息时仅时间一行，不炸', () => {
    const block = buildRuntimeContextBlock({ now: new Date(2026, 0, 2) });
    expect(block).toContain('当前时间');
    expect(block).toContain('2026 年 1 月 2 日');
  });
});

// ---------------------------------------------------------------------------
// F3：消息完整性 + 自愈
// ---------------------------------------------------------------------------
describe('historyIntegrity（F3）', () => {
  const call: ToolCallRequest = { id: 'tc1', tool: 'tex.edit', args: {} };

  it('合法序列原样保留', () => {
    const seq = [
      msg({ role: 'user', content: '改一下' }),
      msg({ role: 'assistant', content: '', toolCalls: [call] }),
      msg({ role: 'tool', content: '{"applied":true}', toolCallId: 'tc1' }),
      msg({ role: 'assistant', content: '完成' }),
    ];
    expect(sanitizeAgentMessages(seq)).toEqual(seq);
  });

  it('孤儿 tool 消息（无对应 assistant tool_calls）被丢弃', () => {
    const seq = [
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'tool', content: '{"x":1}', toolCallId: 'ghost' }),
      msg({ role: 'assistant', content: 'ok' }),
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out).toHaveLength(2);
    expect(out.some((m) => m.role === 'tool')).toBe(false);
  });

  it('重复 tool 结果只保留第一个', () => {
    const seq = [
      msg({ role: 'assistant', content: '', toolCalls: [call] }),
      msg({ role: 'tool', content: '第一份', toolCallId: 'tc1' }),
      msg({ role: 'tool', content: '第二份', toolCallId: 'tc1' }),
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out.filter((m) => m.role === 'tool')).toHaveLength(1);
    expect(out.find((m) => m.role === 'tool')?.content).toBe('第一份');
  });

  it('结果不齐的 assistant 剥离 toolCalls 只留文本', () => {
    const seq = [
      msg({ role: 'user', content: '改' }),
      msg({ role: 'assistant', content: '我调工具', toolCalls: [call] }), // 无 tool 结果跟随
    ];
    const out = sanitizeAgentMessages(seq);
    expect(out).toHaveLength(2);
    expect(out[1]!.toolCalls).toBeUndefined();
    expect(out[1]!.content).toBe('我调工具');
  });

  it('isRepairableRequestError：400/协议类 true，永久错误 false', () => {
    expect(isRepairableRequestError(new Error('接口返回 400：{"error":{"type":"invalid_request_error"}}'))).toBe(true);
    expect(isRepairableRequestError(new Error("An assistant message with 'tool_calls' must be followed by tool messages"))).toBe(true);
    expect(isRepairableRequestError(new Error('接口返回 401：invalid api key'))).toBe(false);
    expect(isRepairableRequestError(new Error('接口返回 404：model not found'))).toBe(false);
    expect(isRepairableRequestError(new Error('接口返回 429：rate limited'))).toBe(false);
  });
});

describe('runAgentTurn 自愈重试（F3）', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      projectName: 'test',
      entry: 'main.tex',
      files: { 'main.tex': 'hello', 'refs.bib': '' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
      snapshots: {},
      compileLog: [],
      compileStatus: 'idle',
    });
  });

  it('400 类错误时清理悬空 tool_calls 后自动重试成功', async () => {
    const danglingCall: ToolCallRequest = { id: 'tc9', tool: 'project.list_files', args: {} };
    let calls = 0;
    const provider: ChatProvider = {
      id: 'p',
      label: 'p',
      async *complete() {
        calls++;
        if (calls === 1) {
          yield { type: 'error', message: '接口返回 400：invalid_request_error tool_calls' };
          return;
        }
        yield { type: 'text-delta', delta: '自愈后的回答' };
        yield { type: 'done' };
      },
    };
    const text = await runAgentTurn({
      provider,
      model: 'm',
      system: 's',
      history: [msg({ role: 'user', content: '第一轮' }), msg({ role: 'assistant', content: '我调工具', toolCalls: [danglingCall] })],
      user: '第二轮',
    });
    expect(text).toBe('自愈后的回答');
    expect(calls).toBe(2);
  });

  it('自愈只做一次：修不好的 400 透传原始错误', async () => {
    let calls = 0;
    const provider: ChatProvider = {
      id: 'p',
      label: 'p',
      async *complete() {
        calls++;
        yield { type: 'error', message: '接口返回 400：invalid_request_error' };
      },
    };
    await expect(
      runAgentTurn({ provider, model: 'm', system: 's', history: [], user: 'hi' }),
    ).rejects.toThrow('400');
    expect(calls).toBe(1); // 无可修内容（changed=false）→ 不重试
  });

  it('cacheKey 透传到 provider 请求', async () => {
    let seen: string | undefined;
    const provider: ChatProvider = {
      id: 'p',
      label: 'p',
      async *complete(req: ChatRequest) {
        seen = req.cacheKey;
        yield { type: 'text-delta', delta: 'ok' };
        yield { type: 'done' };
      },
    };
    await runAgentTurn({ provider, model: 'm', system: 's', history: [], user: 'hi', cacheKey: 'session-1' });
    expect(seen).toBe('session-1');
  });
});

// ---------------------------------------------------------------------------
// F4：摘要式压缩
// ---------------------------------------------------------------------------
describe('compactHistoryForSend（F4）', () => {
  beforeEach(() => resetCompactionCache());

  const longHistory = (n: number): AgentMessage[] =>
    Array.from({ length: n }, (_, i) => msg({ role: i % 2 === 0 ? 'user' : 'assistant', content: `消息 ${i}：${'x'.repeat(600)}` }));

  it('低于阈值返回 null（不值得压缩）', async () => {
    const out = await compactHistoryForSend('s1', longHistory(10), async () => '摘要');
    expect(out).toBeNull();
  });

  it('超过阈值：返回 [摘要消息, ...最近 K 条]，且不重发更早原文', async () => {
    const history = longHistory(20); // 20 条 × 600 字
    const out = await compactHistoryForSend('s1', history, async () => '这是压缩摘要');
    expect(out).not.toBeNull();
    expect(out![0]!.content).toContain('这是压缩摘要');
    expect(out!).toHaveLength(1 + 8); // 摘要 + 最近 8 条
    expect(out!.slice(1)).toEqual(history.slice(-8));
    // 摘要消息只出现一次
    expect(out!.filter((m) => m.content.includes('压缩摘要'))).toHaveLength(1);
  });

  it('缓存命中：第二次调用不再调 summarize（covered 追平）', async () => {
    const summarize = vi.fn(async () => '摘要 v1');
    const history = longHistory(20);
    await compactHistoryForSend('s1', history, summarize);
    await compactHistoryForSend('s1', history, summarize); // 无新增
    expect(summarize).toHaveBeenCalledTimes(1);
  });

  it('增量压缩：新增对话并入既有摘要', async () => {
    let n = 0;
    const summarize = vi.fn(async (prompt: string) => {
      n++;
      return `摘要 v${n}`;
    });
    await compactHistoryForSend('s1', longHistory(20), summarize);
    const out2 = await compactHistoryForSend('s1', longHistory(24), summarize);
    expect(summarize).toHaveBeenCalledTimes(2);
    expect(out2![0]!.content).toContain('摘要 v2');
  });

  it('summarize 抛错 → null（回退机械截断，不阻断对话）', async () => {
    const out = await compactHistoryForSend('s1', longHistory(20), async () => {
      throw new Error('压缩模型挂了');
    });
    expect(out).toBeNull();
  });

  it('buildCompactionPrompt：角色标记 + 既有摘要段', () => {
    const prompt = buildCompactionPrompt('旧摘要内容', [msg({ role: 'user', content: '新消息' })]);
    expect(prompt).toContain('既有摘要');
    expect(prompt).toContain('旧摘要内容');
    expect(prompt).toContain('用户：新消息');
  });
});

// ---------------------------------------------------------------------------
// F5：阻塞提问桥
// ---------------------------------------------------------------------------
describe('userAsk（F5）', () => {
  afterEach(() => {
    rejectPendingUserAnswer();
    useUserAskStore.getState().setPending(null);
  });

  it('提问 → 用户作答 → Promise 结算', async () => {
    let answer: string | null | undefined;
    const p = requestUserAnswer('目标期刊是？', [{ label: 'TPAMI' }, { label: 'NeurIPS' }]).then((a) => {
      answer = a;
    });
    const pending = useUserAskStore.getState().pending;
    expect(pending?.question).toBe('目标期刊是？');
    expect(pending?.options).toHaveLength(2);
    expect(resolveUserAnswer(pending!.token, 'TPAMI')).toBe(true);
    await p;
    expect(answer).toBe('TPAMI');
    expect(useUserAskStore.getState().pending).toBeNull();
  });

  it('token 不匹配的作答被拒绝', async () => {
    const p = requestUserAnswer('q', []);
    expect(resolveUserAnswer('wrong-token', 'x')).toBe(false);
    rejectPendingUserAnswer();
    await expect(p).resolves.toBeNull();
  });

  it('新提问取代旧提问：旧的结算 null', async () => {
    const p1 = requestUserAnswer('旧问题', []);
    requestUserAnswer('新问题', []);
    await expect(p1).resolves.toBeNull();
    expect(useUserAskStore.getState().pending?.question).toBe('新问题');
  });

  it('作废：结算 null（会话中止路径）', async () => {
    const p = requestUserAnswer('q', []);
    expect(rejectPendingUserAnswer()).toBe(true);
    await expect(p).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// F6：provider 侧 prompt_cache_key
// ---------------------------------------------------------------------------
describe('OpenAICompatibleProvider prompt_cache_key（F6）', () => {
  it('cacheKey 进入请求体；不传则不带', async () => {
    const bodies: string[] = [];
    const fetchFn = async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body));
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    };
    const provider = new OpenAICompatibleProvider({
      id: 'x',
      label: 'x',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'k',
      fetchFn,
    });
    const base = { model: 'm', messages: [msg({ role: 'user', content: 'hi' })] };
    const events1: ChatEvent[] = [];
    for await (const ev of provider.complete({ ...base, cacheKey: 'session-42' })) events1.push(ev);
    expect(bodies[0]).toContain('"prompt_cache_key":"session-42"');

    const events2: ChatEvent[] = [];
    for await (const ev of provider.complete(base)) events2.push(ev);
    expect(bodies[1]).not.toContain('prompt_cache_key');
  });
});
