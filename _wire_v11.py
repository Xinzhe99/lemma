import io

def patch(path, old, new):
    s = io.open(path, encoding='utf-8').read()
    if new in s:
        print('skip:', path, '|', new[:50].replace('\n',' '))
        return
    if old not in s:
        raise SystemExit('ANCHOR MISS in %s: %r' % (path, old[:70]))
    s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('patched:', path)

ROOT = 'F:/Working/Scholarforge/'

# ============ AgentPanel：ChatPanel 新 props + PlanCard 渲染 ============
p = ROOT + 'apps/desktop/src/panels/AgentPanel.tsx'

# 1) imports
patch(p,
    "import {\n  BUILTIN_WORKFLOWS,",
    "import {\n  BUILTIN_WORKFLOWS,\n  type ChatLabels,\n  type MentionItem,\n  type SlashMenuItem,")

patch(p,
    "import {\n  abortChat,\n  resolveProvider,\n  sendChatMessage,\n  CITATION_RULE,\n  polishSelection,\n} from '../aiActions';",
    "import {\n  abortChat,\n  abortPlan,\n  executePlan,\n  resolveProvider,\n  runPlannedTask,\n  sendChatMessage,\n  skipFailedStep,\n  CITATION_RULE,\n  polishSelection,\n} from '../aiActions';")

patch(p,
    "import { ReviewPanel } from './ReviewPanel';",
    "import { ReviewPanel } from './ReviewPanel';\nimport { useAgentPlansStore } from '../state/agentPlans';\nimport { PlanCard } from '../components/PlanCard';\nimport { jumpTo } from '../editorJump';\nimport { useLibraryStore } from '../state/libraryStore';")

# 2) providerLabel 附近加 plans 订阅（找一个稳定锚）
patch(p,
    "  const providerLabel = useMemo(() => resolveProvider().label, [providers, activeProviderId]);",
    "  const providerLabel = useMemo(() => resolveProvider().label, [providers, activeProviderId]);\n  const plans = useAgentPlansStore((s) => s.plans);\n  const libraryPapers = useLibraryStore((s) => s.papers);")

# 3) ChatPanel props wiring
patch(p,
    """          <ChatPanel
            session={session}
            onSend={(text) => send(text)}
            onStop={() => abortChat()}
            placeholder={t.chatPlaceholder}
          />""",
    """          <ChatPanel
            session={session}
            onSend={(text) => send(text)}
            onStop={() => abortChat()}
            placeholder={t.chatPlaceholder}
            onCitekeyClick={(key) => {
              const hit = libraryPapers.find((p) => p.citekey === key);
              if (hit) useUiStore.getState().setSidebarTab('library');
            }}
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
            onRegenerate={() => {
              if (!session) return;
              const lastUser = [...session.messages].reverse().find((m) => m.role === 'user');
              if (lastUser) void sendChatMessage(lastUser.content);
            }}
            onEditResend={(text) => send(text)}
            slashItems={BUILTIN_WORKFLOWS.map((w) => ({ id: w.id, label: `/${w.name}`, hint: w.description }))}
            mentionItems={[
              ...libraryPapers.slice(0, 200).map((p) => ({ id: p.id, label: p.citekey, type: 'paper' as const })),
              ...Object.keys(useWorkspaceStore.getState().files).map((f) => ({ id: f, label: f, type: 'file' as const })),
            ]}
          />""")

# 4) PlanCard 渲染：在 AI 改稿区之后插入计划卡片区（对所有 plan 渲染最近一条）
patch(p,
    "      <div className=\"sf-agent-chat\">",
    """      {Object.entries(plans).slice(-1).map(([msgId, exec]) => (
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
      <div className="sf-agent-chat\">""")

# ============ commands：agent.plan ============
p = ROOT + 'apps/desktop/src/commands.ts'
patch(p,
    "    {\n      id: 'agent.newSession',",
    "    {\n      id: 'agent.plan',\n      title: ctx.t('cmd.agentPlan'),\n      hint: ctx.t('hint.agent'),\n"
    "      run: () => {\n"
    "        void import('../dialogs').then(async ({ promptDialog }) => {\n"
    "          const task = await promptDialog(ctx.t('plan.taskPrompt'));\n"
    "          if (task && task.trim()) void import('./aiActions').then(({ runPlannedTask }) => runPlannedTask(task.trim()));\n"
    "        });\n      },\n    },\n"
    "    {\n      id: 'agent.newSession',")

# ============ i18n keys ============
p = ROOT + 'apps/desktop/src/i18n.ts'
patch(p,
    "  'cmd.importReviews': { zh: '导入真实审稿意见（Word/PDF/文本 → Rebuttal）', en: 'Import real reviews (Word/PDF/text → Rebuttal)' },",
    "  'cmd.importReviews': { zh: '导入真实审稿意见（Word/PDF/文本 → Rebuttal）', en: 'Import real reviews (Word/PDF/text → Rebuttal)' },\n"
    "  'cmd.agentPlan': { zh: '计划模式：先规划后逐步执行（复杂任务）', en: 'Plan mode: plan first, then execute step by step' },\n"
    "  'plan.taskPrompt': { zh: '描述任务（agent 将先给出执行计划）', en: 'Describe the task (agent will plan first)' },")

# ============ demo routes: plan mode ============
p = ROOT + 'packages/agent-hub/src/providers/demo.ts'
s = io.open(p, encoding='utf-8').read()
if "'plan'" not in s and '输出执行计划' not in s:
    anchor = "{ id: 'w10-report'"
    assert anchor in s
    plan_route = (
        "  { id: 'plan', keywords: ['输出执行计划'], script: [\n"
        "    '> 漠�? 演示数据（内置示例，配置模型服务后为真实 AI 规划）',\n"
        "    '',\n"
        "    '```json',\n"
        "    '{\"goal\": \"为投稿准备最终检查\", \"steps\": [',\n"
        "    '  {\"id\": \"s1\", \"title\": \"检查引用完整性\", \"detail\": \"扫描全文 cite 与 refs.bib 对账，列出悬空引用\", \"usesTools\": [\"citation.validate\"]},',\n"
        "    '  {\"id\": \"s2\", \"title\": \"格式与术语一致性\", \"detail\": \"术语表比对 + 章节编号检查\"},',\n"
        "    '  {\"id\": \"s3\", \"title\": \"生成检查报告\", \"detail\": \"汇总为结构化报告供确认\"}',\n"
        "    ']}',\n"
        "    '```',\n"
        "  ].join('\\\\n') },\n"
        "  { id: 'plan-step', keywords: ['逐步骤说明'], script: [\n"
        "    '> 演示数据：本步骤已完成（引用核查：3 处悬空引用已定位，详见 diff 审批卡）。',\n"
        "  ].join('\\\\n') },\n"
    )
    # 修正上面第一行的乱码字符
    plan_route = plan_route.replace("'> 漠�? 演示数据", "'> ⚠️ 演示数据")
    s = s[:s.index(anchor)] + plan_route + s[s.index(anchor):]
    io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
    print('plan demo routes added')
else:
    print('plan demo routes already present')

print('wave1 integration wired')
