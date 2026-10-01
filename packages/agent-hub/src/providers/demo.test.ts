/**
 * ScriptedDemoProvider 测试：关键词路由（W6/W7/W10/W12/W3 各步骤 + 通用 chat）、
 * 流式协议（text-delta 拼接完整性 / 块大小 / done+usage）、演示声明、
 * W12 草稿 citekey 白名单（引用护栏可过）、中止信号、路由优先级（deps 头碰撞）。
 * 测试用 prompt 文本取自 workflow/builtin 的 YAML 步骤原文，保证与真实运行时一致。
 */
import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@scholarforge/shared';
import {
  DEMO_DISCLAIMER,
  DEMO_LIBRARY_CITEKEYS,
  ScriptedDemoProvider,
  pickDemoScript,
} from './demo';
import type { ChatEvent, ChatRequest } from './types';

/** 关闭打字延时，测试只验证协议与路由 */
const fast = () => new ScriptedDemoProvider({ minDelayMs: 0, maxDelayMs: 0 });

function msg(content: string): AgentMessage {
  return { id: 'u1', role: 'user', content, createdAt: 0 };
}

const req = (content: string, over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [msg(content)],
  model: 'demo',
  ...over,
});

async function collect(content: string): Promise<{ events: ChatEvent[]; text: string }> {
  const events: ChatEvent[] = [];
  for await (const ev of fast().complete(req(content))) events.push(ev);
  return { events, text: events.filter((e) => e.type === 'text-delta').map((e) => (e as { delta: string }).delta).join('') };
}

// —— 取自 builtin YAML 的步骤 prompt 原文（节选，保留路由关键词与其自然上下文）——
const P_W6_PREP = '你在为目标会议/期刊 ACL 2026 的审稿仿真准备上下文。\n待审稿件：……';
const P_W6_R1 = '你是方法严格派审稿人（Reviewer 1）：只关心方法本身的正确性与严谨性。\n基于审稿简报评审稿件……';
const P_W6_R2 = '你是领域专家审稿人（Reviewer 2）：关心新颖性与文献定位。\n基于审稿简报评审稿件……';
const P_W6_R3 = '你是统计与复现审查（Reviewer 3）：只关心实验结论是否可信、他人能否复现。\n基于审稿简报评审稿件……';
const P_W6_META = '你是 meta-reviewer（领域主席）：汇总三份审稿意见，等待作者（用户）确认后再进入修改建议环节。';
const P_W6_REVISE =
  '用户已在检查点完成确认（见 checkpointInput：勾选的弱项与取舍意见）。\n请针对用户选中的弱项生成可执行修改方案：';
const P_W7_PARSE = '把下面的审稿意见逐条拆解为编号条目（R1.1、R1.2、R2.1…按审稿人分组）。';
const P_W7_FINALIZE = '用户已在检查点确认取舍（见 checkpointInput）。\n按审稿人分组整合最终 rebuttal：开头总述……';
const P_W10_REPORT = '汇总前三步结果，生成投稿前 checklist 报告：\n1. 总体结论：可提交 / 修复后可提交 / 暂不可提交。';
const P_W12_SEARCH = '围绕主题在文献库内检索并分组，为 Related Work 做准备。\n综述主题：大语言模型辅助的科研写作';
const P_W12_DRAFT = '基于上一步的分组清单与要点，起草 Related Work 章节：\n1. 每组写一段叙事性综述……';
const P_W3_REWRITE = '基于上一步的问题清单，对文本做最小必要修改，产出 unified diff。\n\n约束：……';
const P_GENERIC = '帮我把这段话润色一下';

describe('ScriptedDemoProvider 元数据与演示声明', () => {
  it("id='demo'，label 标注演示模式", () => {
    const p = fast();
    expect(p.id).toBe('demo');
    expect(p.label).toContain('演示模式');
  });

  it('所有输出开头带统一演示声明行', async () => {
    for (const prompt of [P_W6_R1, P_W10_REPORT, P_W12_DRAFT, P_GENERIC]) {
      const { text } = await collect(prompt);
      expect(text.startsWith(DEMO_DISCLAIMER)).toBe(true);
    }
  });
});

describe('W6 三审稿人仿真路由', () => {
  it('方法严格派审稿人 → 结构化意见（Summary/优点/缺点/Questions/score band）', async () => {
    const { text } = await collect(P_W6_R1);
    expect(text).toContain('## Summary');
    expect(text).toContain('## 优点');
    expect(text).toContain('## 缺点');
    expect(text).toContain('## Questions');
    expect(text).toContain('Score band');
    expect(text).toContain('borderline accept');
    // 内容质量抽查：意见须具体（有可执行建议与实验评论），不是空话
    expect(text).toContain('可执行建议');
    expect(text).toContain('嵌入模型');
  });

  it('领域专家审稿人 → 新颖性与文献定位意见', async () => {
    const { text } = await collect(P_W6_R2);
    expect(text).toContain('新颖性');
    expect(text).toContain('文献');
    expect(text).toContain('weak accept');
    expect(text).not.toContain('borderline accept');
  });

  it('统计与复现审查 → 实验严谨性与复现要素意见', async () => {
    const { text } = await collect(P_W6_R3);
    expect(text).toContain('mean±std');
    expect(text).toContain('显著性');
    expect(text).toContain('复现要素');
    expect(text).toContain('borderline');
  });

  it('Meta-Review → 汇总 + 三档优先级清单 + 审稿人分歧', async () => {
    const { text } = await collect(P_W6_META);
    expect(text).toContain('必须修改');
    expect(text).toContain('建议修改');
    expect(text).toContain('可答辩');
    expect(text).toContain('审稿人分歧');
    expect(text).toContain('来源：R');
  });

  it('修改建议步骤 → 逐弱项方案（文本/图表/实验三类 + 待办）', async () => {
    const { text } = await collect(P_W6_REVISE);
    expect(text).toContain('逐弱项');
    expect(text).toContain('弱项 1');
    expect(text).toContain('弱项 3');
    expect(text).toContain('补充实验清单');
    expect(text).toContain('剩余待办');
  });

  it('prep 步骤 → 审稿简报（稿件要点/相关工作清单/评审侧重点）', async () => {
    const { text } = await collect(P_W6_PREP);
    expect(text).toContain('审稿简报');
    expect(text).toContain('稿件要点');
    expect(text).toContain('vaswani2017attention');
  });
});

describe('W7 Rebuttal 路由（W6 产物的下游链路）', () => {
  it('逐条解析 → 编号条目清单', async () => {
    const { text } = await collect(P_W7_PARSE);
    expect(text).toContain('R1.1');
    expect(text).toContain('R3.4');
    expect(text).toContain('类型：实验补充');
  });

  it('整合最终 rebuttal → 按审稿人分段 + 修改清单', async () => {
    const { text } = await collect(P_W7_FINALIZE);
    expect(text).toContain('## 审稿人一');
    expect(text).toContain('## 审稿人二');
    expect(text).toContain('## 审稿人三');
    expect(text).toContain('修改清单汇总');
  });
});

describe('W10 预提交自检路由', () => {
  it('report 步骤 → 三态清单：总体需人工判断、6–8 条目、建议行与 main.tex 行号定位', async () => {
    const { text } = await collect(P_W10_REPORT);
    expect(text).toContain('总体结论：需人工判断');
    const items = text.match(/^- (?:✅|❌|⚠️)/gm) ?? [];
    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length).toBeLessThanOrEqual(8);
    expect(text).toContain('→ 建议');
    expect(text).toMatch(/main\.tex:\d+/);
    // 三种状态都有
    expect(items.some((l) => l.includes('✅'))).toBe(true);
    expect(items.some((l) => l.includes('❌'))).toBe(true);
    expect(items.some((l) => l.includes('⚠️'))).toBe(true);
  });
});

describe('W12 相关工作综述路由', () => {
  it('search 步骤 → 分组清单（含全部库内 citekey）', async () => {
    const { text } = await collect(P_W12_SEARCH);
    expect(text).toContain('分组清单');
    expect(text).toContain('组 A');
    for (const key of DEMO_LIBRARY_CITEKEYS) expect(text).toContain(key);
  });

  it('draft 步骤 → Related Work LaTeX 草稿（\\cite + 依据页码注释）', async () => {
    const { text } = await collect(P_W12_DRAFT);
    expect(text).toContain('\\section{Related Work}');
    expect(text).toContain('\\cite{vaswani2017attention}');
    expect(text).toContain('% [vaswani2017attention p.5998]');
    expect(text).toContain('% [brown2020language p.1877]');
  });

  it('draft 草稿的行内引用全部在库内白名单中（引用护栏可过）', async () => {
    const body = pickDemoScript(P_W12_DRAFT);
    const used = new Set<string>();
    for (const m of body.matchAll(/(?<![![\[])\[([A-Za-z0-9_.:+-]{2,})(?:\s+p\.\s*(\d+))?\](?!\()/g)) {
      used.add(m[1] ?? '');
    }
    expect(used.size).toBeGreaterThan(0);
    for (const key of used) expect(DEMO_LIBRARY_CITEKEYS).toContain(key);
    for (const key of DEMO_LIBRARY_CITEKEYS) expect(used.has(key)).toBe(true);
  });

  it('confirm/apply 步骤各自路由到对应脚本', async () => {
    expect((await collect('自查草稿后停在检查点等待作者确认：逐条核对……')).text).toContain('自查清单');
    expect((await collect('按意见修订草稿并落盘：先调用 snapshot.create……')).text).toContain('插入说明');
  });
});

describe('W3 润色与通用对话路由', () => {
  it('W3 rewrite → unified diff 示范 + 逐处修改理由', async () => {
    const { text } = await collect(P_W3_REWRITE);
    expect(text).toContain('--- a/sections/intro.tex');
    expect(text).toContain('+++ b/sections/intro.tex');
    expect(text).toContain('@@ ');
    expect(text).toContain('修改的理由');
  });

  it('通用对话 → 演示模式说明 + 配置引导，绝不回显用户输入', async () => {
    const { text } = await collect(P_GENERIC);
    expect(text).toContain('演示模式');
    expect(text).toContain('设置 → 模型服务');
    expect(text).not.toContain(P_GENERIC); // 不是 EchoProvider 式回显
    expect(text.trim().length).toBeGreaterThan(50);
  });

  it('未收录脚本的工作流步骤（W2/W11 形态）→ 步骤级说明而非对话文案', () => {
    const w2Collect = pickDemoScript('你正在为论文的一节「引言」收集写作素材。\n请执行：\n1. 调用 project.context……');
    expect(w2Collect).toContain('还没有收录演示脚本');
    expect(pickDemoScript(P_GENERIC)).not.toContain('还没有收录演示脚本');
  });
});

describe('流式协议', () => {
  it('text-delta 拼接等于全文（声明 + 脚本），块数 > 5 且每块 ≤ 20 字符，done 携带 usage', async () => {
    const { events, text } = await collect(P_W6_R2);
    const deltas = events.filter((e) => e.type === 'text-delta') as Array<{ type: 'text-delta'; delta: string }>;
    expect(deltas.length).toBeGreaterThan(5);
    for (const d of deltas) expect(Array.from(d.delta).length).toBeLessThanOrEqual(20);
    expect(text).toBe(`${DEMO_DISCLAIMER}\n\n${pickDemoScript(P_W6_R2)}`);
    const last = events[events.length - 1];
    expect(last?.type).toBe('done');
    if (last?.type === 'done') {
      expect(last.usage?.outputTokens).toBeGreaterThan(0);
      expect(last.usage?.inputTokens).toBe(P_W6_R2.length);
    }
    // 演示 provider 绝不产生工具调用
    expect(events.some((e) => e.type === 'tool-call')).toBe(false);
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('中止信号：提前 abort 时不产出文本，仅收尾 done', async () => {
    const events: ChatEvent[] = [];
    const controller = new AbortController();
    controller.abort();
    for await (const ev of fast().complete(req(P_W6_R1, { signal: controller.signal }))) events.push(ev);
    expect(events.filter((e) => e.type === 'text-delta')).toHaveLength(0);
    expect(events[events.length - 1]?.type).toBe('done');
  });
});

describe('路由优先级（deps 头与前置输出拼进 user 消息的场景）', () => {
  it('revise 步骤消息含 deps 头「【Meta-Review 汇总的结论】」仍路由到逐弱项方案', () => {
    const message = `${P_W6_REVISE}\n\n【Meta-Review 汇总的结论】\n三位评审意见已合并，整体倾向 borderline……`;
    expect(pickDemoScript(message)).toContain('逐弱项');
  });

  it('meta 步骤消息含「审稿人三：统计与复现审查」的 deps 头仍路由到汇总', () => {
    const message = `${P_W6_META}\n\n【审稿人三：统计与复现审查的结论】\n（意见正文）\n【审稿人一：方法严格派的结论】\n（意见正文）`;
    expect(pickDemoScript(message)).toContain('优先级清单');
  });

  it('W12 confirm 消息含 deps 头「【起草 Related Work 的结论】」仍路由到自查清单', () => {
    const message = `自查草稿后停在检查点等待作者确认：逐条核对草稿中的引用。\n\n【起草 Related Work 的结论】\n（草稿正文）`;
    expect(pickDemoScript(message)).toContain('自查清单');
  });

  it('只按最后一条 user 消息路由（system 与历史消息不参与）', async () => {
    const events: ChatEvent[] = [];
    for await (const ev of fast().complete(
      req(P_W6_R3, {
        messages: [
          { id: 'sys', role: 'system', content: `系统提示：${P_W12_DRAFT}`, createdAt: 0 },
          { id: 'h1', role: 'user', content: P_W10_REPORT, createdAt: 1 },
          { id: 'h2', role: 'assistant', content: '（历史回复）', createdAt: 2 },
          msg(P_W6_R3),
        ],
      }),
    )) {
      events.push(ev);
    }
    const text = events.map((e) => (e.type === 'text-delta' ? e.delta : '')).join('');
    expect(text).toContain('复现要素');
  });
});
