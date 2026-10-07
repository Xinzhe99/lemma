/**
 * researchAgents 测试：拆题（多主题直用 / 角度模板 / k 参数 / 缺额补足 / 空任务）、
 * buildSubAgentPrompt 契约、runResearchAgents（演示降级 / 并行调度 / 部分失败 /
 * 用量记录 / 会话汇总追加 / streaming 守卫）。全程无网络：真实分支注入
 * providerChoice + runTurn 假件，演示分支依赖未配置 provider 的缺省状态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentHubStore } from '@lemma/agent-hub';
import {
  FAILED_TOPIC_PREFIX,
  RESEARCH_ANGLES,
  buildDemoResearchOutput,
  buildSubAgentPrompt,
  runResearchAgents,
  splitResearchTopics,
} from './researchAgents';
import { useAgentUsageStore } from './state/agentUsage';
import { useSettingsStore } from './state/settingsStore';
import type { ProviderChoice } from './aiActions';
import type { ChatProvider, ChatRequest, ChatEvent } from '@lemma/agent-hub';

beforeEach(() => {
  useAgentHubStore.setState({ sessions: [], activeSessionId: null, runs: [], completedRuns: [] });
  useAgentUsageStore.setState({ events: [], monthlyBudgetUsd: undefined });
  useSettingsStore.setState({ providers: [], activeProviderId: null });
});

/** 会话里最后一条 assistant 消息（runResearchAgents 的进度与汇总都追加在这里） */
function lastAssistant(): string {
  const hub = useAgentHubStore.getState();
  const session = hub.sessions.find((s) => s.id === hub.activeSessionId);
  const msg = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant');
  return msg?.content ?? '';
}

/** 注入用真实形态 providerChoice（provider 本体不被调用：runTurn 一并注入） */
function realChoice(model = 'glm-4.6'): ProviderChoice {
  const provider: ChatProvider = {
    id: 'test',
    label: 'test',
    // eslint-disable-next-line require-yield
    async *complete(_req: ChatRequest): AsyncGenerator<ChatEvent> {
      throw new Error('runTurn 已注入，provider 不应被调用');
    },
  };
  return { provider, model, label: `test · ${model}`, real: true };
}

describe('splitResearchTopics · 拆题', () => {
  it('明显多主题（顿号分隔 ≥ k）直接采用', () => {
    expect(splitResearchTopics('Transformer 综述、评测基准、数据泄漏')).toEqual([
      'Transformer 综述',
      '评测基准',
      '数据泄漏',
    ]);
  });

  it('中英逗号/分号分隔同样直用，且超出 k 截取前 k 个', () => {
    expect(splitResearchTopics('a, b；c, d', 3)).toEqual(['a', 'b', 'c']);
  });

  it('单主题：按 方法/实验/应用 角度模板生成 k 个互补子问题', () => {
    const task = '调研检索增强生成在学术写作中的应用';
    const topics = splitResearchTopics(task, 3);
    expect(topics).toHaveLength(3);
    expect(topics[0]).toContain('从方法角度切入');
    expect(topics[1]).toContain('从实验角度切入');
    expect(topics[2]).toContain('从应用角度切入');
    for (const tp of topics) expect(tp).toContain('检索增强生成'); // 主题关键词保留
  });

  it('k 参数与角度扩展：k=2 只取前两个角度，k=5 覆盖到相关工作/局限与风险', () => {
    expect(splitResearchTopics('主题X', 2)).toHaveLength(2);
    const five = splitResearchTopics('主题X', 5);
    expect(five).toHaveLength(5);
    expect(five[3]).toContain('从相关工作角度切入');
    expect(five[4]).toContain('从局限与风险角度切入');
  });

  it('主题数不足 k：既有主题直用，缺额用角度模板补足', () => {
    const topics = splitResearchTopics('文献综述、实验设计', 3);
    expect(topics[0]).toBe('文献综述');
    expect(topics[1]).toBe('实验设计');
    expect(topics[2]).toContain('从方法角度切入');
  });

  it('空任务与非法 k：占位子问题 / 钳制到 [1, 8]', () => {
    expect(splitResearchTopics('   ')).toEqual(['（未提供研究任务）']);
    expect(splitResearchTopics('主题X', 0)).toHaveLength(1);
    expect(splitResearchTopics('主题X', 99)).toHaveLength(RESEARCH_ANGLES.length);
  });
});

describe('buildSubAgentPrompt · 子代理契约', () => {
  it('包含子问题原文与共享上下文', () => {
    const p = buildSubAgentPrompt('从方法角度切入：X', '## 大纲\n- 引言');
    expect(p).toContain('从方法角度切入：X');
    expect(p).toContain('## 大纲\n- 引言');
  });

  it('包含角色说明与输出要求（结论摘要 + 引用护栏）', () => {
    const p = buildSubAgentPrompt('T', 'C');
    expect(p).toContain('并行研究子代理');
    expect(p).toContain('结论摘要');
    expect(p).toContain('citekey');
  });

  it('共享上下文为空时回退占位说明', () => {
    expect(buildSubAgentPrompt('T', '  ')).toContain('（无额外上下文）');
  });
});

describe('runResearchAgents · 演示模式（real:false）', () => {
  it('每题返回预制演示文本（含 demo 路由关键词与题目），会话追加汇总，不记用量', async () => {
    const results = await runResearchAgents('Transformer 综述、评测基准、数据泄漏');
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.output).toContain('并行研究子任务'); // demo 路由关键词（集成者在 ROUTES 补路由）
      expect(r.output).toContain(r.topic);
      expect(r.output).toContain('演示数据');
    }
    // 汇总 markdown 追加进当前会话的新 assistant 消息
    const acc = lastAssistant();
    expect(acc).toContain('并行研究汇总');
    expect(acc).toContain('3/3 个子任务成功');
    expect(acc).toContain('### Transformer 综述');
    // 演示模式无 API 成本：不产生用量事件
    expect(useAgentUsageStore.getState().events).toEqual([]);
    // 会话状态归位
    const hub = useAgentHubStore.getState();
    expect(hub.sessions.find((s) => s.id === hub.activeSessionId)?.status).toBe('idle');
  });

  it('演示输出里逐题独立（不是同一份文本复读）', () => {
    const a = buildDemoResearchOutput('题目一');
    const b = buildDemoResearchOutput('题目二');
    expect(a).toContain('题目一');
    expect(b).toContain('题目二');
    expect(a).not.toBe(b);
  });
});

describe('runResearchAgents · 真实模式（注入 runTurn）', () => {
  it('并行调度：k 个子任务全部进入后再逐一放行（非串行）', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runTurn = async (prompt: string): Promise<string> => {
      started.push(prompt);
      await gate;
      return `结论：${prompt.length}`;
    };
    const pending = runResearchAgents('单主题调研任务', { k: 3, providerChoice: realChoice(), runTurn });
    // 三个子代理应已同时挂起（若为串行，此处永远等不到第 3 个）
    await vi.waitFor(() => expect(started).toHaveLength(3), { timeout: 2000 });
    expect(started[0]).toContain('从方法角度切入');
    release();
    const results = await pending;
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.topic)).toEqual(splitResearchTopics('单主题调研任务', 3));
    expect(lastAssistant()).toContain('3/3 个子任务成功');
  });

  it('部分失败：失败题输出中文错误说明，其余子任务不受影响', async () => {
    const runTurn = async (prompt: string): Promise<string> => {
      if (prompt.includes('实验')) throw new Error('网络超时');
      return '正常产出';
    };
    const results = await runResearchAgents('调研任务X', { providerChoice: realChoice('glm-4.6'), runTurn });
    expect(results).toHaveLength(3);
    const failed = results.find((r) => r.output.startsWith(FAILED_TOPIC_PREFIX))!;
    expect(failed).toBeDefined();
    expect(failed.output).toContain('网络超时');
    expect(failed.output).toContain('不受影响');
    expect(results.filter((r) => r.output === '正常产出')).toHaveLength(2);
    expect(lastAssistant()).toContain('2/3 个子任务成功');
  });

  it('用量记录：每个完成的子代理记一条 research 事件（model/token/延迟）', async () => {
    const runTurn = async (prompt: string): Promise<string> => `答:${'x'.repeat(20)}`;
    await runResearchAgents('主题Z', { k: 2, providerChoice: realChoice('glm-4.6'), runTurn });
    const events = useAgentUsageStore.getState().events;
    expect(events).toHaveLength(2);
    for (const e of events) {
      expect(e.kind).toBe('research');
      expect(e.model).toBe('glm-4.6');
      expect(e.inputTokens).toBeGreaterThan(0); // prompt 字符折半估算
      expect(e.outputTokens).toBeGreaterThan(0);
      expect(e.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('会话 streaming 时静默返回空数组（不追加消息）', async () => {
    useAgentHubStore.setState({
      activeSessionId: 's-busy',
      sessions: [{ id: 's-busy', title: 'busy', messages: [], providerId: 'host', status: 'streaming' }],
    });
    const runTurn = vi.fn(async () => '不应被调用');
    const out = await runResearchAgents('任务', { providerChoice: realChoice(), runTurn });
    expect(out).toEqual([]);
    expect(runTurn).not.toHaveBeenCalled();
    const session = useAgentHubStore.getState().sessions.find((s) => s.id === 's-busy')!;
    expect(session.messages).toEqual([]);
  });

  // v7.8.0 审计回归：并行研究同样把会话置为 streaming，停止按钮必须真的能停
  it('停止按钮（abortChat）可中止并行研究：子任务收到信号、会话正常收尾', async () => {
    const { abortChat } = await import('./aiActions');
    const signals: AbortSignal[] = [];
    const runTurn = (_prompt: string, signal: AbortSignal): Promise<string> =>
      new Promise<string>((_, reject) => {
        signals.push(signal);
        signal.addEventListener('abort', () => reject(new Error('已中止')), { once: true });
      });

    const pending = runResearchAgents('中止测试任务', { k: 2, providerChoice: realChoice(), runTurn });
    await vi.waitFor(() => expect(signals).toHaveLength(2), { timeout: 2000 });
    abortChat(); // 回归：此前研究没接 chatAbort，停止按钮点了没反应

    const results = await pending; // 不应挂起
    expect(signals.every((s) => s.aborted)).toBe(true);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.output.startsWith(FAILED_TOPIC_PREFIX))).toBe(true);
    expect(lastAssistant()).toContain('并行研究已中止');
    const hub = useAgentHubStore.getState();
    expect(hub.sessions.find((s) => s.id === hub.activeSessionId)!.status).toBe('idle');
  });
});
