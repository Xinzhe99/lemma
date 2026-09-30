/**
 * Agent 面板（集成核心）：
 * - 会话：Context Pack 注入 → 流式回复（真实 provider 可调用只读论文域工具，多轮回填）→ 引用核查护栏；
 * - AI 改稿：润色当前文件 / 起草新章节 → diff 提案 → 人工审批（采纳前强制快照，可随时恢复）；
 * - 工作流：内置 WorkflowDef 经 WorkflowRun 引擎执行（并行分支 + checkpoint 人工确认，步骤可带工具）。
 * Provider 解析：设置里已配置并激活的 OpenAI 兼容服务；否则回显模式（零后端演示）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_WORKFLOWS,
  ChatPanel,
  WorkflowRun,
  WorkflowRunView,
  useAgentHubStore,
  type WorkflowStepUiStatus,
} from '@scholarforge/agent-hub';
import type { WorkflowDef } from '@scholarforge/shared';
import { DiffView } from '@scholarforge/editor';
import { useSettingsStore } from '../state/settingsStore';
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
import { ReviewPanel } from './ReviewPanel';

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

const WORKFLOW_VAR_DEFAULTS: Record<string, string> = {
  section: 'Introduction',
  text: '本文提出了一种面向科研写作的智能体工作流。',
  target: 'NeurIPS',
  paper: 'ScholarForge 演示论文',
  selection: 'In order to demonstrate the pipeline, we utilize a number of examples.',
  styleNotes: '保持简洁',
};

export function AgentPanel() {
  const sessions = useAgentHubStore((s) => s.sessions);
  const activeSessionId = useAgentHubStore((s) => s.activeSessionId);
  const newSession = useAgentHubStore((s) => s.newSession);

  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);

  const launchRequest = useUiStore((s) => s.workflowLaunch);
  const setWorkflowLaunch = useUiStore((s) => s.setWorkflowLaunch);
  const agentAction = useUiStore((s) => s.agentAction);

  const proposal = useProposalStore((s) => s.proposal);
  const setProposal = useProposalStore((s) => s.setProposal);
  const clearProposal = useProposalStore((s) => s.clearProposal);
  const note = useProposalStore((s) => s.note);
  const setNote = useProposalStore((s) => s.setNote);

  const [workflow, setWorkflow] = useState<WorkflowUiState | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextPreview, setContextPreview] = useState('');
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  const checkpointResolve = useRef<((input: string) => void) | null>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const providerLabel = useMemo(() => resolveProvider().label, [providers, activeProviderId]);

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
      setNote('请先在编辑器打开一个 .tex 文件');
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
        via = '规则润色（离线）';
      }
      if (!after.trim()) {
        setNote('模型未返回有效内容，请重试');
      } else if (after.trim() === before.trim()) {
        setNote('未产生修改建议（离线规则未命中冗余表达；配置模型服务可获得深度润色）');
      } else {
        setProposal({ file, before, after, kind: 'polish', label: 'AI 润色', via });
      }
    } catch (e) {
      setNote(`润色失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setAiBusy(null);
    }
  };

  const draftNewSection = async () => {
    const file = activeTexFile();
    if (!file) {
      setNote('请先在编辑器打开一个 .tex 文件');
      return;
    }
    const title = window.prompt('新章节标题', '讨论（Discussion）');
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
        via = '离线模板起草';
      }
      if (!draft.trim()) {
        setNote('模型未返回有效内容，请重试');
        return;
      }
      const after = `${before.trimEnd()}\n${draft.trim()}\n`;
      setProposal({ file, before, after, kind: 'draft-section', label: `起草新章节：${title.trim()}`, via });
    } catch (e) {
      setNote(`起草失败：${e instanceof Error ? e.message : String(e)}`);
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
    setNote(
      token
        ? '已采纳并回传给模型（agent 将基于修改后的稿件继续）'
        : `已采纳「${proposal.label}」并自动创建快照（编辑器标签栏「历史」可恢复）`,
    );
    if (token) resolveToolApproval(token, true);
  };

  const discardProposal = () => {
    const token = proposal?.token;
    clearProposal();
    if (token) {
      resolveToolApproval(token, false);
      setNote('已拒绝该修改并回传给模型');
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
  // ------------------------------------------------------------------

  const startWorkflow = async (id: string, presetVars?: Record<string, string>) => {
    const def = BUILTIN_WORKFLOWS.find((w) => w.id === id);
    if (!def) return;

    const vars: Record<string, string> = { ...presetVars };
    for (const key of def.inputs) {
      if (vars[key] !== undefined && vars[key] !== '') continue;
      const value = window.prompt(`工作流「${def.name}」需要输入：${key}`, WORKFLOW_VAR_DEFAULTS[key] ?? '');
      if (value === null) return;
      vars[key] = value.trim();
    }

    setWorkflow({
      def,
      statuses: Object.fromEntries(def.steps.map((s) => [s.id, 'pending'])) as Record<string, WorkflowStepUiStatus>,
      outputs: {},
      phase: 'running',
    });

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
  };

  // 命令面板触发的待启动工作流
  useEffect(() => {
    if (launchRequest) {
      setWorkflowLaunch(null);
      void startWorkflow(launchRequest);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest]);

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
          新会话
        </button>
      </div>

      {showContext && contextPreview && (
        <details className="sf-agent-context" open>
          <summary>当前上下文包预览</summary>
          <pre>{contextPreview}</pre>
        </details>
      )}

      {/* AI 改稿（diff 审批闭环） */}
      <div className="sf-agent-ai">
        <div className="sf-agent-wf-title">AI 改稿（diff 审批）</div>
        <div className="sf-agent-ai-actions">
          <button className="sf-btn" onClick={() => void polishCurrentFile()} disabled={!!aiBusy}>
            {aiBusy === '润色' ? '润色中…' : '润色当前文件'}
          </button>
          <button className="sf-btn" onClick={() => void draftNewSection()} disabled={!!aiBusy}>
            {aiBusy === '起草' ? '起草中…' : '起草新章节'}
          </button>
        </div>
        {note && <p className="sf-agent-note">{note}</p>}
        {proposal && (
          <div className="sf-agent-approval">
            <div className="sf-agent-run-head">
              <strong>{proposal.label}</strong>
              <span className="sf-chip dim">{proposal.via}</span>
              <span className={`sf-chip ${proposal.token ? 'err' : 'warn'}`}>
                {proposal.token ? 'Agent 等待裁决' : '待审批'}
              </span>
            </div>
            <DiffView before={proposal.before} after={proposal.after} filename={proposal.file} />
            <div className="sf-lib-dialog-actions">
              <button className="sf-btn" onClick={discardProposal}>
                放弃{proposal.token ? '（回传拒绝）' : ''}
              </button>
              <button className="sf-btn sf-btn--primary" onClick={applyProposal}>
                采纳修改（自动创建快照{proposal.token ? '并回传' : ''}）
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
            placeholder="向 agent 提问（配置模型服务后可自动检索文献库、读取项目上下文）…"
          />
        ) : (
          <p className="placeholder">初始化会话…</p>
        )}
      </div>

      <div className="sf-agent-workflows">
        <div className="sf-agent-wf-title">内置工作流</div>
        {workflow ? (
          <div className="sf-agent-run">
            <div className="sf-agent-run-head">
              <strong>{workflow.def.name}</strong>
              <span
                className={`sf-chip ${workflow.phase === 'done' ? 'ok' : workflow.phase === 'failed' ? 'err' : 'warn'}`}
              >
                {workflow.phase === 'done' ? '已完成' : workflow.phase === 'failed' ? '失败' : '运行中'}
              </span>
              <button className="sf-link-btn" onClick={() => setWorkflow(null)}>
                收起
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
                  void startWorkflow('w7-rebuttal', { reviews, manuscript: combinedDoc(useWorkspaceStore.getState().files) })
                }
              />
            )}
          </div>
        ) : (
          <ul className="sf-agent-wf-list">
            {BUILTIN_WORKFLOWS.map((w) => (
              <li key={w.id}>
                <button className="sf-btn sf-agent-wf-btn" onClick={() => void startWorkflow(w.id)}>
                  {w.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
