# Lemma × agent-foundation 能力对齐矩阵

> 对照对象：[converge-ai-labs/agent-foundation](https://github.com/converge-ai-labs/agent-foundation)
> （核心目录：`spec/a13n-harness/17-core-capability-catalog.md` + `docs/a13n-harness/capabilities.md`，
> 强制组合 15 项 + 可选角色 25 项，共 40 项）
> 核对日期：2026-10-07 · Lemma v7.8.0（v7.5.0 首次核对；v7.8.0 复核并修正计数口径）

图例：✅ 已对齐（能力等价或更强） · 🟡 部分对齐（v7.5.0 补齐） · ⛔ 不适用（附理由）

## 一、强制组合（Mandatory Harness Composition）

| # | agent-foundation 能力 | Lemma 实现 | 状态 | 说明 |
|---|---|---|---|---|
| 1 | 逻辑模型解析器 `ResolveModelId` | `resolveProviderRouted('simple'/'complex')` 按任务复杂度路由 cheap/flagship | ✅ | 多 provider 智能路由等价 |
| 2 | 请求亲和（session_affinity_header / openai_prompt_cache_key） | v7.5.0 F6：`ChatRequest.cacheKey` → 请求体 `prompt_cache_key`，同会话稳定，设置可关 | ✅ | v7.5.0 补齐 |
| 3 | 类型化运行依赖 `AgentContext` | 工具执行器依赖注入（createToolExecutor + ApprovalFn） | ✅ | 架构原语等价实现 |
| 4 | 用量上报 `UsageCapability` | agentUsage store 逐次记录（input/output/延迟）+ provider usage 事件 | ✅ | |
| 5 | 模型成本计价 `ModelCostCapability` | 会话 token 预算（v7.4.0 C）+ 运行时预算投影（v7.5.0 F2） | 🟡→✅ | BYOK 本地桌面无平台账单，以 token 预算 + 用量记录等价覆盖 |
| 6 | 观测 owner（OTel tracing/metrics） | — | ⛔ | 单机桌面应用，无服务网格；用量/诊断在本地 store |
| 7 | 主动转向 `SteeringCapability`（运行中注入消息） | 停止按钮中止 + 会话轮次制 | ⛔ | Lemma 是单人桌面写作的轮次会话模型；运行中注入式转向面向多租户服务场景 |
| 8 | 工具面解析（WrapperToolset/声明式替代） | `PAPER_TOOLS` 注册表 + `ENABLED_TOOL_NAMES` 启用过滤 | ✅ | 22 工具注册表、19 个接通 |
| 9 | 工具执行边界（bounded 输出/策略执行） | `checkCall` 权限门 + 执行器输出截断（paper.read 12k、git.show 6k 等） | ✅ | |
| 10 | 消息完整性过滤器（孤儿/重复 tool 结果清理） | v7.5.0 F3：`sanitizeAgentMessages`（孤儿丢弃/重复去重/悬空 tool_calls 剥离） | ✅ | v7.5.0 补齐 |
| 11 | 模型上下文协调器 | system prompt 组装管线（Context Pack → 规则 → 人设 → 运行时上下文） | ✅ | |
| 12 | 续跑协调器（版本化命名空间状态） | 会话持久化恢复（agentSessionPersist，跨重启续跑） | ✅ | |
| 13 | 模型自愈 `SelfHealingModel`（一次性历史修复重放） | v7.5.0 F3：400 类协议错误 → 清理消息序列 → 原轮重试一次；修不动透传原错误 | ✅ | v7.5.0 补齐 |
| 14 | 中断流语义恢复（HarnessRunStream 有界恢复） | v7.4.0 B：工具调用中断恢复（不谎称回滚，注入状态检查指引） | ✅ | v7.4.0 已落地 |
| 15 | 视频输入 `VideoUrlCapability` | 图片贴图（多模态）+ PDF 附件 | ⛔ | 学术写作无视频输入场景；图像/文档已覆盖 |

## 二、可选能力角色（Optional Capability Roles）

| # | agent-foundation 能力 | Lemma 实现 | 状态 | 说明 |
|---|---|---|---|---|
| 16 | 运行时上下文 `RuntimeContextCapability`（时间/用时/用量投影） | v7.5.0 F2：`buildRuntimeContextBlock`（当前时间/上下文规模/预算用量）注入 system | ✅ | v7.5.0 补齐 |
| 17 | 工作区大纲 `WorkspaceOutlineCapability` | `outlineAcrossFiles` + Context Pack（带 memo 缓存） | ✅ | |
| 18 | 文件上下文 `FileContextCapability`（AGENTS.md） | v7.5.0 F1：`projectInstructions.ts`——AGENTS.md/LEMMA.md 注入所有生成，含模板 | ✅ | v7.5.0 补齐 |
| 19 | 压缩与交接（Compaction + Handoff） | v7.5.0 F4：`compactHistoryForSend` 摘要式压缩（阈值触发/增量缓存/失败回退机械截断） | ✅ | v7.5.0 补齐；交接由会话持久化承担 |
| 20 | 冷启动历史削减（已消费 tool 结果丢弃） | 发送历史只含 user/assistant（tool 消息全剥离） | ✅ | 原有实现即等价 |
| 21 | 文件记忆 `FileMemoryCapability` | agentMemory store + `memory.write` 工具（经审批）+ 注入 Context Pack | ✅ | |
| 22 | 记录记忆 `RecordMemoryCapability` | 文献库（Zotero 同步/BibTeX）+ RAG 混合检索 | ✅ | |
| 23 | 技能与发现 `SkillsCapability` | 论文域工具直接内置（18+1 工具），无需技能分发层 | ⛔ | 领域封闭工具集，分发机制无增益 |
| 24 | 工作状态（task/note 工具） | 计划模式（PlanCard：规划→批准→逐步执行→状态写回） | ✅ | 多步任务由计划模式管理，比 task-note 更结构化 |
| 25 | 结构化用户交互 `UserInteractionCapability`（ask_user_question） | v7.5.0 F5：`user.ask` 工具 + AskUserCard 提问卡（选项/自由输入/阻塞等待/中止结算） | ✅ | v7.5.0 补齐 |
| 26 | 文档与网络（Documents/Web Toolset） | `web.search_scholar`（arXiv+Crossref 双源回退）+ 附件转换（PDF/docx/CSV） | ✅ | |
| 27 | 网络域限制（allow/deny domains） | 检索只打学术白名单源（arXiv/Crossref API） | ✅ | 白名单式，天然受限 |
| 28 | 网络后端回退链（backend_priority） | arXiv 与 Crossref `Promise.allSettled` 聚合 + `mergeSearchHits` | ✅ | |
| 29 | 原生图像生成 `NativeImageGenerationCapability` | TikZ 图生成 + 图像→LaTeX 公式/表格转换 | ⛔ | 论文图形以 TikZ/代码生成为主，位图生成不适用 |
| 30 | 子代理执行 `SubagentCapability`（inline/async） | 计划模式分解执行（同 agent 分步） | ⛔→🟡 | 单人桌面写作场景单 agent + 计划分解足够；多子代理并行属服务化场景 |
| 31 | 受限 CodeAct 编排（Python runner） | 声明式工具 + 全量写级审批 | ⛔ | 有意取舍：声明式工具面 + 人审比代码执行面更安全可控 |
| 32 | 检查点观测（消息边界 checkpoint） | git 自动提交 + 会话产物清单 + 会话持久化 | ✅ | |
| 33 | 请求内容兼容过滤器（多模态 copy-on-write） | 历史图片剥离（v6.8.0）+ 非多模态模型贴图拦截 | ✅ | |
| 34 | 工具权限 `ToolPermissionsCapability`（allow/deny/ask/review） | 权限策略 balanced：read 放行 / execute 放行 / write 全量 diff 审批 / export 拦截 | ✅ | 人审强于模型审查 |
| 35 | 工具风险审查（model-backed review，shell 特化） | 阻塞式人工 diff 审批（hunk 级接受/拒绝） | ✅ | 以更强的人审替代机审 |
| 36 | 工具代理 `ToolProxyCapability`（分组发现） | — | ⛔ | 19 个工具规模不需要动态发现分组 |
| 37 | 上下文 MCP（URL-based MCP） | — | ⛔ | 本地优先桌面应用，无 MCP 服务生态依赖 |
| 38 | 客户端外部工具（deferred client tools） | — | ⛔ | 同上，工具面由内置注册表承担 |
| 39 | 基于工具的结构化输出 | 纯文本输出 + 解析层（parsePlan 等） | ✅ | |
| 40 | 瞬态错误自动重试 `ModelRecoveryPolicy` | v7.4.0 A：`retryPolicy.ts`（1s→2s→4s 退避 ×3，永久错误不重试） | ✅ | v7.4.0 已落地 |

## 三、汇总

| 状态 | 数量 | 占比 |
|---|---|---|
| ✅ 已对齐 | 30 | 75% |
| 🟡 部分对齐 | 1 | 3% |
| ⛔ 不适用（本地桌面产品定位） | 9 | 22% |

**v7.5.0 新补齐 7 项**：AGENTS.md 项目指令（#18）、运行时上下文（#16）、消息完整性过滤（#10）、
模型自愈（#13）、摘要式压缩（#19）、结构化提问 user.ask（#25）、请求亲和 prompt_cache_key（#2）。
**v7.4.0 已落地 3 项**：瞬态重试（#40）、中断恢复（#14）、会话 token 预算（#5）。

不适用项的共同理由：agent-foundation 是**多租户服务平台**（环境守护进程、K8s 部署、MCP 生态、
子代理编排、OTel 观测），Lemma 是**本地优先单机桌面应用**（BYOK、内置 git、本地 Whisper/RAG）；
平台化能力在单机场景无落点，对应需求已由更贴合桌面形态的等价实现覆盖。
