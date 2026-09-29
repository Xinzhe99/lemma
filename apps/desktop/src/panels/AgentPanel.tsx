/**
 * Agent 面板（集成核心）：
 * - 会话：Context Pack 注入（大纲/术语表/相关文献检索）→ Provider 流式回复 → 引用核查护栏；
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
import { buildContextPack, extractGlossary, renderContextPackMd, validateCitations } from '@scholarforge/knowledge';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useUiStore } from '../state/uiStore';
import { bibCitekeys, combinedDoc, outlineAcrossFiles } from '../projectDoc';

const CITATION_RULE =
  '\n\n## 引用规则（必须遵守）\n引用文献时只能使用上文「相关文献」中列出的 citekey，格式 [citekey p.页码]；禁止编造未列出的引用。';

interface ProviderChoice {
  provider: ChatProvider;
  model: string;
  label: string;
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
    };
  }
  return { provider: new EchoProvider(), model: 'echo', label: '回显模式（未配置模型服务）' };
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

  const [workflow, setWorkflow] = useState<WorkflowUiState | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [contextPreview, setContextPreview] = useState('');

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

  // 启动内置工作流
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
