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

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_WORKFLOWS,
  ChatPanel,
  WorkflowRun,
  WorkflowRunView,
  useAgentHubStore,
  type CompletedRun,
  type WorkflowStepUiStatus,
} from '@scholarforge/agent-hub';
import { createId, type WorkflowDef } from '@scholarforge/shared';
import { DiffView } from '@scholarforge/editor';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { promptDialog } from '../dialogs';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProposalStore } from '../state/proposalStore';
import { useUiStore } from '../state/uiStore';
import { combinedDoc } from '../projectDoc';
import { ENABLED_TOOLS, buildContextPackMd, runAgentTurn } from '../agentTools';
import { resolveToolApproval, rejectPendingApproval } from '../approval';
import {
  abortChat,
  resolveProvider,
  sendChatMessage,
  CITATION_RULE,
  polishSelection,
} from '../aiActions';
import { buildPolishPrompt, draftSectionOffline, extractLatexBody, rulePolish } from '../polish';
import { PROVIDER_PRESETS, findPreset } from '../providers/presets';
import { testProvider, type TestResult } from '../providers/connectionTest';
import { ReviewPanel, RebuttalPanel } from './ReviewPanel';
import { ChecklistReport } from './ChecklistReport';
import { WorkflowLauncher } from '../components/WorkflowLauncher';
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
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];

  const launchRequest = useUiStore((s) => s.workflowLaunch);
  const setWorkflowLaunch = useUiStore((s) => s.setWorkflowLaunch);
  const agentAction = useUiStore((s) => s.agentAction);

  const proposal = useProposalStore((s) => s.proposal);
  const setProposal = useProposalStore((s) => s.setProposal);
  const clearProposal = useProposalStore((s) => s.clearProposal);
  const note = useProposalStore((s) => s.note);
  const setNote = useProposalStore((s) => s.setNote);

  const [workflow, setWorkflow] = useState<WorkflowUiState | null>(null);
  const [launchForm, setLaunchForm] = useState<{ def: WorkflowDef; presetVars: Record<string, string> } | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextPreview, setContextPreview] = useState('');
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const checkpointResolve = useRef<((input: string) => void) | null>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const providerLabel = useMemo(() => resolveProvider().label, [providers, activeProviderId]);

  // ------------------------------------------------------------------
  // 激活器：providers 为空时的快速配置卡（预设 + Key + 测试 + 保存并激活）。
  // 比跳设置更快：直接调 settingsStore.addProvider/setActive，保存成功横幅随
  // providers.length 变化自动消失。
  // ------------------------------------------------------------------

  const [quickPresetId, setQuickPresetId] = useState(PROVIDER_PRESETS[0]?.id ?? '');
  const [quickKey, setQuickKey] = useState('');
  const [quickTesting, setQuickTesting] = useState(false);
  const [quickResult, setQuickResult] = useState<TestResult | null>(null);
  const quickPreset = quickPresetId ? findPreset(quickPresetId) : undefined;

  const quickTest = async () => {
    const preset = quickPresetId ? findPreset(quickPresetId) : undefined;
    if (!preset || !quickKey.trim() || quickTesting) return;
    setQuickTesting(true);
    setQuickResult(null);
    try {
      setQuickResult(await testProvider({ baseUrl: preset.baseUrl, apiKey: quickKey, model: preset.models[0] }));
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
      model: preset.models[0] ?? '',
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
      newSession('host');
    }
  }, [newSession]);

  // ------------------------------------------------------------------
  // 会话：委托 aiActions（Context Pack + 工具循环 + 引用核查护栏）
  // ------------------------------------------------------------------

  const send = (text: string) => void sendChatMessage(text);

  // ------------------------------------------------------------------
  // AI 改稿：润色 / 起草 → diff 提案 → 审批
  // ------------------------------------------------------------------

  const activeTexFile = (): string | null => {
    const active = useWorkspaceStore.getState().activeTab;
    return active && active.endsWith('.tex') ? active : null;
  };

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
    const token = proposal.token;
    clearProposal();
    setNote(token ? tr().appliedToken : tr().applied(proposal.label));
    if (token) resolveToolApproval(token, true);
  };

  const discardProposal = () => {
    const token = proposal?.token;
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

  const executeWorkflow = async (def: WorkflowDef, vars: Record<string, string>) => {
    setWorkflow({
      def,
      statuses: Object.fromEntries(def.steps.map((s) => [s.id, 'pending'])) as Record<string, WorkflowStepUiStatus>,
      outputs: {},
      phase: 'running',
    });

    const startedAt = Date.now();
    const outputsAcc: Record<string, string> = {}; // completeRun 用（React state 在异步回调里不可靠）

    const contextMd = (await buildContextPackMd(def.description)) + CITATION_RULE;
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

  return (
    <div className="sf-agent">
      <div className="sf-agent-provider">
        <span className="sf-chip dim">{providerLabel}</span>
        <button className="sf-link-btn" onClick={() => void previewContext()}>
          Context Pack
        </button>
        <button
          className="sf-link-btn"
          onClick={() => {
            newSession('host');
            setWorkflow(null);
          }}
        >
          {t.newSession}
        </button>
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
                  <a className="sf-link-btn" href={quickPreset.keyUrl} target="_blank" rel="noreferrer" title={quickPreset.keyUrl}>
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

      {/* AI 改稿（diff 审批闭环） */}
      <div className="sf-agent-ai">
        <div className="sf-agent-wf-title">{t.aiTitle}</div>
        <div className="sf-agent-ai-actions">
          <button className="sf-btn" onClick={() => void polishCurrentFile()} disabled={!!aiBusy}>
            {aiBusy === '润色' ? t.polishing : t.polish}
          </button>
          <button className="sf-btn" onClick={() => void draftNewSection()} disabled={!!aiBusy}>
            {aiBusy === '起草' ? t.drafting : t.draft}
          </button>
        </div>
        {note && <p className="sf-agent-note">{note}</p>}
        {proposal && (
          <div className="sf-agent-approval">
            <div className="sf-agent-run-head">
              <strong>{proposal.label}</strong>
              <span className="sf-chip dim">{proposal.via}</span>
              <span className={`sf-chip ${proposal.token ? 'err' : 'warn'}`}>
                {proposal.token ? t.agentChip : t.pendingChip}
              </span>
            </div>
            <DiffView before={proposal.before} after={proposal.after} filename={proposal.file} />
            <div className="sf-lib-dialog-actions">
              <button className="sf-btn" onClick={discardProposal}>
                {proposal.token ? t.discardToken : t.discard}
              </button>
              <button className="sf-btn sf-btn--primary" onClick={applyProposal}>
                {proposal.token ? t.applyToken : t.apply}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="sf-agent-chat">
        {session ? (
          <ChatPanel
            session={session}
            onSend={(text) => send(text)}
            onStop={() => abortChat()}
            placeholder={t.chatPlaceholder}
          />
        ) : (
          <p className="placeholder">{t.sessionInit}</p>
        )}
      </div>

      <div className="sf-agent-workflows">
        <div className="sf-agent-wf-title">{t.wfTitle}</div>
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
        ) : (
          <ul className="sf-agent-wf-list">
            {BUILTIN_WORKFLOWS.map((w) => (
              <li key={w.id}>
                <button className="sf-btn sf-agent-wf-btn" onClick={() => requestLaunch(w.id)}>
                  {w.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* WF-3 A3：运行历史（localStorage 持久化，点击恢复产物视图） */}
      <div className="sf-agent-history">
        <div className="sf-agent-run-head">
          <div className="sf-agent-wf-title" style={{ margin: 0 }}>
            {t.historyTitle}
          </div>
          {completedRuns.length > 0 && (
            <button className="sf-link-btn sf-agent-history-clear" onClick={clearCompletedRuns}>
              {t.clearHistory}
            </button>
          )}
        </div>
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
      </div>

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
