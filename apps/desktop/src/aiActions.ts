/**
 * AI 动作层：会话发送（Context Pack 注入 + 工具循环 + 引用核查护栏）、
 * 选区润色（走 diff 审批提案）、选中即问快捷动作。
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
