/**
 * AI 动作层：会话发送（Context Pack 注入 + 工具循环 + 引用核查护栏）、
 * 选区润色（走 diff 审批提案）、选中即问快捷动作、一键修编译错误
 * （读诊断 → 组装 prompt → 会话工具循环，tex.edit 落进阻塞审批卡）。
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
import { ENABLED_TOOLS, buildContextPackMd, runAgentTurn } from './agentTools';
import { rejectPendingApproval } from './approval';
import { buildPolishPrompt, extractLatexBody, rulePolish } from './polish';

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
  if (cfg && cfg.baseUrl.trim() && cfg.apiKey.trim()) {
    return {
      provider: new OpenAICompatibleProvider({
        id: cfg.id,
        label: cfg.label,
        baseUrl: cfg.baseUrl.trim(),
        apiKey: cfg.apiKey.trim(),
        fetchFn: (url, init) => fetch(url, init),
      }),
      model: cfg.model.trim() || 'default',
      label: `${cfg.label} · ${cfg.model || 'default'}`,
      real: true,
    };
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
