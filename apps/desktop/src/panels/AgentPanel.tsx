/**
 * Agent 面板（集成核心）：
 * - 会话：Context Pack 注入（大纲/术语表/相关文献检索）→ Provider 流式回复 → 引用核查护栏；
 * - AI 改稿：润色当前文件 / 起草新章节 → diff 提案 → 人工审批（采纳前强制快照，可随时恢复）；
 * - 工作流：内置 WorkflowDef 经 WorkflowRun 引擎执行（并行分支 + checkpoint 人工确认）。
 * Provider 解析：设置里已配置并激活的 OpenAI 兼容服务；否则回显模式（零后端演示）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_WORKFLOWS,
  ChatPanel,
  EchoProvider,
  OpenAICompatibleProvider,
  WorkflowRun,
  WorkflowRunView,
  useAgentHubStore,
  type ChatProvider,
  type WorkflowStepUiStatus,
} from '@scholarforge/agent-hub';
import type { AgentMessage, WorkflowDef } from '@scholarforge/shared';
import { DiffView } from '@scholarforge/editor';
import { buildContextPack, extractGlossary, renderContextPackMd, validateCitations } from '@scholarforge/knowledge';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useProposalStore } from '../state/proposalStore';
import { useUiStore } from '../state/uiStore';
import { bibCitekeys, combinedDoc, outlineAcrossFiles } from '../projectDoc';
import { buildPolishPrompt, draftSectionOffline, extractLatexBody, rulePolish } from '../polish';

const CITATION_RULE =
  '\n\n## 引用规则（必须遵守）\n引用文献时只能使用上文「相关文献」中列出的 citekey，格式 [citekey p.页码]；禁止编造未列出的引用。';

interface ProviderChoice {
  provider: ChatProvider;
  model: string;
  label: string;
  real: boolean;
}

function resolveProvider(): ProviderChoice {
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
  return { provider: new EchoProvider(), model: 'echo', label: '回显模式（未配置模型服务）', real: false };
}

function outlineMd(files: Record<string, string>): string {
  return outlineAcrossFiles(files)
    .map(({ file, node }) => `${'  '.repeat(Math.max(0, node.level - 1))}- ${node.title}（${file}）`)
    .join('\n');
}

async function buildContextPackMd(query: string): Promise<string> {
  const files = useWorkspaceStore.getState().files;
  const search = useLibraryStore.getState().searchKnowledge;
  const chunks = await search(query, 5);
  const pack = buildContextPack({
    outline: outlineMd(files),
    glossary: extractGlossary(combinedDoc(files)),
    relatedChunks: chunks,
    projectMemory: ['演示项目约定：所有 AI 修改须经 diff 审批后落盘，引用必须本地可验证。'],
  });
  return renderContextPackMd(pack);
}

function toAgentMessages(system: string, history: AgentMessage[], user: string): AgentMessage[] {
  const now = Date.now();
  const base: AgentMessage[] = [
    { id: 'sys', role: 'system', content: system, createdAt: now },
    ...history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.trim())
      .map((m) => ({ id: m.id, role: m.role, content: m.content, createdAt: m.createdAt })),
  ];
  base.push({ id: 'user-new', role: 'user', content: user, createdAt: now + 1 });
  return base;
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

  const abortRef = useRef<AbortController | null>(null);
  const checkpointResolve = useRef<((input: string) => void) | null>(null);

  const session = sessions.find((s) => s.id === activeSessionId) ?? sessions[0] ?? null;

  const providerLabel = useMemo(() => {
    const cfg = providers.find((p) => p.id === activeProviderId);
    if (cfg && cfg.baseUrl.trim() && cfg.apiKey.trim()) return `${cfg.label} · ${cfg.model || 'default'}`;
    return '回显模式（未配置模型服务）';
  }, [providers, activeProviderId]);

  // 确保存在会话
  useEffect(() => {
    if (!useAgentHubStore.getState().activeSessionId) {
      newSession('host');
    }
  }, [newSession]);

  // ------------------------------------------------------------------
  // 会话：流式回复 + 引用核查护栏
  // ------------------------------------------------------------------

  const send = async (text: string) => {
    const hub = useAgentHubStore.getState();
    const sessionId = session?.id ?? hub.newSession('host');
    if (session?.status === 'streaming') return;

    const system = await buildContextPackMd(text);
    const history = (useAgentHubStore.getState().sessions.find((s) => s.id === sessionId)?.messages ?? []).slice(0, -2);
    hub.sendMessage(sessionId, text);

    const { provider, model } = resolveProvider();
    const abort = new AbortController();
    abortRef.current = abort;
    let acc = '';
    try {
      for await (const ev of provider.complete({
        messages: toAgentMessages(system + CITATION_RULE, history, text),
        model,
        signal: abort.signal,
      })) {
        if (ev.type === 'text-delta') {
          acc += ev.delta;
          useAgentHubStore.getState().appendDelta(sessionId, ev.delta);
        } else if (ev.type === 'error') {
          useAgentHubStore.getState().appendDelta(sessionId, `\n\n[Provider 错误] ${ev.message}`);
          break;
        }
      }
    } catch (e) {
      useAgentHubStore
        .getState()
        .appendDelta(sessionId, `\n\n[调用异常] ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      abortRef.current = null;
    }

    // 学术诚信护栏：引用核查（5.6）
    const validKeys = [
      ...new Set([
        ...useLibraryStore.getState().papers.map((p) => p.citekey),
        ...bibCitekeys(useWorkspaceStore.getState().files),
      ]),
    ];
    const check = validateCitations(acc, validKeys);
    if (!check.ok) {
      useAgentHubStore
        .getState()
        .appendDelta(
          sessionId,
          `\n\n---\n⚠️ **引用核查（学术诚信护栏）**：以下引用未在本地文献库或 refs.bib 中找到，疑似幻觉引用，请核实：${check.invalid
            .map((k) => `[${k}]`)
            .join(' ')}`,
        );
    }
    useAgentHubStore.getState().finishSession(sessionId, 'idle');
  };

  // ------------------------------------------------------------------
  // AI 改稿：润色 / 起草 → diff 提案 → 审批
  // ------------------------------------------------------------------

  const activeTexFile = (): string | null => {
    const active = useWorkspaceStore.getState().activeTab;
    return active && active.endsWith('.tex') ? active : null;
  };

  const runProviderText = async (system: string, prompt: string): Promise<string> => {
    const { provider, model } = resolveProvider();
    let acc = '';
    for await (const ev of provider.complete({
      messages: toAgentMessages(system, [], prompt),
      model,
    })) {
      if (ev.type === 'text-delta') acc += ev.delta;
      else if (ev.type === 'error') throw new Error(ev.message);
    }
    return acc;
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
      const { real, model } = resolveProvider();
      let after: string;
      let via: string;
      if (real) {
        const system = await buildContextPackMd('学术润色');
        const reply = await runProviderText(
          system,
          buildPolishPrompt(before),
        );
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
      const { real, model } = resolveProvider();
      let draft: string;
      let via: string;
      if (real) {
        const system = await buildContextPackMd(`起草新章节：${title}`);
        const reply = await runProviderText(
          system,
          `请为当前论文起草一节 \\section{${title.trim()}} 的完整草稿（与现有章节风格一致，引用仅使用上文列出的 citekey）。只输出该节的 LaTeX 源码（首行为 \\section 行），用 latex 代码围栏包裹，不要解释。`,
        );
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
    clearProposal();
    setNote(`已采纳「${proposal.label}」并自动创建快照（编辑器标签栏「历史」可恢复）`);
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
  // 内置工作流
  // ------------------------------------------------------------------

  const startWorkflow = async (id: string) => {
    const def = BUILTIN_WORKFLOWS.find((w) => w.id === id);
    if (!def) return;

    const vars: Record<string, string> = {};
    for (const key of def.inputs) {
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

    const contextMd = await buildContextPackMd(def.description);
    const { provider, model } = resolveProvider();
    const run = new WorkflowRun(def, {
      async runStep(step, ctx) {
        setWorkflow((w) =>
          w ? { ...w, statuses: { ...w.statuses, [step.id]: 'running' } } : w,
        );
        const deps = (step.dependsOn ?? [])
          .map((d) => `【${def.steps.find((x) => x.id === d)?.name ?? d} 的结论】\n${(ctx.priorOutputs[d] ?? '').slice(0, 1500)}`)
          .join('\n\n');
        const prompt = step.prompt.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => vars[k] ?? '');
        let acc = '';
        try {
          for await (const ev of provider.complete({
            messages: toAgentMessages(contextMd + CITATION_RULE, [], `${prompt}${deps ? `\n\n${deps}` : ''}`),
            model,
          })) {
            if (ev.type === 'text-delta') acc += ev.delta;
            else if (ev.type === 'error') throw new Error(ev.message);
          }
        } catch (e) {
          setWorkflow((w) => (w ? { ...w, statuses: { ...w.statuses, [step.id]: 'failed' } } : w));
          throw e;
        }
        setWorkflow((w) =>
          w
            ? { ...w, statuses: { ...w.statuses, [step.id]: 'done' }, outputs: { ...w.outputs, [step.id]: acc } }
            : w,
        );
        return acc;
      },
      async onCheckpoint(step) {
        setWorkflow((w) =>
          w ? { ...w, statuses: { ...w.statuses, [step.id]: 'checkpoint' } } : w,
        );
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
              <span className="sf-chip warn">待审批</span>
            </div>
            <DiffView before={proposal.before} after={proposal.after} filename={proposal.file} />
            <div className="sf-lib-dialog-actions">
              <button className="sf-btn" onClick={clearProposal}>
                放弃
              </button>
              <button className="sf-btn sf-btn--primary" onClick={applyProposal}>
                采纳修改（自动创建快照）
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="sf-agent-chat">
        {session ? (
          <ChatPanel
            session={session}
            onSend={(text) => void send(text)}
            onStop={() => abortRef.current?.abort()}
            placeholder="向 agent 提问；回答将注入 Context Pack 并做引用核查…"
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
                setWorkflow((w) =>
                  w ? { ...w, statuses: { ...w.statuses, [stepId]: 'running' } } : w,
                );
              }}
            />
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
