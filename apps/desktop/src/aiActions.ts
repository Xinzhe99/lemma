/**
 * AI 动作层：会话发送（Context Pack 注入 + 工具循环 + 引用核查护栏）、
 * 选区润色（走 diff 审批提案）、选中即问快捷动作、一键修编译错误
 * （读诊断 → 组装 prompt → 会话工具循环，tex.edit 落进阻塞审批卡）、
 * 计划模式（runPlannedTask 规划 → executePlan 逐步执行，见文末分区注释）。
 * AgentPanel 与编辑器选中工具条共用，避免循环依赖。
 */

import {
  OpenAICompatibleProvider,
  ScriptedDemoProvider,
  useAgentHubStore,
  type ChatProvider,
} from '@scholarforge/agent-hub';
import { validateCitations } from '@scholarforge/knowledge';
import { useSettingsStore, type Language } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { useLibraryStore } from './state/libraryStore';
import { useProposalStore } from './state/proposalStore';
import { bibCitekeys } from './projectDoc';
import { resolveCompileEntry } from './compileAction';
import { CliAgentProvider, isCliAgentAvailable } from './cliAgent';
import { ENABLED_TOOLS, buildContextPackMd, runAgentTurn } from './agentTools';
import { rejectPendingApproval } from './approval';
import { buildPolishPrompt, extractLatexBody, rulePolish } from './polish';
import { buildPlanPrompt, buildStepPrompt, parsePlan, type Plan } from './planMode';
import { useAgentPlansStore } from './state/agentPlans';

export const CITATION_RULE =
  '\n\n## 引用规则（必须遵守）\n引用文献时只能使用上文「相关文献」中列出的 citekey，格式 [citekey p.页码]；禁止编造未列出的引用。\n\n## 工具使用\n可用工具：library.search_fulltext（检索本地文献库）、project.context（项目上下文）、citation.validate（引用核验）、tex.last_errors（编译日志）、tex.edit（修改稿件，需用户审批 diff 后生效）、citation.add（添加参考文献，需审批）、snapshot.create（创建快照）、tex.compile（触发编译）。写级操作会弹出 diff 审批卡，用户裁决结果会回传给你；被拒绝时请勿重试同一修改。\n\n（演示模式说明：若当前未配置模型服务，会话与工作流各步骤的输出为内置示例数据——每份开头有「演示数据」声明——仅用于零配置体验流程，不代表模型真实能力；配置后即为真实生成。）';

export interface ProviderChoice {
  provider: ChatProvider;
  model: string;
  label: string;
  real: boolean;
}

// ---------------------------------------------------------------------------
// 双语提示（D15）：润色流程的 setNote 消息。zh 保持原文，en 为准确翻译。
// 调用处经 pick(useSettingsStore.getState().language) 在发消息那一刻动态读取语言，
// 避免模块加载或长生命周期闭包造成的语言过期。
// ---------------------------------------------------------------------------

interface PolishDict {
  emptySelection: string;
  needTex: string;
  selectionMismatch: string;
  noChangeNeeded: string;
  polishFailed: (detail: string) => string;
}

export const L: Record<Language, PolishDict> = {
  zh: {
    emptySelection: '选区为空',
    needTex: '请先在编辑器打开一个 .tex 文件',
    selectionMismatch: '选区与文件内容不匹配（文件可能已变化），请重新选择',
    noChangeNeeded: '选中文本无需修改（离线规则未命中；配置模型服务可获得深度润色）',
    polishFailed: (detail) => `润色失败：${detail}`,
  },
  en: {
    emptySelection: 'The selection is empty',
    needTex: 'Open a .tex file in the editor first',
    selectionMismatch: 'The selection no longer matches the file content (the file may have changed); please reselect',
    noChangeNeeded: 'No changes needed for the selection (offline rules found nothing to fix; configure a model provider for deeper polishing)',
    polishFailed: (detail) => `Polish failed: ${detail}`,
  },
};

/** 按语言取文案（语言由调用处在发消息时动态读取） */
export function pick(lang: Language): PolishDict {
  return L[lang];
}

export function resolveProvider(): ProviderChoice {
  const s = useSettingsStore.getState();
  const cfg = s.providers.find((p) => p.id === s.activeProviderId);
  const hasApi = !!cfg && cfg.baseUrl.trim().length > 0 && cfg.apiKey.trim().length > 0;
  // CLI agent 桥（v1.5.0）：可用条件 = 已启用 + 命令非空 + 桌面形态；引擎选择 auto/api/cli
  const cliReady = s.cliAgent.enabled && s.cliAgent.command.trim().length > 0 && isCliAgentAvailable();
  if (hasApi && s.agentEngine !== 'cli') {
    return {
      provider: new OpenAICompatibleProvider({
        id: cfg!.id,
        label: cfg!.label,
        baseUrl: cfg!.baseUrl.trim(),
        apiKey: cfg!.apiKey.trim(),
        fetchFn: (url, init) => fetch(url, init),
      }),
      model: cfg!.model.trim() || 'default',
      label: `${cfg!.label} · ${cfg!.model || 'default'}`,
      real: true,
    };
  }
  // CLI agent 桥（显式选择 cli，或 auto 且无 API 配置）：一次性进程调用，无工具协议
  if (cliReady && (s.agentEngine === 'cli' || !hasApi)) {
    const cli = new CliAgentProvider(s.cliAgent);
    return { provider: cli, model: s.cliAgent.command, label: cli.label, real: true };
  }
  // 零配置回退：ScriptedDemoProvider 按消息关键词输出预写的高质量演示内容
  // （W6/W7/W10/W12/W3 逐步脚本 + 通用说明），替代旧 EchoProvider 的纯回显。
  // real 保持 false：工具调用不启用，演示只覆盖文本输出；AgentPanel 的
  // providerLabel 取 provider.label，自然显示「演示模式（内置示例数据）」。
  const demo = new ScriptedDemoProvider();
  return { provider: demo, model: 'demo', label: demo.label, real: false };
}

/** 发送会话消息：组装上下文 → 流式回复（真实 provider 带工具多轮）→ 引用核查护栏 */
let chatAbort: AbortController | null = null;

/** 中止当前会话生成（停止按钮） */
export function abortChat(): void {
  chatAbort?.abort();
  chatAbort = null;
}

export async function sendChatMessage(text: string): Promise<void> {
  const store = () => useAgentHubStore.getState();
  let sessionId = store().activeSessionId;
  if (!sessionId) sessionId = store().newSession('host');
  const session = store().sessions.find((s) => s.id === sessionId);
  if (session?.status === 'streaming') return;

  const system = (await buildContextPackMd(text)) + CITATION_RULE;
  const history = (store().sessions.find((s) => s.id === sessionId)?.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, -2);
  store().sendMessage(sessionId, text);

  const { provider, model, real } = resolveProvider();
  const abort = new AbortController();
  chatAbort = abort;
  let acc = '';
  try {
    acc = await runAgentTurn({
      provider,
      model,
      system,
      history,
      user: text,
      tools: real ? ENABLED_TOOLS : [],
      signal: abort.signal,
      onDelta: (delta) => store().appendDelta(sessionId, delta),
      onToolCall: (call) => store().appendToolCall(sessionId, call),
      onToolResult: (callId, content) => store().appendToolResult(sessionId, callId, content),
    });
  } catch (e) {
    store().appendDelta(sessionId, `\n\n[调用异常] ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    chatAbort = null;
    // 会话中止/结束时，未决的阻塞审批按拒绝结算，绝不悬空
    rejectPendingApproval('会话已中止或结束，本次修改未生效');
  }

  // 学术诚信护栏：引用核查
  const validKeys = [
    ...new Set([
      ...useLibraryStore.getState().papers.map((p) => p.citekey),
      ...bibCitekeys(useWorkspaceStore.getState().files),
    ]),
  ];
  const check = validateCitations(acc, validKeys);
  if (!check.ok) {
    store().appendDelta(
      sessionId,
      `\n\n---\n⚠️ **引用核查（学术诚信护栏）**：以下引用未在本地文献库或 refs.bib 中找到，疑似幻觉引用，请核实：${check.invalid
        .map((k) => `[${k}]`)
        .join(' ')}`,
    );
  }
  store().finishSession(sessionId, 'idle');
}

/** 润色编辑器选中文本：产生整文件 diff 提案（规则润色离线可用，模型走 runAgentTurn） */
export async function polishSelection(selection: string): Promise<void> {
  const t = pick(useSettingsStore.getState().language);
  const trimmed = selection.trim();
  const proposalStore = useProposalStore.getState();
  if (!trimmed) {
    proposalStore.setNote(t.emptySelection);
    return;
  }
  const ws = useWorkspaceStore.getState();
  const file = ws.activeTab;
  if (!file || !file.endsWith('.tex') || ws.files[file] === undefined) {
    proposalStore.setNote(t.needTex);
    return;
  }
  const before = ws.files[file]!;
  if (!before.includes(selection)) {
    proposalStore.setNote(t.selectionMismatch);
    return;
  }

  const { real, model, provider } = resolveProvider();
  let polished: string;
  let via: string;
  if (real) {
    try {
      const system = await buildContextPackMd('学术润色（选中文本）');
      const reply = await runAgentTurn({
        provider,
        model,
        system,
        history: [],
        user: buildPolishPrompt(selection),
      });
      polished = extractLatexBody(reply);
      via = model;
    } catch (e) {
      proposalStore.setNote(t.polishFailed(e instanceof Error ? e.message : String(e)));
      return;
    }
  } else {
    polished = rulePolish(selection);
    via = '规则润色（离线）';
  }

  if (!polished.trim() || polished.trim() === trimmed) {
    proposalStore.setNote(t.noChangeNeeded);
    return;
  }
  proposalStore.setProposal({
    file,
    before,
    after: before.replace(selection, polished),
    kind: 'polish',
    label: 'AI 润色（选中文本）',
    via,
  });
}

export type QuickAskKind = 'explain' | 'translate' | 'find';

const QUICK_PROMPTS: Record<QuickAskKind, (text: string) => string> = {
  explain: (t) => `请解释以下选中文本的含义与作用（涉及公式时逐项说明符号）：\n\n${t}`,
  translate: (t) =>
    `请把以下选中文本在中英之间互译（英文→中文，中文→英文）：保留所有 LaTeX 命令、数学环境与 \\cite 键不动，只翻译自然语言：\n\n${t}`,
  find: (t) =>
    `请检索本地文献库（可用 library.search_fulltext 工具），推荐与以下选中文本最相关的文献并说明相关性：\n\n${t}`,
};

/** 选中即问：解释 / 翻译 / 找文献，作为会话消息发送 */
export function quickAsk(kind: QuickAskKind, text: string): void {
  void sendChatMessage(QUICK_PROMPTS[kind](text));
}

// ---------------------------------------------------------------------------
// AI 一键修编译错误（P0）：读 compileLog → 解析 error 级诊断 → 组装 prompt
// （错误清单 + 出错文件/入口/活动 .tex 的上下文片段）→ 经 sendChatMessage 走
// 既有会话与工具循环：真实 provider 携带 ENABLED_TOOLS（tex.edit 自动落进
// 阻塞 diff 审批卡，用户裁决后回传模型——产品哲学：AI 只提案，人拍板）；
// 演示模式由 ScriptedDemoProvider 按 prompt 关键词路由（「修复以下 LaTeX
// 编译错误」，demo 脚本由集成者补充，见 demo.ts ROUTES）。
// UI 入口为命令 compile.aiFix（commands.ts，集成者注册），本模块只导出动作。
// ---------------------------------------------------------------------------

/** 单条编译错误（从 compileLog 诊断行解析） */
export interface CompileErrorItem {
  file: string;
  line: number | null;
  message: string;
}

export interface CompileErrorDigest {
  errors: CompileErrorItem[];
  /** 诊断中出现过的文件（按出现顺序去重） */
  files: string[];
}

/** 单条错误上限与清单上限（防失控 prompt：超长日志截断为「前 N 条」） */
const MAX_ERRORS_IN_PROMPT = 30;

/**
 * 解析编译日志中的 error 级诊断行。compileAction.logDiagnostics 的写入格式为
 * `  [severity] file:line message`（file 缺 line 时为 `  [severity] file message`），
 * 真实引擎与模拟引擎两条路径共用该格式，故解析日志行即同时覆盖两者。
 * warning 级忽略（一键修复只针对失败原因）。
 */
export function parseCompileErrors(log: readonly string[]): CompileErrorDigest {
  const errors: CompileErrorItem[] = [];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const raw of log) {
    const m = /^\s*\[error\]\s+(\S+?)(?::(\d+))?\s+(.*)$/.exec(raw);
    if (!m) continue;
    const file = m[1]!;
    const line = m[2] !== undefined && /^\d+$/.test(m[2]) ? Number(m[2]) : null;
    errors.push({ file, line, message: m[3] ?? '' });
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return { errors, files };
}

/** 日志中的诊断文件名解析到工作区实际路径：优先精确匹配，其次补 .tex 扩展名 */
function resolveErrorFile(name: string, files: Record<string, string>): string | null {
  if (files[name] !== undefined) return name;
  if (!name.endsWith('.tex') && files[`${name}.tex`] !== undefined) return `${name}.tex`;
  return null;
}

/** 片段窗口：错误行前后各 PAD 行；同文件多错误合并窗口后按区间输出 */
const CONTEXT_PAD = 12;
/** 单文件片段字符上限与上下文总上限（长文档防 prompt 爆炸） */
const MAX_SNIPPET_CHARS = 4000;
const MAX_CONTEXT_CHARS = 9000;

/**
 * 组装出错文件的上下文片段（纯函数）：错误文件（含 \input 链上能解析到的）
 * 按错误行 ±12 行截取；无行号的文件取开头。焦点文件（入口/活动 .tex）不在
 * 错误清单时补充全文开头，帮助模型看到导言区（宏包加载错误常源于此）。
 */
export function buildFixCompileErrorsContext(
  digest: CompileErrorDigest,
  files: Record<string, string>,
  focus: { entry: string | null; active: string | null },
): string {
  // 文件顺序：出错文件（按出现顺序）→ 入口 → 活动 .tex
  const ordered: string[] = [];
  const push = (p: string | null): void => {
    if (!p || files[p] === undefined || ordered.includes(p)) return;
    ordered.push(p);
  };
  for (const name of digest.files) push(resolveErrorFile(name, files));
  push(focus.entry);
  push(focus.active && focus.active.endsWith('.tex') ? focus.active : null);

  // 每个文件聚合错误行窗口
  const linesByFile = new Map<string, number[]>();
  for (const e of digest.errors) {
    const resolved = resolveErrorFile(e.file, files);
    if (!resolved || e.line === null) continue;
    const list = linesByFile.get(resolved) ?? [];
    list.push(e.line);
    linesByFile.set(resolved, list);
  }

  const parts: string[] = [];
  let total = 0;
  for (const path of ordered) {
    if (total >= MAX_CONTEXT_CHARS) break;
    const content = files[path]!;
    const lines = content.split('\n');
    const errLines = linesByFile.get(path) ?? [];
    let snippet: string;
    if (errLines.length > 0) {
      // 多错误合并窗口：排序后按 [line-PAD, line+PAD] 融合为区间组
      const spans: [number, number][] = [];
      for (const ln of [...errLines].sort((a, b) => a - b)) {
        const start = Math.max(1, ln - CONTEXT_PAD);
        const end = Math.min(lines.length, ln + CONTEXT_PAD);
        const last = spans[spans.length - 1];
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else spans.push([start, end]);
      }
      snippet = spans
        .map(([s, e]) => {
          const body = lines
            .slice(s - 1, e)
            .map((text, i) => `${s + i}: ${text}`)
            .join('\n');
          return `（第 ${s}–${e} 行）\n${body}`;
        })
        .join('\n…\n');
    } else {
      const e = Math.min(lines.length, 60);
      snippet = `（第 1–${e} 行）\n${lines.slice(0, e).map((text, i) => `${i + 1}: ${text}`).join('\n')}`;
    }
    if (snippet.length > MAX_SNIPPET_CHARS) snippet = `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n…（已截断）`;
    parts.push(`### ${path}\n${snippet}`);
    total += snippet.length;
  }
  return parts.join('\n\n');
}

/**
 * 组装一键修编译错误的完整 prompt（保持中文：演示路由关键词为中文原文，
 * 真实模型对中文指令同样稳定）。首句固定含路由关键词「修复以下 LaTeX 编译错误」。
 */
export function buildFixCompileErrorsPrompt(
  digest: CompileErrorDigest,
  files: Record<string, string>,
  focus: { entry: string | null; active: string | null },
): string {
  const list = digest.errors
    .slice(0, MAX_ERRORS_IN_PROMPT)
    .map((e, i) => `${i + 1}. ${e.file}${e.line !== null ? `:${e.line}` : ''} — ${e.message}`)
    .join('\n');
  const more = digest.errors.length > MAX_ERRORS_IN_PROMPT
    ? `\n（共 ${digest.errors.length} 条，仅列出前 ${MAX_ERRORS_IN_PROMPT} 条）`
    : '';
  const context = buildFixCompileErrorsContext(digest, files, focus);
  return [
    '请修复以下 LaTeX 编译错误：逐条分析根因，用 tex.edit 工具给出最小必要的修改；每次修改会弹出 diff 审批卡，由用户裁决后才落盘。',
    '',
    '## 错误清单（最近一次编译的诊断）',
    list + more,
    '',
    '## 相关文件上下文（带行号）',
    context || '（出错文件不在当前工作区）',
    '',
    '## 修改要求',
    '- 只修复导致 error 的最小问题，不要顺手重写无关内容；',
    '- 数学环境内容与既有 \\cite 键保持不动；',
    '- 若错误源于宏包缺失，优先给不引入新依赖的替代写法；',
    '- 全部修改后调用 tex.compile 验证是否恢复。',
  ].join('\n');
}

// 双语文案（D15 同款约定：调用处发消息那一刻动态读取语言）
interface FixCompileDict {
  noErrors: string;
}

export const FIX_L: Record<Language, FixCompileDict> = {
  zh: {
    noErrors: '编译日志中没有 error 级诊断——无需修复。若刚改动过源码，请先重新编译。',
  },
  en: {
    noErrors: 'No error-level diagnostics in the compile log — nothing to fix. Recompile first if you just edited the sources.',
  },
};

/** 按语言取一键修复文案 */
export function pickFix(lang: Language): FixCompileDict {
  return FIX_L[lang];
}

/**
 * AI 一键修编译错误：日志无 error 时直接在提案卡位置给出提示（不发起会话）；
 * 否则组装 prompt 后经 sendChatMessage 进入既有会话流（真实 provider 带
 * ENABLED_TOOLS：tex.edit 阻塞审批、tex.compile 复验；演示模式按关键词路由）。
 */
export async function fixCompileErrors(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  const digest = parseCompileErrors(ws.compileLog);
  if (digest.errors.length === 0) {
    useProposalStore.getState().setNote(pickFix(useSettingsStore.getState().language).noErrors);
    return;
  }
  const prompt = buildFixCompileErrorsPrompt(digest, ws.files, {
    entry: resolveCompileEntry(),
    active: ws.activeTab,
  });
  await sendChatMessage(prompt);
}

// ---------------------------------------------------------------------------
// 计划模式（Plan Mode）：先规划后自主执行的多步能力。
// 复用 Agent 会话通道（乐观消息 + appendDelta 流式 + finishSession），
// 不另起独立模式；计划是「特殊 assistant 消息 + agentPlans store 的执行态」。
// 流程：runPlannedTask（规划轮，纯文本不带工具）→ parsePlan → upsert 到
// agentPlans（键 = 承载计划的 assistant 消息 id）→ 用户在 PlanCard 点
// 【批准并执行】→ executePlan 逐步 buildStepPrompt + runAgentTurn（真实
// provider 带 ENABLED_TOOLS：写级工具照常落阻塞 diff 审批卡，不绕过任何
// 安全机制；演示模式不带工具）→ 每步结果写回 statuses/outputs →
// 全部完结 appendDelta 汇总消息。UI 接线（AgentPanel/命令/演示路由）见报告。
// ---------------------------------------------------------------------------

/** 计划执行轮的 AbortController（abortPlan 停止当前计划；与 chatAbort 同步指向，
 *  让 ChatPanel 的停止按钮在计划轮同样生效） */
let planAbort: AbortController | null = null;

/** 中止当前计划（规划轮或逐步执行轮） */
export function abortPlan(): void {
  planAbort?.abort();
  planAbort = null;
}

/** 挂起中的 executePlan（按 msgId 去重：批准/重试连点不会并发驱动同一计划） */
const executingPlans = new Set<string>();

/** 找到包含指定消息的会话（计划挂在 assistant 消息上，执行态里不冗余存 sessionId） */
function sessionOfMessage(msgId: string): string | null {
  const s = useAgentHubStore
    .getState()
    .sessions.find((sess) => sess.messages.some((m) => m.id === msgId));
  return s?.id ?? null;
}

/**
 * 计划模式入口：用户提出复杂任务 → 规划轮产出计划 JSON。
 * 规划轮为纯文本生成（tools 空：计划只规划不执行），回复流式呈现；
 * parsePlan 命中 → 计划登记到 agentPlans（键 = 刚完成的 assistant 消息 id），
 * 等待用户在 PlanCard 批准；未命中（模型给了普通回答/演示模式未收录路由）→
 * 就此结束，普通回答已流式呈现，不产出计划卡。
 */
export async function runPlannedTask(userRequest: string): Promise<void> {
  const store = () => useAgentHubStore.getState();
  let sessionId = store().activeSessionId;
  if (!sessionId) sessionId = store().newSession('host');
  if (store().sessions.find((s) => s.id === sessionId)?.status === 'streaming') return;

  const contextMd = await buildContextPackMd(userRequest);
  const system = contextMd + CITATION_RULE;
  // 与 sendChatMessage 一致：历史取除最近一轮外的 user/assistant 消息
  const history = (store().sessions.find((s) => s.id === sessionId)?.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(0, -2);
  store().sendMessage(sessionId, userRequest.trim());

  const { provider, model } = resolveProvider();
  const abort = new AbortController();
  planAbort = abort;
  chatAbort = abort;
  let acc = '';
  try {
    acc = await runAgentTurn({
      provider,
      model,
      system,
      history,
      user: buildPlanPrompt(userRequest, contextMd),
      tools: [], // 规划轮只规划不执行
      signal: abort.signal,
      onDelta: (delta) => store().appendDelta(sessionId, delta),
    });
  } catch (e) {
    store().appendDelta(sessionId, `\n\n[调用异常] ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    if (planAbort === abort) planAbort = null;
    if (chatAbort === abort) chatAbort = null;
    rejectPendingApproval('会话已中止或结束，本次修改未生效');
  }

  const plan = parsePlan(acc);
  if (!plan) {
    store().finishSession(sessionId, 'idle');
    return; // 普通回答：原文已流式呈现，无计划卡
  }

  // msgId 取刚完成的 assistant 消息 id（从 store 读最后一条 assistant）
  const session = store().sessions.find((s) => s.id === sessionId);
  const assistantId = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.id;
  if (assistantId) useAgentPlansStore.getState().upsert(assistantId, plan);
  store().finishSession(sessionId, 'idle');
}

/** 逐步执行的前步产出过滤：只取当前步骤之前、有产出的步骤（buildStepPrompt 内再裁预算） */
function priorOutputsOf(plan: Plan, outputs: Record<string, string>, stepId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of plan.steps) {
    if (s.id === stepId) break;
    if (outputs[s.id]) out[s.id] = outputs[s.id];
  }
  return out;
}

/**
 * 执行（或续跑/重试）一份已批准的计划：从首个 pending/failed 步骤起逐步执行。
 * 每步走 runAgentTurn（真实 provider 带 ENABLED_TOOLS → 写级自动进阻塞审批）；
 * 单步失败 → failed 并停（用户可跳过续跑/重试/中止）；全部完结 → 会话追加汇总
 * 消息「✅ 计划完成：goal（N 步）」。步骤正文不刷进会话（结果落在 PlanCard
 * 清单），工具调用卡附着在计划消息上保留操作轨迹。
 */
export async function executePlan(msgId: string): Promise<void> {
  if (executingPlans.has(msgId)) return; // 并发保护：批准/重试连点只驱动一次
  const plansStore = useAgentPlansStore.getState();
  const execution = plansStore.plans[msgId];
  if (!execution) return;
  const sessionId = sessionOfMessage(msgId);
  if (!sessionId) return;
  if (useAgentHubStore.getState().sessions.find((s) => s.id === sessionId)?.status === 'streaming') return;

  executingPlans.add(msgId);
  const store = () => useAgentHubStore.getState();
  store().finishSession(sessionId, 'streaming');

  const system = (await buildContextPackMd(execution.plan.goal)) + CITATION_RULE;
  const { provider, model, real } = resolveProvider();
  const abort = new AbortController();
  planAbort = abort;
  chatAbort = abort;

  let stopped = false; // 失败/中止后停轮（区别于正常完结）
  let aborted = false;
  try {
    for (;;) {
      const exec = useAgentPlansStore.getState().plans[msgId];
      if (!exec) break; // 计划被清理（新会话等）
      const step = exec.plan.steps.find((s) => (exec.statuses[s.id] ?? 'pending') === 'failed')
        ?? exec.plan.steps.find((s) => (exec.statuses[s.id] ?? 'pending') === 'pending');
      if (!step) break; // 全部 done/skipped：正常完结

      useAgentPlansStore.getState().start(msgId, step.id);
      try {
        const acc = await runAgentTurn({
          provider,
          model,
          system,
          history: [],
          user: buildStepPrompt(exec.plan, step, priorOutputsOf(exec.plan, exec.outputs, step.id), exec.statuses),
          tools: real ? ENABLED_TOOLS : [],
          signal: abort.signal,
          // 步骤正文不进会话（落在 PlanCard）；工具调用卡附着在计划消息上
          onToolCall: (call) => store().appendToolCall(sessionId, call),
          onToolResult: (callId, content) => store().appendToolResult(sessionId, callId, content),
        });
        if (abort.signal.aborted) {
          aborted = true;
          useAgentPlansStore.getState().failStep(msgId, step.id, '已中止：用户停止了计划执行');
          stopped = true;
          break;
        }
        const output = acc.trim() || '（本步无文本产出）';
        // 学术诚信护栏：步骤产出里的引用核查（告警并入本步产出，PlanCard 可见）
        const validKeys = [
          ...new Set([
            ...useLibraryStore.getState().papers.map((p) => p.citekey),
            ...bibCitekeys(useWorkspaceStore.getState().files),
          ]),
        ];
        const check = validateCitations(acc, validKeys);
        const finalOutput = check.ok
          ? output
          : `${output}\n\n⚠️ 引用核查：以下引用未在本地文献库或 refs.bib 中找到，请核实：${check.invalid.map((k) => `[${k}]`).join(' ')}`;
        useAgentPlansStore.getState().finishStep(msgId, step.id, finalOutput);
      } catch (e) {
        useAgentPlansStore.getState().failStep(msgId, step.id, e instanceof Error ? e.message : String(e));
        stopped = true;
        break; // 单步失败 → 停轮，用户决定跳过/重试/中止
      }
    }
  } finally {
    executingPlans.delete(msgId);
    if (planAbort === abort) planAbort = null;
    if (chatAbort === abort) chatAbort = null;
    // 会话中止/结束时，未决的阻塞审批按拒绝结算，绝不悬空
    rejectPendingApproval('计划执行已结束或中止，未决修改未生效');
  }

  const exec = useAgentPlansStore.getState().plans[msgId];
  if (stopped) {
    if (aborted) store().appendDelta(sessionId, `\n\n⏹️ 计划已中止：${execution.plan.goal}`);
  } else if (exec) {
    const total = exec.plan.steps.length;
    const skipped = exec.plan.steps.filter((s) => exec.statuses[s.id] === 'skipped').length;
    store().appendDelta(
      sessionId,
      `\n\n✅ 计划完成：${exec.plan.goal}（${total} 步${skipped > 0 ? `，${skipped} 步跳过` : ''}）`,
    );
  }
  store().finishSession(sessionId, 'idle');
}

/**
 * 跳过失败步骤并续跑剩余步骤（PlanCard【跳过失败步】）。
 * stepId 缺省取第一个 failed 步骤；无失败步骤时仅续跑（等同 executePlan）。
 */
export async function skipFailedStep(msgId: string, stepId?: string): Promise<void> {
  const exec = useAgentPlansStore.getState().plans[msgId];
  if (!exec) return;
  const target =
    (stepId && (exec.statuses[stepId] === 'failed' || exec.statuses[stepId] === 'running') ? stepId : null)
    ?? exec.plan.steps.find((s) => exec.statuses[s.id] === 'failed')?.id;
  if (target) useAgentPlansStore.getState().skipStep(msgId, target);
  await executePlan(msgId);
}
