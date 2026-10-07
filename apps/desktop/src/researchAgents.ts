/**
 * 并行研究子代理（功能 F）：把一个复杂调研任务拆成 k 个互补子问题，交给同一
 * provider 的多个「子代理」并行（Promise.allSettled）逐题生成，最后把结果汇总为
 * markdown 追加进当前 Agent 会话（useAgentHubStore.appendDelta）。
 *
 * - splitResearchTopics：纯函数拆题。任务里已有明显多主题（顿号/逗号/分号分隔
 *   ≥ k 个片段）则直接采用；否则用「方法/实验/应用…」角度模板 × 任务关键词生成
 *   互补子问题；
 * - buildSubAgentPrompt：纯函数拼子代理 prompt（子问题 + 共享上下文 + 输出契约）；
 * - runResearchAgents：运行入口。resolveProvider 判定形态——演示模式（real:false）
 *   直接返回每题预制演示文本（零配置可体验，demo 路由关键词「并行研究子任务」
 *   由集成者在 ScriptedDemoProvider 的 ROUTES 补充）；真实模式走 runAgentTurn
 *   （tools 空 = 无工具、纯检索式问答），单题失败输出中文错误且不影响其他子任务。
 *   每个子代理完成即把用量记入 agentUsage（kind='research'；token 数按字符折半
 *   估算——面板全程标注「估算，非账单」）。
 */

import { useAgentHubStore } from '@lemma/agent-hub';
import { bindChatAbort, resolveProvider, type ProviderChoice } from './aiActions';
import { buildContextPackMd, runAgentTurn } from './agentTools';
import { t } from './i18n';
import { useSettingsStore } from './state/settingsStore';
import { useAgentUsageStore } from './state/agentUsage';
import { useWorkspaceStore } from './state/workspaceStore';

/** 角度模板（k ≤ 8 时按序取用；「方法/实验/应用」为前三，与需求约定一致） */
export const RESEARCH_ANGLES: readonly string[] = [
  '方法',
  '实验',
  '应用',
  '相关工作',
  '局限与风险',
  '数据与评测',
  '写作与表达',
  '可复现性',
];

/** 拆题时忽略的虚词/泛化动词（中英混合，避免关键词只剩 stopwords） */
const STOPWORDS = new Set([
  '的', '了', '和', '与', '及', '或', '在', '对', '进行', '如何', '什么', '怎么',
  '我', '请', '帮', '关于', '以及', '一个', '这个', '那个', '一下', '目前', '现在',
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'how', 'what',
  'is', 'are', 'can', 'should',
]);

/** 任务主题分隔符：顿号 / 中英逗号 / 中英分号 / 换行 */
const TOPIC_SEPARATOR_RE = /[、，,；;\n]+/;

/** 关键词启发：按空白/标点切词，过滤 stopwords 与过短词，保留出现顺序（cap 6） */
function extractKeywords(task: string): string[] {
  const tokens = task
    .replace(/[（）()【】[\]{}""''「」.,!?。！？：:；;、，,\/\\|*#>-]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const tok of tokens) {
    const latin = tok.match(/[A-Za-z0-9-]+/g)?.join(' ') ?? '';
    const cjk = tok.replace(/[A-Za-z0-9-]+/g, '').trim();
    const pieces = [
      ...(latin ? latin.toLowerCase().split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w)) : []),
      ...(cjk && cjk.length >= 2 && !STOPWORDS.has(cjk) ? [cjk] : []),
    ];
    for (const p of pieces) {
      if (!out.includes(p)) out.push(p);
      if (out.length >= 6) return out;
    }
  }
  return out;
}

/**
 * 把调研任务拆为 k 个互补子问题（纯函数）：
 * 1. 任务内已有 ≥ k 个分隔符切出的主题 → 直接用（截取前 k 个）；
 * 2. 有 2 ~ k-1 个主题 → 用这些主题，缺额用角度模板补足；
 * 3. 单主题 → 全部用角度模板生成（方法/实验/应用… 前缀 × 任务关键词）。
 * k 钳制在 [1, 8]；空任务返回单个占位子问题（调用方不炸）。
 */
export function splitResearchTopics(task: string, k = 3): string[] {
  const n = Math.max(1, Math.min(RESEARCH_ANGLES.length, Math.floor(k)));
  const trimmed = task.trim();
  if (!trimmed) return ['（未提供研究任务）'];

  const parts = [...new Set(trimmed.split(TOPIC_SEPARATOR_RE).map((p) => p.trim()).filter(Boolean))];
  if (parts.length >= n) return parts.slice(0, n);

  const keywords = extractKeywords(trimmed);
  const subject = (keywords.length > 0 ? keywords.join('、') : trimmed).slice(0, 48);
  // 单一主题：全部用角度模板生成（不把原句直接当一个子问题）；2 ~ k-1 个主题：直用 + 缺额补足
  const topics = parts.length >= 2 ? [...parts] : [];
  for (let i = 0; topics.length < n && i < RESEARCH_ANGLES.length; i++) {
    topics.push(`从${RESEARCH_ANGLES[i]}角度切入：${subject}`);
  }
  return topics.slice(0, n);
}

/**
 * 子代理 prompt（纯函数）：只负责一个子问题 + 共享上下文 + 输出契约。
 * 保持中文（演示路由关键词与真实模型对中文指令均稳定）。
 */
export function buildSubAgentPrompt(topic: string, sharedContext: string): string {
  return [
    '你是 Lemma 的并行研究子代理：只回答分配给你的这一个子问题，独立给出结论，不假设能看到其他子代理的产出。',
    '',
    '## 你负责的子问题',
    topic,
    '',
    '## 共享上下文（所有子代理一致）',
    sharedContext.trim() || '（无额外上下文）',
    '',
    '## 输出要求',
    '- 中文 markdown：先用 2–3 句给出结论摘要，再列要点；',
    '- 只围绕本子问题展开，不复述任务全文；',
    '- 提到文献时只使用共享上下文中出现过的 citekey，没有就明确写「未在本地文献中找到」。',
  ].join('\n');
}

/** 演示模式的预制输出（每题一份；首段含 demo 路由关键词「并行研究子任务」） */
export function buildDemoResearchOutput(topic: string): string {
  return [
    '> ⚠️ 演示数据（内置示例，配置模型服务后为真实 AI 生成）',
    '',
    `**并行研究子任务**：${topic}`,
    '',
    '结论摘要（示例）：该子任务在演示项目语境下有两条可直接落笔的结论，详见要点。',
    '',
    '1. 库内直接相关文献 2 篇（vaswani2017attention、brown2020language），均支持「上下文组装质量决定下游产出上限」的判断。',
    '2. 主流做法分两类：流水线式（阶段可审计、便于 diff 审批）与端到端式（上下文更完整但难归因）；演示项目采用前者。',
    '3. 主要风险是评估口径不统一——建议正文采用「结论摘要 + 依据列表」两段式写法，便于审稿人逐条核对。',
  ].join('\n');
}

/** 子代理共用的 system prompt（简短：角色 + 输出契约 + 引用护栏） */
const RESEARCH_SYSTEM =
  '你是 Lemma 的并行研究子代理：只回答分配给你的子问题，输出简洁中文 markdown（先结论摘要、后要点列表）；引用文献只用给定上下文中出现过的 citekey，不得编造。';

export interface ResearchAgentResult {
  topic: string;
  output: string;
}

export interface ResearchAgentsOptions {
  /** 拆几个子任务（缺省 3，钳制 [1, 8]） */
  k?: number;
  /** 测试注入：替换 resolveProvider 的结果（生产不传） */
  providerChoice?: ProviderChoice;
  /** 测试注入：替换单题生成函数（生产不传；缺省 = 演示文本 或 runAgentTurn 无工具） */
  runTurn?: (prompt: string, signal: AbortSignal) => Promise<string>;
}

/** 失败子任务的中文输出前缀（汇总与结果一致，UI/测试可识别） */
export const FAILED_TOPIC_PREFIX = '【子任务失败】';

/** 记一条 research 用量（token 按字符折半估算，见文件头说明） */
function recordResearchUsage(model: string, prompt: string, output: string, latencyMs: number): void {
  useAgentUsageStore.getState().record({
    kind: 'research',
    model,
    inputTokens: Math.ceil(prompt.length / 2),
    outputTokens: Math.ceil(output.length / 2),
    latencyMs,
  });
}

/**
 * 运行并行研究：拆题 → 逐题并行生成（allSettled，单题失败不中断其他）→
 * 汇总 markdown 追加进当前 Agent 会话（appendDelta 到 sendMessage 创建的
 * 新 assistant 占位消息）→ finishSession('idle')。返回与拆题同序的结果数组
 * （失败题 output 为中文错误说明）。
 * 会话正在 streaming 时静默返回 []（与 sendChatMessage 的守卫一致）。
 */
export async function runResearchAgents(
  task: string,
  opts: ResearchAgentsOptions = {},
): Promise<ResearchAgentResult[]> {
  const topics = splitResearchTopics(task, opts.k);
  const choice = opts.providerChoice ?? resolveProvider();

  const store = () => useAgentHubStore.getState();
  let sessionId = store().activeSessionId;
  if (!sessionId) sessionId = store().newSession('host', useWorkspaceStore.getState().projectName || undefined, t('sessions.newSession', useSettingsStore.getState().language));
  if (store().sessions.find((s) => s.id === sessionId)?.status === 'streaming') return [];

  store().sendMessage(sessionId, `【并行研究】${task.trim()}`);
  store().appendDelta(
    sessionId,
    `\n⚙️ 并行研究启动：已拆分为 ${topics.length} 个子任务（${
      choice.real ? `${choice.label} 并行执行中` : '当前为演示模式，输出内置示例'
    }）。\n`,
  );

  // v7.8.0：把中止入口交给停止按钮（chatAbort）——并行研究同样把会话置为
  // streaming，此前停止按钮点了不生效，长任务只能干等
  const abort = new AbortController();
  const unbindAbort = bindChatAbort(abort);

  // 共享上下文只组一次（真实模式才需要；组装失败不阻塞研究，回退为空）
  let sharedContext = '';
  if (choice.real) {
    try {
      sharedContext = await buildContextPackMd(task);
    } catch {
      sharedContext = '';
    }
  }

  const jobs = topics.map(async (topic) => {
    const prompt = buildSubAgentPrompt(topic, sharedContext);
    const startedAt = Date.now();
    // 单题生成：真实模式 runAgentTurn（无工具）；演示模式每题一份预制演示文本
    const output = opts.runTurn
      ? await opts.runTurn(prompt, abort.signal)
      : choice.real
        ? await runAgentTurn({
            provider: choice.provider,
            model: choice.model,
            system: RESEARCH_SYSTEM,
            history: [],
            user: prompt,
            tools: [], // 研究子代理无工具：纯检索式问答，避免写级审批阻塞并行
            signal: abort.signal, // v7.8.0：停止按钮可中止
          })
        : buildDemoResearchOutput(topic); // 失败不抛（同步生成）；真实模式的异常由下方统一处理
    const latencyMs = Date.now() - startedAt;
    if (choice.real) recordResearchUsage(choice.model, prompt, output, latencyMs);
    store().appendDelta(sessionId, `✅ 子任务完成：${topic}\n`);
    return { topic, output };
  });

  const settled = await Promise.allSettled(jobs);
  const results: ResearchAgentResult[] = settled.map((r, i) => {
    const topic = topics[i] ?? `子任务 ${i + 1}`;
    if (r.status === 'fulfilled') return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    store().appendDelta(sessionId, `❌ 子任务失败：${topic}\n`);
    return {
      topic,
      output: `${FAILED_TOPIC_PREFIX}${topic}：${reason}（其余子任务不受影响，可稍后单独重试本子问题）`,
    };
  });

  const okCount = results.filter((r) => !r.output.startsWith(FAILED_TOPIC_PREFIX)).length;
  const summary = [
    '\n---\n',
    `## 📡 并行研究汇总（${okCount}/${results.length} 个子任务成功）`,
    '',
    ...results.flatMap((r) => [`### ${r.topic}`, '', r.output, '']),
    choice.real ? '' : '> 以上为演示模式的内置示例数据；配置模型服务后重跑即为真实并行生成。\n',
  ].join('\n');
  store().appendDelta(sessionId, summary);
  // v7.8.0：用户中止过则如实标注（未完成的子任务以失败说明列出）
  if (abort.signal.aborted) store().appendDelta(sessionId, '\n⏹️ 并行研究已中止（已完成的子任务产出见上方汇总）。\n');
  store().finishSession(sessionId, 'idle');
  unbindAbort();
  return results;
}
