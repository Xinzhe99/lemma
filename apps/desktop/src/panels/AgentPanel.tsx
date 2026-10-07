/**
 * Agent 面板（集成核心）：
 * - 会话：Context Pack 注入 → 流式回复（真实 provider 可调用只读论文域工具，多轮回填）→ 引用核查护栏；
 * - AI 改稿：润色当前文件 / 起草新章节 → diff 提案 → 人工审批（采纳前强制快照，可随时恢复）；
 * - 工作流：内置 WorkflowDef 经 WorkflowRun 引擎执行（并行分支 + checkpoint 人工确认，步骤可带工具）。
 *   WF-3：启动统一走 WorkflowLauncher 表单（无原生 prompt）；W10 完成渲染结构化自检报告；
 *   W7 完成渲染按审稿人分段的 Rebuttal；完成的 run 留存到 agent-hub store（历史可恢复）。
 * Provider 解析：设置里已配置并激活的 OpenAI 兼容服务；否则回显模式（零后端演示）。
 * WF-3 A5：面板文案 zh/en 自包含字典（不碰全局 i18n.ts）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_WORKFLOWS,
  type ChatLabels,
  type MentionItem,
  type SlashMenuItem,
  ChatPanel,
  WorkflowRun,
  WorkflowRunView,
  useAgentHubStore,
  getPersona,
  type CompletedRun,
  type WorkflowStepUiStatus,
} from '@lemma/agent-hub';
import { createId, type WorkflowDef } from '@lemma/shared';
import { DiffView } from '@lemma/editor';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { promptDialog, confirmDialog } from '../dialogs';
import { lastCursor } from '../editorJump';
import { usePromptStore, promptsToSlashItems } from '../state/promptStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProposalStore } from '../state/proposalStore';
import { useUiStore } from '../state/uiStore';
import { combinedDoc } from '../projectDoc';
import { ENABLED_TOOLS, buildContextPackMd, runAgentTurn } from '../agentTools';
import { resolveToolApproval, rejectPendingApproval } from '../approval';
import {
  abortChat,
  abortPlan,
  executePlan,
  resolveProvider,
  runPlannedTask,
  sendChatMessage,
  skipFailedStep,
  CITATION_RULE,
  polishSelection,
} from '../aiActions';
import { buildPolishPrompt, draftSectionOffline, extractLatexBody, rulePolish } from '../polish';
import { PROVIDER_PRESETS, findPreset, matchPresetByBaseUrl } from '../providers/presets';
import { testProvider, type TestResult } from '../providers/connectionTest';
import { ReviewPanel, RebuttalPanel } from './ReviewPanel';
import { useAgentPlansStore } from '../state/agentPlans';
import { scheduleAutoCommit } from '../git/gitService';
import { PlanCard } from '../components/PlanCard';
import { DiffApprovalCard2 } from '../components/DiffApprovalCard2';
import { AskUserCard } from '../components/AskUserCard';
import { openExternal } from '../platform/openExternal';
import { fetchModels } from '../providers/models';
import { useUserAskStore, resolveUserAnswer } from '../userAsk';
import { useLibraryStore } from '../state/libraryStore';
import { recordApproval } from '../state/agentMemory';
import { ChecklistReport } from './ChecklistReport';
import { workflowName, workflowDescription } from '../workflowI18n';
import { WorkflowLauncher } from '../components/WorkflowLauncher';
import { applyWorkflowOverrides, getWorkflowOverrides } from '../state/workflowOverrides';
import './agent-extra.css';

/** 工作流步骤声明的 allowedTools 与本形态已接通工具的交集 */
function stepTools(allowed?: string[]) {
  if (!allowed || allowed.length === 0) return [];
  return ENABLED_TOOLS.filter((t) => allowed.includes(t.name));
}

interface WorkflowUiState {
  def: WorkflowDef;
  statuses: Record<string, WorkflowStepUiStatus>;
  outputs: Record<string, string>;
  phase: 'running' | 'done' | 'failed';
}

// ---------------------------------------------------------------------------
// 双语字典（自包含）
// ---------------------------------------------------------------------------

const STRINGS = {
  zh: {
    newSession: '新会话',
    aiTitle: 'AI 改稿（diff 审批）',
    polish: '润色当前文件',
    polishing: '润色中…',
    draft: '起草新章节',
    drafting: '起草中…',
    pendingChip: '待审批',
    agentChip: 'Agent 等待裁决',
    discard: '放弃',
    discardToken: '放弃（回传拒绝）',
    apply: '采纳修改（自动创建快照）',
    applyToken: '采纳修改（自动创建快照并回传）',
    chatPlaceholder: '向 agent 提问（配置模型服务后可自动检索文献库、读取项目上下文）…',
    sessionInit: '初始化会话…',
    wfTitle: '内置工作流',
    contextPreview: '当前上下文包预览',
    phaseDone: '已完成',
    phaseFailed: '失败',
    phaseRunning: '运行中',
    collapse: '收起',
    historyTitle: '运行历史',
    historyEmpty: '暂无完成的工作流（完成一次后会留存在本机）',
    historyRestore: '点击恢复该 run 的产物视图',
    clearHistory: '清空',
    noTex: '请先在编辑器打开一个 .tex 文件',
    emptyReply: '模型未返回有效内容，请重试',
    polishNoChange: '未产生修改建议（离线规则未命中冗余表达；配置模型服务可获得深度润色）',
    polishFail: (msg: string) => `润色失败：${msg}`,
    draftFail: (msg: string) => `起草失败：${msg}`,
    appliedToken: '已采纳并回传给模型（agent 将基于修改后的稿件继续）',
    applied: (label: string) => `已采纳「${label}」并自动创建快照（编辑器标签栏「历史」可恢复）`,
    rejectedToken: '已拒绝该修改并回传给模型',
    draftTitlePrompt: '新章节标题',
    offlineRulePolish: '规则润色（离线）',
    offlineDraft: '离线模板起草',
    // —— 激活器：providers 为空时的快速配置引导卡 ——
    activationTitle: 'AI 功能尚未激活',
    activationChip: '30 秒配置',
    activationDesc: '选一个模型服务，贴上 API Key（可先测试），保存即解锁全部 AI 工作流；也可稍后到「设置 → 模型服务」配置。',
    activationPreset: '模型服务',
    activationApiKey: 'API Key',
    getKey: '去获取 Key ↗',
    activateTest: '测试连接',
    activateTesting: '测试中…',
    activateTestOk: (ms: number, model: string) => `✓ 连接正常 · ${ms}ms · 模型 ${model} 可用`,
    activateTestOkNoModel: (ms: number) => `✓ 连接正常 · ${ms}ms`,
    activateTestFail: (err: string) => `✗ ${err}`,
    activateSave: '保存并激活',
    activationModel: '模型',
    activationFetchModels: '获取模型列表',
    // —— 会话历史（v1.2.0 持久化）——
    sessionHistory: '历史会话',
    sessionHistoryEmpty: '暂无历史会话',
    msgCount: (n: number) => `${n} 条消息`,
    renamePrompt: '会话标题',
    confirmDeleteSession: (title: string) => `删除会话「${title}」？（不可恢复）`,
    deleteSessionAction: '删除',
    renameAction: '重命名',
    activeNow: '当前',
    // —— 聊天 latex 块一键入稿（v1.2.0 ②）——
    insertLatexBtn: '插入到稿件 ↵',
    insertProposalLabel: '插入聊天代码块（光标处）',
    // —— 提示词库（v1.2.0 ③）——
    promptLib: '提示词库',
    // —— v7.5.0 UI 审查补漏：角色选择器 / 空会话引导 / 演示标签 ——
    personaTitle: '切换 AI 角色——不同角色有不同的行为方式',
    personaDefault: '🤖 默认助手',
    personaReviewer: '🔍 严格审稿人',
    personaCoach: '👨‍🏫 写作教练',
    personaTranslator: '🌐 翻译专家',
    collabTitle: '开始与 AI 协作',
    collabHint: '描述你想做的事——润色、找文献、改稿、修编译错误；AI 会自己调用工具完成。',
    demoModeLabel: '演示模式（内置示例数据）',
    // —— v7.9.0 权限模式（DeepSeek Harness 式三档）——
    permTitle: '权限模式：决定 AI 能对稿件做什么',
    permReadonly: '仅可查看',
    permReadonlyTip: 'AI 只能读取与编译，不能修改文件',
    permBalanced: '工作区内修改',
    permBalancedTip: 'AI 修改稿件需经 diff 审批（默认）',
    permFull: '完全权限',
    permFullTip: 'AI 免审批直接修改（自动快照，可在版本历史回滚）',
    // —— v7.9.0 会话内切换模型 / 附件 / 工具结果文案 ——
    modelSwitchTitle: '切换模型',
    attachLabel: '添加附件（图片/PDF/Word/数据/文本，或拖入/粘贴）',
    toolResultLabel: '工具结果',
    fetchedCount: (n: number) => `已获取 ${n} 个模型（点击填入）`,
  },
  en: {
    newSession: 'New session',
    aiTitle: 'AI editing (diff approval)',
    polish: 'Polish current file',
    polishing: 'Polishing…',
    draft: 'Draft new section',
    drafting: 'Drafting…',
    pendingChip: 'Pending approval',
    agentChip: 'Awaiting agent verdict',
    discard: 'Discard',
    discardToken: 'Discard (send rejection)',
    apply: 'Apply (snapshot auto-created)',
    applyToken: 'Apply (snapshot + send back)',
    chatPlaceholder: 'Ask the agent (with a model service it can search your library and read project context)…',
    sessionInit: 'Initializing session…',
    wfTitle: 'Built-in workflows',
    contextPreview: 'Context Pack preview',
    phaseDone: 'Done',
    phaseFailed: 'Failed',
    phaseRunning: 'Running',
    collapse: 'Collapse',
    historyTitle: 'Run history',
    historyEmpty: 'No completed workflows yet (runs are kept locally once finished)',
    historyRestore: 'Click to restore this run',
    clearHistory: 'Clear',
    noTex: 'Open a .tex file in the editor first',
    emptyReply: 'Model returned no content; please retry',
    polishNoChange: 'No changes proposed (offline rules found nothing; configure a model service for deep polishing)',
    polishFail: (msg: string) => `Polish failed: ${msg}`,
    draftFail: (msg: string) => `Draft failed: ${msg}`,
    appliedToken: 'Applied and sent back to the model (the agent continues on the revised manuscript)',
    applied: (label: string) => `Applied "${label}" with an auto snapshot (restorable from editor "History")`,
    rejectedToken: 'Rejected and sent back to the model',
    draftTitlePrompt: 'New section title',
    offlineRulePolish: 'Rule-based polish (offline)',
    offlineDraft: 'Offline template draft',
    // —— Activator: quick-setup card when no provider is configured ——
    activationTitle: 'AI features not activated yet',
    activationChip: '30-second setup',
    activationDesc:
      'Pick a provider, paste your API key (test it first if you like), save — every AI workflow unlocks. You can also configure later in Settings → Providers.',
    activationPreset: 'Provider',
    activationApiKey: 'API key',
    getKey: 'Get key ↗',
    activateTest: 'Test connection',
    activateTesting: 'Testing…',
    activateTestOk: (ms: number, model: string) => `✓ Connected · ${ms}ms · model ${model} available`,
    activateTestOkNoModel: (ms: number) => `✓ Connected · ${ms}ms`,
    activateTestFail: (err: string) => `✗ ${err}`,
    activateSave: 'Save & activate',
    activationModel: 'Model',
    activationFetchModels: 'Fetch model list',
    // —— Session history (v1.2.0 persistence) ——
    sessionHistory: 'Sessions',
    sessionHistoryEmpty: 'No saved sessions yet',
    msgCount: (n: number) => `${n} messages`,
    renamePrompt: 'Session title',
    confirmDeleteSession: (title: string) => `Delete session "${title}"? (cannot be undone)`,
    deleteSessionAction: 'Delete',
    renameAction: 'Rename',
    activeNow: 'current',
    // —— Chat latex block insert (v1.2.0 ②) ——
    insertLatexBtn: 'Insert to manuscript ↵',
    insertProposalLabel: 'Insert chat code block (at cursor)',
    // —— Prompt library (v1.2.0 ③) ——
    promptLib: 'Prompts',
    personaTitle: 'Switch AI persona — each behaves differently',
    personaDefault: '🤖 Default',
    personaReviewer: '🔍 Reviewer',
    personaCoach: '👨‍🏫 Coach',
    personaTranslator: '🌐 Translator',
    collabTitle: 'Start collaborating with AI',
    collabHint: 'Describe what you need — polish, find papers, revise, fix compile errors; the agent runs the tools itself.',
    demoModeLabel: 'Demo mode (built-in sample data)',
    // —— v7.9.0 permission modes (DeepSeek-Harness-style three tiers) ——
    permTitle: 'Permission mode: what the AI may do to your manuscript',
    permReadonly: 'View only',
    permReadonlyTip: 'AI can read and compile but cannot modify files',
    permBalanced: 'Workspace edits',
    permBalancedTip: 'AI edits require diff approval (default)',
    permFull: 'Full access',
    permFullTip: 'AI edits apply without approval (auto-snapshot, reversible via history)',
    // —— v7.9.0 in-chat model switch / attach / tool-result labels ——
    modelSwitchTitle: 'Switch model',
    attachLabel: 'Attach files (image/PDF/Word/data/text; drag or paste)',
    toolResultLabel: 'Tool result',
    fetchedCount: (n: number) => `Fetched ${n} models (click to fill)`,
  },
} as const;

/** 异步回调里读当前语言的文案（避免闭包里的语言过期） */
function tr() {
  return STRINGS[useSettingsStore.getState().language] as (typeof STRINGS)[Language];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function AgentPanel() {
  const sessions = useAgentHubStore((s) => s.sessions);
  const activeSessionId = useAgentHubStore((s) => s.activeSessionId);
  const newSession = useAgentHubStore((s) => s.newSession);
  const completedRuns = useAgentHubStore((s) => s.completedRuns);
  const clearCompletedRuns = useAgentHubStore((s) => s.clearCompletedRuns);

  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const setActive = useSettingsStore((s) => s.setActive);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const setPermissionMode = useSettingsStore((s) => s.setPermissionMode);
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];

  const launchRequest = useUiStore((s) => s.workflowLaunch);
  const setWorkflowLaunch = useUiStore((s) => s.setWorkflowLaunch);
  const agentAction = useUiStore((s) => s.agentAction);

  const proposal = useProposalStore((s) => s.proposal);
  // v7.5.0：AI 结构化提问卡（user.ask 工具）
  const pendingAsk = useUserAskStore((st) => st.pending);
  const setProposal = useProposalStore((s) => s.setProposal);
  const clearProposal = useProposalStore((s) => s.clearProposal);
  const note = useProposalStore((s) => s.note);
  const setNote = useProposalStore((s) => s.setNote);

  const [workflow, setWorkflow] = useState<WorkflowUiState | null>(null);
  const [launchForm, setLaunchForm] = useState<{ def: WorkflowDef; presetVars: Record<string, string> } | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextPreview, setContextPreview] = useState('');
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [sessionListOpen, setSessionListOpen] = useState(false);
  const [wfListOpen, setWfListOpen] = useState(false); // v5.3.0：工作流列表默认折叠

  const checkpointResolve = useRef<((input: string) => void) | null>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  // v7.5.0：演示模式标签随界面语言（真实 provider 名保持原样）
  const providerLabel = useMemo(() => {
    const r = resolveProvider();
    return r.real ? r.label : (STRINGS[language] as (typeof STRINGS)[Language]).demoModeLabel;
  }, [providers, activeProviderId, language]);

  // ------------------------------------------------------------------
  // v7.9.0 Codex 式会话内切换模型：下拉读激活服务的模型字段 + 同预设建议模型；
  // 切换即写回激活服务（对后续轮次生效），与设置对话框共享同一数据源。
  // ------------------------------------------------------------------
  const activeProvider = useMemo(
    () => providers.find((p) => p.id === activeProviderId) ?? null,
    [providers, activeProviderId],
  );
  const activeProviderPreset = useMemo(
    () => (activeProvider ? matchPresetByBaseUrl(activeProvider.baseUrl) : undefined),
    [activeProvider?.baseUrl],
  );
  const modelSwitchOptions = useMemo(() => {
    if (!activeProvider) return [];
    return [...new Set([activeProvider.model, ...(activeProviderPreset?.models ?? [])].filter(Boolean))];
  }, [activeProvider?.model, activeProviderPreset?.id]);
  const onModelSwitch = useCallback(
    (model: string) => {
      if (activeProvider) updateProvider(activeProvider.id, { model });
    },
    [activeProvider?.id, updateProvider],
  );

  const plans = useAgentPlansStore((s) => s.plans);
  const [approvalExplanation, setApprovalExplanation] = useState<string | undefined>(undefined);
  const libraryPapers = useLibraryStore((s) => s.papers);
  const speechLanguage = useSettingsStore((s) => s.speechLanguage);
  const userPrompts = usePromptStore((s) => s.prompts);

  // ------------------------------------------------------------------
  // 激活器：providers 为空时的快速配置卡（预设 + Key + 测试 + 保存并激活）。
  // 比跳设置更快：直接调 settingsStore.addProvider/setActive，保存成功横幅随
  // providers.length 变化自动消失。
  // ------------------------------------------------------------------

  const [quickPresetId, setQuickPresetId] = useState(PROVIDER_PRESETS[0]?.id ?? '');
  const [quickKey, setQuickKey] = useState('');
  // v7.6.0：模型可指定——默认预设首个模型，用户可改/从拉取列表中选
  const [quickModel, setQuickModel] = useState(PROVIDER_PRESETS[0]?.models[0] ?? '');
  const [quickModelOptions, setQuickModelOptions] = useState<string[]>([]);
  const [quickModelNote, setQuickModelNote] = useState<string | null>(null);
  const [quickModelLoading, setQuickModelLoading] = useState(false);
  const [quickTesting, setQuickTesting] = useState(false);
  const [quickResult, setQuickResult] = useState<TestResult | null>(null);
  const quickPreset = quickPresetId ? findPreset(quickPresetId) : undefined;
  /** v7.9.0：候选 = 预设建议（永远在场，含 reasoner/pro 档）∪ /models 拉取结果 */
  const quickModelChoices = useMemo(
    () => [...new Set([...(quickPreset?.models ?? []), ...quickModelOptions])].filter(Boolean),
    [quickPreset?.id, quickModelOptions],
  );
  const pickQuickPreset = (id: string): void => {
    setQuickPresetId(id);
    const preset = id ? findPreset(id) : undefined;
    setQuickModel(preset?.models[0] ?? '');
    setQuickModelOptions(preset?.models ?? []);
    setQuickModelNote(null);
  };
  const loadQuickModels = async (): Promise<void> => {
    const preset = quickPresetId ? findPreset(quickPresetId) : undefined;
    if (!preset || !quickKey.trim() || quickModelLoading) return;
    setQuickModelLoading(true);
    setQuickModelNote(null);
    try {
      const r = await fetchModels(preset.baseUrl, quickKey);
      if (r.models.length > 0) {
        // v7.9.0：与预设建议模型合并（预设在前）——部分网关的 /models 不含
        // reasoner/pro 档（用户实测 DeepSeek 只返回 chat），合并保证建议档永远可选手
        setQuickModelOptions([...new Set([...(preset.models ?? []), ...r.models])]);
        if (!r.models.includes(quickModel) && !preset.models.includes(quickModel)) {
          setQuickModel(r.models[0]!);
        }
        setQuickModelNote(null);
      } else {
        setQuickModelNote(r.error ?? '未获取到模型列表');
      }
    } finally {
      setQuickModelLoading(false);
    }
  };

  const quickTest = async () => {
    const preset = quickPresetId ? findPreset(quickPresetId) : undefined;
    if (!preset || !quickKey.trim() || quickTesting) return;
    setQuickTesting(true);
    setQuickResult(null);
    try {
      setQuickResult(await testProvider({ baseUrl: preset.baseUrl, apiKey: quickKey, model: quickModel.trim() || preset.models[0] }));
    } finally {
      setQuickTesting(false);
    }
  };

  const quickSave = () => {
    const preset = quickPresetId ? findPreset(quickPresetId) : undefined;
    const key = quickKey.trim();
    if (!preset || !key) return;
    const id = createId();
    addProvider({
      id,
      label: preset.label,
      baseUrl: preset.baseUrl,
      apiKey: key,
      model: quickModel.trim() || (preset.models[0] ?? ''),
      tier: 'cheap',
    });
    setActive(id);
    // providers 由 0 → 1，引导卡不再渲染
  };

  const quickTestLine = quickResult
    ? quickResult.ok
      ? quickResult.model
        ? t.activateTestOk(quickResult.latencyMs ?? 0, quickResult.model)
        : t.activateTestOkNoModel(quickResult.latencyMs ?? 0)
      : t.activateTestFail(quickResult.error ?? '')
    : null;

  // 确保存在会话
  useEffect(() => {
    if (!useAgentHubStore.getState().activeSessionId) {
      newSession('host', useWorkspaceStore.getState().projectName || undefined, t.newSession);
    }
  }, [newSession]);

  // ------------------------------------------------------------------
  // 会话：委托 aiActions（Context Pack + 工具循环 + 引用核查护栏）
  // ------------------------------------------------------------------

  // 发送消息（AI 层的 aiActions.sendChatMessage 处理 @mention 文件内容注入）
  // 稳定回调（v4.2.0）：ChatPanel 内消息行已 memo 化，回调身份恒定才能让
  // 流式 token 只重渲最后一条消息
  const send = useCallback(
    (text: string, images?: string[], files?: File[]) => void sendChatMessage(text, images, files),
    [],
  );

  // getState() 内取值 → 零依赖：papers/activeSession 变化不产生新回调身份
  const handleCitekeyClick = useCallback((key: string) => {
    if (useLibraryStore.getState().papers.some((p) => p.citekey === key)) {
      useUiStore.getState().setSidebarTab('library');
    }
  }, []);

  const handleRegenerate = useCallback(() => {
    const st = useAgentHubStore.getState();
    const active = st.sessions.find((s) => s.id === st.activeSessionId);
    if (!active) return;
    const lastUser = [...active.messages].reverse().find((m) => m.role === 'user');
    if (lastUser) void sendChatMessage(lastUser.content);
  }, []);

  // ------------------------------------------------------------------
  // AI 改稿：润色 / 起草 → diff 提案 → 审批
  // ------------------------------------------------------------------

  const activeTexFile = (): string | null => {
    const active = useWorkspaceStore.getState().activeTab;
    return active && active.endsWith('.tex') ? active : null;
  };

  /**
   * 聊天 latex 围栏「插入到稿件」（v1.2.0 ②）：
   * 插入点 = 编辑器光标所在行之前（光标桥在当前 .tex 内）；光标不可用时
   * 回落到当前打开的 .tex 文件末尾。产物走 diff 审批卡（写级操作门控不变）。
   * useCallback（v4.2.0）：作为 ChatPanel memo 消息行的 prop，身份需稳定
   * （t 之外无外部值依赖；t 仅语言切换时变化）。
   */
  const insertLatexBlock = useCallback(
    (code: string) => {
      const ws = useWorkspaceStore.getState();
      const cur = lastCursor();
      const active = useWorkspaceStore.getState().activeTab;
      const fallback = active && active.endsWith('.tex') ? active : null;
      const file =
        cur.file && cur.file.endsWith('.tex') && ws.files[cur.file] != null ? cur.file : fallback;
      if (!file) {
        setNote(t.noTex);
        return;
      }
      const before = ws.files[file] ?? '';
      const lines = before.split('\n');
      const atLine =
        cur.file === file && cur.line >= 1 && cur.line <= lines.length ? cur.line - 1 : lines.length;
      const blockLines = code.replace(/\r\n?/g, '\n').trim().split('\n');
      const after = [...lines.slice(0, atLine), ...blockLines, ...lines.slice(atLine)].join('\n');
      setProposal({
        file,
        before,
        after,
        kind: 'draft-section',
        label: t.insertProposalLabel,
        via: resolveProvider().model || 'chat',
      });
    },
    [t],
  );

  const polishCurrentFile = async () => {
    const file = activeTexFile();
    if (!file) {
      setNote(tr().noTex);
      return;
    }
    const before = useWorkspaceStore.getState().files[file] ?? '';
    setAiBusy('润色');
    try {
      const { real, model, provider } = resolveProvider();
      let after: string;
      let via: string;
      if (real) {
        const system = await buildContextPackMd('学术润色');
        const reply = await runAgentTurn({ provider, model, system, history: [], user: buildPolishPrompt(before) });
        after = extractLatexBody(reply);
        via = model;
      } else {
        after = rulePolish(before);
        via = tr().offlineRulePolish;
      }
      if (!after.trim()) {
        setNote(tr().emptyReply);
      } else if (after.trim() === before.trim()) {
        setNote(tr().polishNoChange);
      } else {
        setProposal({ file, before, after, kind: 'polish', label: 'AI 润色', via });
      }
    } catch (e) {
      setNote(tr().polishFail(e instanceof Error ? e.message : String(e)));
    } finally {
      setAiBusy(null);
    }
  };

  const draftNewSection = async () => {
    const file = activeTexFile();
    if (!file) {
      setNote(tr().noTex);
      return;
    }
    // 标题收集走应用内对话框（Tauri WKWebView 下原生 prompt 静默失效）；取消/空串中止
    const title = await promptDialog(tr().draftTitlePrompt, '讨论（Discussion）');
    if (!title || !title.trim()) return;
    const before = useWorkspaceStore.getState().files[file] ?? '';
    setAiBusy('起草');
    try {
      const { real, model, provider } = resolveProvider();
      let draft: string;
      let via: string;
      if (real) {
        const system = await buildContextPackMd(`起草新章节：${title}`);
        const reply = await runAgentTurn({
          provider,
          model,
          system,
          history: [],
          user: `请为当前论文起草一节 \\section{${title.trim()}} 的完整草稿（与现有章节风格一致，引用仅使用上文列出的 citekey）。只输出该节的 LaTeX 源码（首行为 \\section 行），用 latex 代码围栏包裹，不要解释。`,
        });
        draft = extractLatexBody(reply);
        via = model;
      } else {
        draft = draftSectionOffline(title.trim());
        via = tr().offlineDraft;
      }
      if (!draft.trim()) {
        setNote(tr().emptyReply);
        return;
      }
      const after = `${before.trimEnd()}\n${draft.trim()}\n`;
      setProposal({ file, before, after, kind: 'draft-section', label: `起草新章节：${title.trim()}`, via });
    } catch (e) {
      setNote(tr().draftFail(e instanceof Error ? e.message : String(e)));
    } finally {
      setAiBusy(null);
    }
  };

  const applyProposal = () => {
    if (!proposal) return;
    const ws = useWorkspaceStore.getState();
    ws.snapshotFile(proposal.file, `${proposal.label}前的快照`);
    ws.updateFile(proposal.file, proposal.after);
    scheduleAutoCommit(proposal.label); // v5.0.0：AI 改动自动进版本历史
    const token = proposal.token;
    clearProposal();
    setNote(token ? tr().appliedToken : tr().applied(proposal.label));
    if (token) resolveToolApproval(token, true);
  };

  const discardProposal = () => {
    const token = proposal?.token;
    if (proposal) recordApproval(proposal, false);
    clearProposal();
    if (token) {
      resolveToolApproval(token, false);
      setNote(tr().rejectedToken);
    }
  };

  // 命令面板触发的 AI 动作
  useEffect(() => {
    if (agentAction === 'polish') {
      useUiStore.setState({ agentAction: null });
      void polishCurrentFile();
    } else if (agentAction === 'draft') {
      useUiStore.setState({ agentAction: null });
      void draftNewSection();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentAction]);

  // ------------------------------------------------------------------
  // 内置工作流（步骤可调用已接通的工具）
  // WF-3 A1：启动一律先弹 WorkflowLauncher 表单（收集缺失变量，一次提交），
  // 三处来源统一：面板按钮 / 命令面板（含 workflowLaunchVars 预填）/ W7 衔接 presetVars。
  // ------------------------------------------------------------------

  const requestLaunch = (id: string, presetVars?: Record<string, string>) => {
    const def = BUILTIN_WORKFLOWS.find((w) => w.id === id);
    if (!def) return;
    setLaunchForm({ def, presetVars: presetVars ?? {} });
  };

  const executeWorkflow = async (baseDef: WorkflowDef, vars: Record<string, string>) => {
    // 工作流透明化：执行入口应用用户对步骤 prompt 的覆盖（无覆盖时与原 def 完全一致），
    // 保证真正发给模型的是修改后的提示词；运行视图（WorkflowRunView）也展示生效值。
    const def = applyWorkflowOverrides(baseDef, getWorkflowOverrides());
    setWorkflow({
      def,
      statuses: Object.fromEntries(def.steps.map((s) => [s.id, 'pending'])) as Record<string, WorkflowStepUiStatus>,
      outputs: {},
      phase: 'running',
    });

    const startedAt = Date.now();
    const outputsAcc: Record<string, string> = {}; // completeRun 用（React state 在异步回调里不可靠）

    const contextMd = (await buildContextPackMd(def.description)) + CITATION_RULE + getPersona(useSettingsStore.getState().aiPersona).systemAddendum;
    const { provider, model } = resolveProvider();
    const run = new WorkflowRun(def, {
      async runStep(step, ctx) {
        setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [step.id]: 'running' } } : w));
        const deps = (step.dependsOn ?? [])
          .map((d) => `【${def.steps.find((x) => x.id === d)?.name ?? d} 的结论】\n${(ctx.priorOutputs[d] ?? '').slice(0, 1500)}`)
          .join('\n\n');
        const prompt = step.prompt.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '');
        try {
          const acc = await runAgentTurn({
            provider,
            model,
            system: contextMd,
            history: [],
            user: `${prompt}${deps ? `\n\n${deps}` : ''}`,
            tools: stepTools(step.allowedTools),
          });
          outputsAcc[step.id] = acc;
          setWorkflow((w) =>
            w ? { ...w, statuses: { ...w.statuses, [step.id]: 'done' }, outputs: { ...w.outputs, [step.id]: acc } } : w,
          );
          return acc;
        } catch (e) {
          setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [step.id]: 'failed' } } : w));
          throw e;
        }
      },
      async onCheckpoint(step) {
        setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [step.id]: 'checkpoint' } } : w));
        const input = await new Promise<string>((resolve) => {
          checkpointResolve.current = resolve;
        });
        setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [step.id]: 'running' } } : w));
        return input;
      },
    });

    const result = await run.start(vars);
    setWorkflow((w) =>
      w
        ? {
            ...w,
            phase: result.status === 'done' ? 'done' : 'failed',
            statuses:
              result.status === 'done'
                ? Object.fromEntries(def.steps.map((s) => [s.id, 'done'])) as Record<string, WorkflowStepUiStatus>
                : w.statuses,
          }
        : w,
    );

    // WF-3 A3：完成的 run 留存（store 持久化 sf-agent-runs，上限 10 条）
    if (result.status === 'done') {
      useAgentHubStore.getState().completeRun({
        id: createId(),
        workflowId: def.id,
        workflowName: def.name,
        startedAt,
        endedAt: Date.now(),
        outputs: outputsAcc,
      });
    }
  };

  // 命令面板触发的待启动工作流（workflowLaunchVars 里的变量不进入表单）
  useEffect(() => {
    if (launchRequest) {
      const presetVars = useUiStore.getState().workflowLaunchVars ?? undefined;
      setWorkflowLaunch(null);
      requestLaunch(launchRequest, presetVars);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest]);

  /** 从历史恢复一次已完成的 run（statuses 全 done，产物可展开复查） */
  const restoreRun = (run: CompletedRun) => {
    const def = BUILTIN_WORKFLOWS.find((w) => w.id === run.workflowId);
    if (!def) return;
    setLaunchForm(null);
    setWorkflow({
      def,
      statuses: Object.fromEntries(def.steps.map((s) => [s.id, 'done' as const])) as Record<string, WorkflowStepUiStatus>,
      outputs: run.outputs,
      phase: 'done',
    });
  };

  const previewContext = async () => {
    setContextPreview(await buildContextPackMd(''));
    setShowContext((v) => !v);
  };

  // —— 会话历史（v1.2.0）：切换 / 重命名 / 删除（持久化由 agentSessionPersist 桥自动落盘）——
  const renameSession = async (id: string, currentTitle: string) => {
    const title = await promptDialog(t.renamePrompt, currentTitle);
    if (title && title.trim() && title.trim() !== currentTitle) {
      useAgentHubStore.getState().renameSession(id, title);
    }
  };

  const deleteSession = async (id: string, title: string) => {
    if (!(await confirmDialog(t.confirmDeleteSession(title)))) return;
    const plans = useAgentPlansStore.getState().plans;
    for (const msgId of Object.keys(plans)) {
      const belongs = useAgentHubStore
        .getState()
        .sessions.some((s) => s.id === id && s.messages.some((m) => m.id === msgId));
      if (belongs) useAgentPlansStore.getState().clear(msgId); // 计划执行态随会话清理，防幽灵卡
    }
    useAgentHubStore.getState().deleteSession(id);
  };

  return (
    <div className="sf-agent">
      {/* v5.3.0 Codex 化工具栏：上行 = 会话操作（权限模式/新会话/历史/提示词库），下行 = 文档级操作 */}
      <div className="sf-agent-toolbar">
        <div className="sf-agent-toolbar-row">
          {/* v7.9.0 权限模式（DeepSeek Harness 式三档）：决定 AI 能对稿件做什么 */}
          <div className="sf-perm-switch" role="radiogroup" aria-label={t.permTitle} title={t.permTitle}>
            <button
              type="button"
              className={`sf-perm-btn${permissionMode === 'readonly' ? ' active' : ''}`}
              title={t.permReadonlyTip}
              aria-pressed={permissionMode === 'readonly'}
              onClick={() => setPermissionMode('readonly')}
            >
              {t.permReadonly}
            </button>
            <button
              type="button"
              className={`sf-perm-btn${permissionMode === 'balanced' ? ' active' : ''}`}
              title={t.permBalancedTip}
              aria-pressed={permissionMode === 'balanced'}
              onClick={() => setPermissionMode('balanced')}
            >
              {t.permBalanced}
            </button>
            <button
              type="button"
              className={`sf-perm-btn${permissionMode === 'full' ? ' active' : ''}`}
              title={t.permFullTip}
              aria-pressed={permissionMode === 'full'}
              onClick={() => setPermissionMode('full')}
            >
              {t.permFull}
            </button>
          </div>
          <span style={{ flex: 1 }} />
          <button
            className="sf-pill-btn"
            onClick={() => {
              newSession('host', useWorkspaceStore.getState().projectName || undefined, t.newSession);
              setWorkflow(null);
            }}
          >
            {t.newSession}
          </button>
          <div className="sf-session-history">
            <button className="sf-pill-btn" onClick={() => setSessionListOpen((v) => !v)}>
              {t.sessionHistory}
            </button>
            {sessionListOpen && (
              <div className="sf-session-menu">
                {sessions.length === 0 ? (
                  <div className="sf-session-item dim">{t.sessionHistoryEmpty}</div>
                ) : (
                // 项目隔离（v1.6.0 ③）：当前项目的会话 + 未标记项目的旧会话
                [...sessions]
                  .filter((s) => !s.projectName || s.projectName === (useWorkspaceStore.getState().projectName || ''))
                  .reverse()
                  .map((s) => (
                    <div
                      key={s.id}
                      className={`sf-session-item${s.id === session?.id ? ' active' : ''}`}
                      onClick={() => {
                        useAgentHubStore.getState().setActiveSession(s.id);
                        setSessionListOpen(false);
                        setWorkflow(null);
                      }}
                    >
                      <div className="sf-session-item-main">
                        <div className="sf-session-item-title">
                          {s.title || t.newSession}
                          {s.id === session?.id && <span className="sf-chip dim">{t.activeNow}</span>}
                        </div>
                        <div className="sf-session-item-meta">
                          {t.msgCount(s.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length)}
                          {s.messages.length > 0 &&
                            ` · ${formatTime(s.messages[s.messages.length - 1]?.createdAt ?? Date.now())}`}
                        </div>
                      </div>
                      <div className="sf-session-item-actions">
                        <button
                          className="sf-link-btn"
                          title={t.renameAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionListOpen(false);
                            void renameSession(s.id, s.title);
                          }}
                        >
                          ✎
                        </button>
                        <button
                          className="sf-link-btn"
                          title={t.deleteSessionAction}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSessionListOpen(false);
                            void deleteSession(s.id, s.title || t.newSession);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          )}
        </div>
          <button className="sf-pill-btn" onClick={() => useUiStore.getState().setPromptsLibOpen(true)}>
            {t.promptLib}
          </button>
        </div>
      </div>

      {/* 激活器：无 provider 时的快速配置引导卡（保存后自动消失） */}
      {providers.length === 0 && (
        <div className="sf-agent-approval sf-agent-activate">
          <div className="sf-agent-run-head">
            <strong>{t.activationTitle}</strong>
            <span className="sf-chip warn">{t.activationChip}</span>
          </div>
          <p className="sf-agent-note">{t.activationDesc}</p>
          <div className="sf-form">
            <label className="sf-form-field" style={{ gridColumn: '1 / -1' }}>
              <span>
                {t.activationPreset}
                {quickPreset?.keyUrl && (
                  <a
                    className="sf-link-btn"
                    href={quickPreset.keyUrl}
                    title={quickPreset.keyUrl}
                    onClick={(e) => {
                      // v7.6.0：WebView 内 target=_blank 不打开系统浏览器（点「去获取 Key」无反应的根因）
                      e.preventDefault();
                      void openExternal(quickPreset.keyUrl!);
                    }}
                  >
                    {t.getKey}
                  </a>
                )}
              </span>
              <select
                className="sf-input"
                value={quickPresetId}
                onChange={(e) => {
                  setQuickPresetId(e.target.value);
                  setQuickResult(null);
                }}
              >
                {PROVIDER_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              {quickPreset && (
                <small className="sf-agent-note" style={{ margin: 0 }}>
                  {language === 'en' && quickPreset.noteEn ? quickPreset.noteEn : quickPreset.note}
                </small>
              )}
            </label>
            <label className="sf-form-field">
              <span>{t.activationApiKey}</span>
              <input
                className="sf-input"
                type="password"
                value={quickKey}
                placeholder="sk-…"
                onChange={(e) => {
                  setQuickKey(e.target.value);
                  setQuickResult(null);
                }}
              />
            </label>
            {/* v7.6.0：模型可选——默认预设建议模型，可手填或从 /models 拉取列表选 */}
            <label className="sf-form-field" style={{ gridColumn: '1 / -1' }}>
              <span>
                {t.activationModel}
                <button
                  type="button"
                  className="sf-link-btn"
                  disabled={!quickKey.trim() || quickModelLoading}
                  onClick={() => void loadQuickModels()}
                >
                  {quickModelLoading ? '…' : t.activationFetchModels}
                </button>
              </span>
              <input
                className="sf-input"
                value={quickModel}
                placeholder={quickPreset?.models[0] ?? 'model'}
                list="sf-quick-models"
                onChange={(e) => setQuickModel(e.target.value)}
              />
              <datalist id="sf-quick-models">
                {quickModelChoices.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              {/* v7.9.0：模型候选直接以可点击 chips 呈现（datalist 在 WebView2 里
                  常常点不出来，用户误以为「只有 flash 一个模型」） */}
              {quickModelChoices.length > 0 && (
                <div className="sf-model-chips">
                  {quickModelChoices.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={`sf-model-chip${m === quickModel ? ' active' : ''}`}
                      onClick={() => setQuickModel(m)}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              )}
              {quickModelOptions.length > 0 && (
                <small className="sf-agent-note" style={{ margin: 0, opacity: 0.75 }}>
                  {t.fetchedCount(quickModelOptions.length)}
                </small>
              )}
              {quickModelNote && (
                <small className="sf-agent-note" style={{ margin: 0, opacity: 0.75 }}>
                  {quickModelNote}
                </small>
              )}
            </label>
            <div className="sf-form-actions">
              <button className="sf-btn" onClick={() => void quickTest()} disabled={quickTesting || !quickKey.trim()}>
                {quickTesting ? t.activateTesting : t.activateTest}
              </button>
              <button className="sf-btn sf-btn--primary" onClick={quickSave} disabled={!quickKey.trim()}>
                {t.activateSave}
              </button>
            </div>
            {quickTestLine && (
              <p className="sf-agent-note" role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>
                {quickTestLine}
              </p>
            )}
          </div>
        </div>
      )}

      {showContext && contextPreview && (
        <details className="sf-agent-context" open>
          <summary>{t.contextPreview}</summary>
          <pre>{contextPreview}</pre>
        </details>
      )}

      {/* v5.4.0：AI 改稿区只保留产物（审批卡/提示）——预设按钮移除，用户直接对话即可；
          润色/起草仍可经命令面板触达 */}
      <div className="sf-agent-ai">
        {note && <p className="sf-agent-note">{note}</p>}
        {pendingAsk && (
          <AskUserCard ask={pendingAsk} lang={language} onAnswer={resolveUserAnswer} />
        )}
        {proposal && (
          <DiffApprovalCard2
            proposal={proposal}
            lang={language}
            explanation={approvalExplanation}
            onAccept={(after, accepted) => {
              const ws = useWorkspaceStore.getState();
              ws.snapshotFile(proposal.file, `${proposal.label}前的快照`);
              ws.updateFile(proposal.file, after);
              scheduleAutoCommit(proposal.label); // v5.0.0：AI 改动自动进版本历史
              const token = proposal.token;
              recordApproval(proposal, true, accepted === 'all' ? undefined : accepted.length);
              clearProposal();
              setApprovalExplanation(undefined);
              if (token) {
                resolveToolApproval(
                  token,
                  true,
                  accepted === 'all' ? '用户已采纳全部修改' : `用户部分采纳（${accepted.length} hunk）`,
                );
              }
              setNote(
                token
                  ? '已采纳并回传给模型（agent 将基于修改后的稿件继续）'
                  : `已采纳「${proposal.label}」并自动创建快照（编辑器标签栏「历史」可恢复）`,
              );
            }}
            onReject={() => discardProposal()}
            onRequestExplanation={() => {
              setApprovalExplanation('');
              void import('../aiActions').then(async ({ resolveProvider }) => {
                const { provider, model, real } = resolveProvider();
                if (!real) {
                  setApprovalExplanation('（演示模式）变更解释：本 diff 将冗余表达替换为更简洁的学术用语，未改动引用与数据。');
                  return;
                }
                try {
                  const { runAgentTurn } = await import('../agentTools');
                  const reply = await runAgentTurn({
                    provider, model, system: '你是学术写作助手。',
                    history: [],
                    user: `用不超过120字解释这组修改的理由，要点式：

修改标签：${proposal.label}
修改前片段：
${proposal.before.slice(0, 800)}

修改后片段：
${proposal.after.slice(0, 800)}`,
                  });
                  setApprovalExplanation(reply || '（无解释返回）');
                } catch (e) {
                  setApprovalExplanation(`解释生成失败：${e instanceof Error ? e.message : String(e)}`);
                }
              });
            }}
          />
        )}
      </div>

      {Object.entries(plans).slice(-1).map(([msgId, exec]) => (
        <PlanCard
          key={msgId}
          msgId={msgId}
          execution={exec}
          onApprove={() => void executePlan(msgId)}
          onSkip={(stepId) => void skipFailedStep(msgId, stepId)}
          onRetry={() => void executePlan(msgId)}
          onAbort={() => abortPlan()}
        />
      ))}
      <div className="sf-agent-chat">
        {session ? (
          <ChatPanel
            session={session}
            onSend={send}
            onStop={() => abortChat()}
            placeholder={t.chatPlaceholder}
            labels={{
              emptyTitle: t.collabTitle,
              emptyHint: t.collabHint,
              toolResult: t.toolResultLabel,
              modelSwitchTitle: t.modelSwitchTitle,
              attach: t.attachLabel,
            }}
            modelSwitcher={
              activeProvider
                ? {
                    model: activeProvider.model,
                    options: modelSwitchOptions,
                    onChange: onModelSwitch,
                  }
                : undefined
            }
            onCitekeyClick={handleCitekeyClick}
            onSlashWorkflow={(id) => {
              if (id === '__clear') {
                if (session) useAgentHubStore.setState({
                  sessions: useAgentHubStore.getState().sessions.map((s) =>
                    s.id === session.id ? { ...s, messages: [], title: '新会话' } : s),
                });
                return;
              }
              useUiStore.getState().launchWorkflow(id);
            }}
            onRegenerate={handleRegenerate}
            onEditResend={send}
            speechLanguage={speechLanguage}
            artifacts={session?.artifacts}
            onOpenArtifact={(file) => {
              const ws = useWorkspaceStore.getState();
              if (ws.files[file] !== undefined) ws.openFile(file);
            }}
            providerLabel={providerLabel}
            onInsertLatex={insertLatexBlock}
            insertLatexLabel={t.insertLatexBtn}
            slashItems={[
              ...BUILTIN_WORKFLOWS.map((w) => ({
                id: w.id,
                label: `/${workflowName(w.id, w.name, language)}`,
                hint: workflowDescription(w.id, w.description, language),
              })),
              ...promptsToSlashItems(userPrompts),
            ]}
            mentionItems={[
              ...libraryPapers.slice(0, 200).map((p) => ({ id: p.id, label: p.citekey, type: 'paper' as const })),
              ...Object.keys(useWorkspaceStore.getState().files).map((f) => ({ id: f, label: f, type: 'file' as const })),
            ]}
          />
        ) : (
          <p className="placeholder">{t.sessionInit}</p>
        )}
      </div>

      <div className="sf-agent-workflows">
        {/* v5.3.0：工作流列表默认折叠（Codex 式收纳）；运行中的工作流始终展开 */}
        {!workflow && (
          <button className="sf-pill-btn sf-agent-wf-toggle" onClick={() => setWfListOpen((v) => !v)}>
            {t.wfTitle} {wfListOpen ? '▾' : '▸'}
          </button>
        )}
        {workflow ? (
          <div className="sf-agent-run">
            <div className="sf-agent-run-head">
              <strong>{workflow.def.name}</strong>
              <span
                className={`sf-chip ${workflow.phase === 'done' ? 'ok' : workflow.phase === 'failed' ? 'err' : 'warn'}`}
              >
                {workflow.phase === 'done' ? t.phaseDone : workflow.phase === 'failed' ? t.phaseFailed : t.phaseRunning}
              </span>
              <button className="sf-link-btn" onClick={() => setWorkflow(null)}>
                {t.collapse}
              </button>
            </div>
            <WorkflowRunView
              steps={workflow.def.steps}
              statuses={workflow.statuses}
              outputs={workflow.outputs}
              onContinue={(stepId) => {
                checkpointResolve.current?.('继续');
                checkpointResolve.current = null;
                setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [stepId]: 'running' } } : w));
              }}
            />
            {workflow.def.id === 'w6-reviewer-sim' && workflow.outputs['meta-review'] && (
              <ReviewPanel
                outputs={workflow.outputs}
                onDraftRebuttal={(reviews) =>
                  requestLaunch('w7-rebuttal', { reviews, manuscript: combinedDoc(useWorkspaceStore.getState().files) })
                }
              />
            )}
            {workflow.def.id === 'w7-rebuttal' && workflow.outputs['finalize'] && (
              <RebuttalPanel output={workflow.outputs['finalize']} />
            )}
            {workflow.def.id === 'w10-pre-submission' && workflow.outputs['report'] && (
              <ChecklistReport output={workflow.outputs['report']} />
            )}
          </div>
        ) : wfListOpen ? (
          <ul className="sf-agent-wf-list sf-agent-wf-grid">
            {BUILTIN_WORKFLOWS.map((w) => (
              <li key={w.id}>
                <button className="sf-btn sf-agent-wf-btn" onClick={() => requestLaunch(w.id)}>
                  {workflowName(w.id, w.name, language)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* WF-3 A3：运行历史（v5.3.0 默认折叠为 details；localStorage 持久化） */}
      <details className="sf-agent-history" {...(completedRuns.length > 0 ? { open: true } : {})}>
        <summary className="sf-agent-wf-title" style={{ margin: 0, cursor: 'pointer' }}>
          {t.historyTitle}
        </summary>
        {completedRuns.length > 0 && (
          <button className="sf-link-btn sf-agent-history-clear" onClick={clearCompletedRuns}>
            {t.clearHistory}
          </button>
        )}
        {completedRuns.length === 0 ? (
          <p className="sf-agent-history-empty">{t.historyEmpty}</p>
        ) : (
          <ul className="sf-agent-history-list">
            {completedRuns.map((run) => (
              <li key={run.id}>
                <button className="sf-agent-history-item" onClick={() => restoreRun(run)} title={t.historyRestore}>
                  <span className="sf-chip dim">✓</span>
                  <span className="sf-agent-history-name">{run.workflowName}</span>
                  <span className="sf-agent-history-time">{formatTime(run.endedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* WF-3 A1：工作流启动表单（替代原生 prompt）；key 保证每次启动重置表单状态 */}
      {launchForm && (
        <WorkflowLauncher
          key={`${launchForm.def.id}:${JSON.stringify(launchForm.presetVars)}`}
          def={launchForm.def}
          presetVars={launchForm.presetVars}
          onCancel={() => setLaunchForm(null)}
          onSubmit={(vars) => {
            const def = launchForm.def;
            setLaunchForm(null);
            void executeWorkflow(def, vars);
          }}
        />
      )}
    </div>
  );
}
