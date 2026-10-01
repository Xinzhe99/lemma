/**
 * ScriptedDemoProvider（零配置旗舰演示）：
 * 未配置模型服务时替代 EchoProvider——按最后一条 user 消息的关键词路由到预写的
 * 高质量结构化输出（内置工作流 W6/W7/W10/W12/W3 的逐步脚本 + 通用演示说明），
 * 以 8–20 字符小块流式 yield text-delta、块间 15–35ms 模拟打字。
 *
 * 设计约束：
 * - 实现 ChatProvider（id 'demo'），不产生任何 tool-call 事件（工具循环天然不启用）；
 * - 每份输出开头统一带演示声明行，杜绝"回显冒充 AI"的首秀事故；
 * - 关键词取自各内置工作流 YAML 的步骤 prompt 原文；路由顺序经过依赖碰撞设计——
 *   后置步骤（其 user 消息会拼接前置步骤输出作为 deps）的关键词先检查，
 *   且每份脚本内容避免出现其它步骤的路由关键词，保证 DAG 执行时逐路由正确；
 * - 演示内容针对内置示例项目（AI 辅助科研写作方法综述）撰写，审稿意见含具体的
 *   方法/实验评论与可执行修改建议；W12 引用只用库内真实 citekey（引用护栏可过）。
 */
import type { ChatEvent, ChatProvider, ChatRequest } from './types';

/** 每份演示输出开头统一携带的声明行 */
export const DEMO_DISCLAIMER = '> ⚠️ 演示数据（内置示例，配置模型服务后为真实 AI 生成）';

/** 内置演示文献库白名单（与桌面端种子文献/演示 refs.bib 一致） */
export const DEMO_LIBRARY_CITEKEYS: readonly string[] = [
  'vaswani2017attention',
  'brown2020language',
  'openai2023gpt4',
];

export interface ScriptedDemoProviderOptions {
  /** 每小块最小字符数（按 Unicode 码点计），默认 8 */
  minChunkChars?: number;
  /** 每小块最大字符数，默认 20 */
  maxChunkChars?: number;
  /** 块间最小延时 ms，默认 15；测试可传 0 关闭等待 */
  minDelayMs?: number;
  /** 块间最大延时 ms，默认 35 */
  maxDelayMs?: number;
}

// ---------------------------------------------------------------------------
// 演示脚本内容（全部硬编码；撰写时避免出现其它路由关键词，见文件头说明）
// ---------------------------------------------------------------------------

const W6_PREP = `## 审稿简报（Reviewer Briefing）

**稿件要点**（据 Context Pack 与稿件全文归纳）
- 主题：AI 辅助科研写作的方法综述与工作站设计，题目为「ScholarForge 演示论文：AI 辅助科研写作方法综述」。
- 核心主张：以「一篇论文的完整生命周期」为单位组织写作环境，比单点工具（语法检查、引用格式化）更能减少上下文切换成本。
- 方法框架：三阶段流水线——上下文组装（大纲/术语表/文献摘要）→ 多角色起草 → 修改以 diff 呈现并由作者裁决。
- 实验现状：实验设置节为演示性静态文本，含一个余弦相似度检索公式，暂无对比实验与用户研究。

**相关已有工作清单**（库内检索命中，供新颖性核对）
- vaswani2017attention（NeurIPS 2017）：Transformer 架构，稿件将其作为语言模型技术谱系起点引用。
- brown2020language（NeurIPS 2020）：GPT-3 少样本学习，稿件用它支撑「智能体接管重复性写作环节」的动机。
- openai2023gpt4（arXiv 2023）：GPT-4 技术报告，稿件在多角色起草节引用为能力基线。
- 检索词建议：writing assistance、human-AI co-writing、diff-based revision、retrieval-augmented generation。

**评审侧重点**（对照目标会议常见关注点）
- 方法学：流水线各阶段的输入输出是否形式化定义；安全主张是否有验证。
- 新颖性：相对既有写作辅助工具与智能体编排系统的增量。
- 证据强度：结论是否有实验、误差报告与 artifact 支撑。

（简报完毕。后续三位评审将基于本简报并行评审稿件。）`;

const W6_REVIEWER_METHOD = `## Summary
本文把「AI 辅助科研写作」组织为三阶段流水线：上下文组装（大纲、术语表与相关文献摘要打包）、多角色起草（按章节分派给不同角色的写作与评审智能体）、diff 审批（所有修改以 latexdiff 呈现并由作者逐条采纳或回滚）。问题定义清楚——如何在保留作者最终裁决权的前提下让智能体安全参与稿件修改——且流水线各阶段与稿件结构（主文件 \\input 分章）对应合理。方法部分的主要问题在于：关键机制只做了功能性描述，缺少形式化定义与验证，「安全」这一核心主张目前只由设计意图支撑。

## 优点
1. 问题定义聚焦：以「作者裁决权」为安全边界来设计人机协作写作，边界明确且可检验（每处修改必须经 diff 审批才能落盘）。
2. 流水线与稿件结构同构：上下文包按章节组装、起草按章节分派、审批按 diff 粒度裁决，三个粒度一致，工程上可信。
3. 检索公式（余弦相似度）给出了明确的数学定义，符号 q、d 含义在当前范围内无歧义。

## 缺点
1. 「上下文组装」的检索配置未定义：公式只给了余弦相似度，但嵌入模型、向量维度、分块粒度、索引构建与更新策略全部缺失，读者无法复现该阶段。→ 可执行建议：在方法节补「检索配置」小节，写明嵌入模型与分块策略，并补一组「纯向量 vs 向量+BM25 混合」的消融，报告对下游草稿质量的影响。
2. 「多角色起草」的智能体间信息流未形式化：不同角色对同一段落给出冲突修改时由谁裁决、按什么规则合并，文中没有定义，这直接影响「流水线」这一方法学主张的成立。→ 可执行建议：补一张工作流图与冲突消解规则的伪代码（例如「评审角色意见先合并去重，再交写作角色改写」）；若暂不做，请把主张限定为「顺序流水线」并在限制一节说明。
3. 核心假设未明示也未验证：「作者裁决权保证安全」是一个假设而非结论，误采纳（作者看漏错误修改）的风险没有被度量。→ 可执行建议：在方法节开头列出显式假设清单；在 diff 审批节增加误操作回滚机制的描述，并设计一个小规模误采纳率实验（如 10 名作者 × 20 个含错 diff 的接受/回滚记录）。
4. 实验设置节为静态演示文本，无法支撑「该流水线可提升写作质量」的结论。→ 可执行建议：补充至少一个人工评级实验（清晰度、准确性、作者负担三个维度，3 名评分者，报告一致性系数），或把结论明确降调为「系统设计论文，不做质量主张」。

## Questions
1. 公式中的 q、d 是句子级还是章节级向量？分块粒度与章节边界如何对齐？
2. latexdiff 对数学环境、图表与 \\input 嵌套文件的处理是否经过验证？边界情况（环境跨行拆分）如何呈现？

## Score band
borderline accept（方法框架清晰、方向有价值，但机制形式化与验证不足；按上述建议补强后可达 accept 档）`;

const W6_REVIEWER_DOMAIN = `## Summary
从领域定位看，本文主张的增量是「面向一篇论文完整生命周期的一站式写作工作区」：相对单点写作辅助工具（语法检查、引用格式化、协作编辑），把文献调研、起草、评审仿真、润色与投稿准备纳入同一上下文。动机部分引用 Transformer（vaswani2017attention）、GPT-3 少样本能力（brown2020language）与 GPT-4（openai2023gpt4）交代技术谱系，写作动机成立。主要问题：相关工作覆盖面过窄（仅 3 篇），「缺乏一站式工作区」的新颖性主张没有文献证据支撑，对目标社区的价值论证不足。

## 优点
1. 定位差异化清晰：以「完整生命周期」为单位组织功能，与既有单点工具的对比维度明确，容易让读者抓住主张。
2. 技术谱系引用得当：用三篇代表性文献（架构 → 少样本 → 通用能力）说明「智能体接管重复性写作环节」的可行性，动机链条完整。
3. 安全设计与社区关切对齐：作者裁决权与 diff 审批直接回应了写作工具的诚信与责任问题，这是当前社区最关心的问题之一。

## 缺点
1. 相关工作仅 3 篇且全部来自基础模型谱系，缺少三类直接相关工作：(a) 写作辅助与协作工具谱系（在线 LaTeX 协作、语法与风格检查、参考文献管理）；(b) 人机协作写作的评测工作（质量维度、作者负担、诚信风险）；(c) 智能体编排系统（多角色流水线、工具调用协议）。→ 可执行建议：把相关工作重组为三组，每组 3–5 篇，先共性后差异，最后一段点明本文相对每组的位置；可先在文献库检索「writing assistance」「human-AI co-writing」补齐。
2. 「缺乏面向完整生命周期的一站式工作区」是较强的否定式新颖性主张，但没有引用任何调研或系统综述佐证「缺乏」。→ 可执行建议：要么补充 1–2 篇系统综述或工具调研作为证据，要么把主张降调为「少有工作以完整生命周期为单位组织写作环境」。
3. 与目标会议的匹配度论证缺失：稿件未说明该工作适合 demo track、系统 track 还是长文 track，三者的评审标准差异很大。→ 可执行建议：在引言结尾加一段定位说明（如「本文以系统论文标准自评：贡献在架构与安全机制，质量评测见第 X 节」），并按所选 track 调整贡献清单的顺序。
4. 「既有工具多聚焦单点功能」的表述缺少具体对照对象，容易被评审视为稻草人。→ 可执行建议：给出 2–3 个具体系统的名字与其不支持的能力清单，把比较落到功能矩阵。

## Questions
1. 相对同时管理文献与稿件的现有工作站型工具，本文的不可替代点是安全机制（裁决权）还是上下文组织（生命周期）？请明确首要贡献。
2. 目标投稿场所是哪一类 track？这决定新颖性论证应侧重工程贡献还是实证贡献。

## Score band
weak accept（定位与动机清晰、安全设计契合社区关切；相关工作补齐并降调新颖性主张后更稳）`;

const W6_REVIEWER_STAT = `## Summary
本环节只评估实验结论的可信度与他人复现的可行性。现状：稿件的实验设置节为演示性静态文本，没有对比基线、没有重复实验、没有方差或显著性报告，复现要素（代码、数据、提示词、运行环境）均未说明。因此「流水线有效/提升写作质量」类结论目前缺乏任何实验证据；方法各组件（检索、起草、审批）也没有单独的误差分析。以下意见不针对写作质量与主张的新颖性。

## 优点
1. 作者没有报告未做的实验，实验设置节明确标注「演示项目仅包含静态文本」，这在报告诚信上是加分项。
2. 检索公式给出了封闭形式的定义（余弦相似度），如果补充配置细节，该组件是可独立复现的。

## 缺点
1. 无重复实验与方差报告：所有将来补充的实验（人工评级、误采纳率）应至少 3 次重复（或多名评分者），报告均值±标准差，而不是单次结果。→ 可执行建议：在实验协议中预先写明重复次数、随机种子管理与报告模板（mean±std），再开始收集数据。
2. 显著性检验缺位：任何「A 优于 B」的对比结论都需要检验支持。→ 可执行建议：成对比较用 paired t-test 或 Wilcoxon 符号秩检验（评级数据非正态时），报告 p 值与效应量（Cohen's d 或 Cliff's delta）；多条件对比时先做方差分析并做多重比较校正。
3. 基线公平与数据泄漏风险未讨论：若对比「有/无上下文包」的起草质量，需保证两组使用相同模型与温度；文献摘要进入上下文包时若包含评测集文本，会造成泄漏。→ 可执行建议：补一节「威胁有效性」，逐条列出基线设置对齐策略与泄漏防护（评测文献从上下文包中剔除）。
4. 复现要素缺失：提示词模板、智能体角色配置、模型版本与采样参数、硬件环境都没有附件说明。→ 可执行建议：公开 artifact（提示词库 + 配置文件 + 评审记录原始数据），并在文中给出「复现清单」表格逐项打钩。

## Questions
1. 计划中的评测是作者自评还是盲评？评分者是否与作者独立？
2. 模型输出的随机性（温度、采样）如何控制？固定种子还是多次采样取中位数？

## Score band
borderline（当前证据不足以支撑任何有效性结论；补齐第 1、2 条所述报告规范后可重新评估）`;

const W6_META = `## Meta 汇总（领域主席）

三位评审的意见已合并去重。整体倾向：**borderline**——问题定义、安全设计与工程可信度获得一致认可（R1、R2 均给出正面评价），但机制形式化不足与实验证据缺失是共同风险（R1 缺点 1–2 与 R3 缺点 1–4 相互印证）。若作者能在修改稿中补齐「必须修改」档，达到 accept 档的概率较高。

### 优先级清单

**必须修改（不修改则难以接收）**
1. 检索配置未定义、智能体冲突消解未形式化（来源：R1-缺点1、R1-缺点2）→ 补「检索配置」小节 + 工作流图与伪代码。
2. 实验证据缺失：无重复、无方差、无显著性检验（来源：R3-缺点1、R3-缺点2）→ 按实验协议模板补齐报告规范。
3. 相关工作覆盖面过窄，仅 3 篇（来源：R2-缺点1）→ 重组为三组并补齐文献。

**建议修改（显著提升稿件质量）**
4. 新颖性主张降调或补证据（来源：R2-缺点2）。
5. 显式假设清单 + 误采纳率实验（来源：R1-缺点3）。
6. 基线对齐与数据泄漏防护说明（来源：R3-缺点3）。

**可答辩（说明即可，不必改）**
7. 目标 track 定位（来源：R2-缺点3、R2-问题2）——可在 rebuttal 中说明。
8. latexdiff 边界情况处理（来源：R1-问题2）——回答即可。

### 审稿人分歧
- R2 给出 weak accept、R3 给出 borderline：分歧点在「系统设计贡献是否可以部分替代实证贡献」。这不是事实矛盾，建议修改时正面回应（在限制一节明确本文的证据边界）。

（请在检查点勾选需要处理的弱项并给出取舍意见，下一环节将按勾选项生成逐项修改方案。）`;

const W6_REVISE = `## 逐弱项修改方案

（按检查点确认的取舍意见执行：以下覆盖优先级清单中被勾选的弱项；未勾选项列入文末待办。）

### 弱项 1：检索配置未定义（必须修改 · 文本类）
改写段落（可直接替换方法节「上下文组装」第一段）：

> 上下文组装阶段采用混合检索：文档按标题/段落两级切块（段落上限 320 token，重叠 64），标题块与段落块分别编码（1024 维）入库；查询时先做 BM25 粗召回（k=32），再与向量余弦相似度（公式 1）融合重排，取前 5 块进入上下文包。

配套消融（实验类）：纯向量 vs 混合检索各跑 3 个种子，报告草稿人工评级均值±标准差与 paired t-test 结果。

### 弱项 2：智能体冲突消解未形式化（必须修改 · 图表类）
TikZ 方案：绘制三泳道图（评审角色 → 合并去重器 → 写作角色），冲突边用红色标注，图注给出规则编号。配套伪代码：

    function Resolve(reviews):
      items ← 语义聚类去重(flatten(reviews))   # 合并同类意见
      for item in items where 相互冲突(item):
          item.strategy ← 多数角色一致(item) ? 'merge' : 'escalate'
      return 按优先级排序(items)

### 弱项 3：实验证据缺失（必须修改 · 实验类）
补充实验清单（不代跑数据）：
- 设置：10 名作者 × 3 个写作任务；组间对照（有/无上下文包），同模型同温度。
- 基线：无辅助写作、单点工具辅助、本文流水线。
- 指标：清晰度/准确性 5 分制盲评（3 名独立评分者，报告 Krippendorff's α）、误采纳率、任务完成时间。
- 报告：mean±std、paired t-test + Cohen's d。

### 弱项 4–6（建议修改档）
按上述同构方法处理：新颖性主张的降调改写句已备好；显式假设清单插入方法节开头；「威胁有效性」小节模板已生成。

### 剩余待办
- 待确认：R2-缺点3 的 track 定位（已列为可答辩项，需作者确认目标 track 后补一段）。
- 待执行：人工评级实验需完成知情同意流程后开展。
- 待核验：补相关工作的 6–8 条新引用，须先经 citation.validate 核查再写入 refs.bib。

（涉及正文落盘的修改将以 diff 审批卡呈现，采纳后生效；本次取舍意见已写入项目记忆。）`;

const W10_REQUIREMENTS = `## 期刊要求清单（目标：ACL 长文 · 政策库命中）

政策库命中「ACL —— Long Paper」。以下每条附原文依据或推断标记。

| # | 要求 | 依据 |
|---|------|------|
| 1 | 正文不超过 8 页，参考文献不限页 | CFP「Length: up to 8 pages」 |
| 2 | 官方模板 acl.sty，双栏 | 模板发布页 |
| 3 | 双盲：正文/脚注/致谢不得泄露作者身份；自引用第三人称 | 匿名规则第 2 条 |
| 4 | 补充材料单独上传，限 50MB；正文引用补充材料需标注编号 | 补充材料规范 |
| 5 | Limitations 节必填（不计页数） | 官方政策 |
| 6 | AI 使用披露：写作辅助需在 Limitations 或致谢区声明 | AI 政策 v2 |
| 7 | 数据与代码可得性声明鼓励但不强制 | CFP |

（要求清单已就绪，将驱动后续的编译版式核对与逐项过检。）`;

const W10_COMPILE = `## 编译与格式核对结果

**编译**：tectonic 两轮编译通过（refs.bib 命中 3 条，无未定义引用、无重复标签）。PDF 共 9 页。

**格式问题清单**（每条附定位）：
1. ❌ 页数超限：正文 9 页，超出 8 页上限约 1 页。定位：全文（main.tex:1 起）。建议压缩对象：相关工作节（当前约 1.5 页）与实验设置节的演示性说明。
2. ⚠️ 模板不符：当前使用 article 文档类（main.tex:1），需换官方两栏模板；字号与节标题样式随之调整。
3. ⚠️ 缺 Limitations 节：要求第 5 条必填。定位：结论前（建议插入 main.tex:77 附近）。
4. ⚠️ \\date{2026} 会显示具体日期（main.tex:8），匿名期模板通常不显示版本日期。
5. ✅ 图表编号连续，公式编号连续，无悬空引用。

（纯格式小修改（如 \\date 清空）可经 diff 审批直接改；模板更换涉及全文重排，建议作者执行。）`;

const W10_AUDIT = `## 合规审查（三态结论 + 证据定位）

1. ⚠️ 匿名化——需人工判断：正文以「ScholarForge Demo」署名（main.tex:7），双盲投稿须移除；致谢与仓库链接不存在，无其他泄露点。自引措辞需作者自查（「本文以演示项目为例」不构成自引泄露）。
2. ❌ 引用格式——未通过：refs.bib 共 3 条，openai2023gpt4 为 @misc 但缺 doi 字段；unsrt 样式与官方 author-year 要求不符（换模板时一并处理）。定位：refs.bib:14。
3. ⚠️ Data statement——需人工判断：正文无数据可得性声明；本文为系统设计论文，是否单列取决于最终 track（系统 track 鼓励）。
4. ✅ AI 使用披露：可在 Limitations 节声明「草稿由 AI 辅助生成，作者逐条审定」；披露语句草稿已生成，随报告附上。
5. ✅ 图表：0 图 1 公式，无分辨率/彩印问题。
6. ⚠️ 补充材料——需人工判断：暂无附录；若补实验，评测脚本应作为补充材料打包（限 50MB 内）。

（以上定位均为 .tex 文件行号，点击可跳转编辑器对应行核对。）`;

const W10_REPORT = `## 投稿前自检报告（目标：ACL 长文）

**总体结论：需人工判断** —— 2 项未通过、3 项需人工核对；修复页数与模板问题后可提交。

### 逐项清单

- ✅ 编译无错误：tectonic 两轮通过，3 条参考文献全部解析，无未定义引用（全文）
- ❌ 页数超限：正文 9 页 > 8 页上限，约超 1 页（main.tex:1）
  → 建议：压缩「相关工作」节约 0.5 页（合并单点工具描述），实验设置演示性文字移入附录；预计工作量 1–2 小时
- ❌ 模板不符：使用 article 文档类，需换官方两栏模板（main.tex:1）
  → 建议：换模板后全文重排并复查图表宽度；预计工作量 1 小时
- ⚠️ 匿名化需作者确认：署名「ScholarForge Demo」须移除，自引措辞建议自查（main.tex:7）
  → 建议：双盲版用匿名作者行替换，投稿前全文检索一次机构名
- ⚠️ 缺 Limitations 节（必填，不计页数）（main.tex:77）
  → 建议：按草稿「本研究证据限于静态演示文本……」扩写 150–200 词
- ⚠️ data statement 取舍需人工：系统 track 鼓励正式声明，长文 track 可并入 Limitations
  → 建议：确认目标 track 后决定是否单列
- ✅ 引用可解析：refs.bib 3 条全部命中本地文献库（vaswani2017attention、brown2020language、openai2023gpt4）
- ✅ AI 披露路径明确：Limitations 声明草稿已生成

### 需人工判断项说明
匿名化与 data statement 依赖作者对投稿 track 与仓库公开策略的决定，工具无法代替判断。

### 附件草稿
AI 使用披露（草稿）：During preparation, drafting assistance was provided by an AI writing system; all modifications were reviewed and approved by the authors.
Data statement（草稿）：No new datasets were introduced. The demonstration manuscript and evaluation configuration will be released upon acceptance.`;

const W12_SEARCH = `## 文献分组清单（综述主题：大语言模型辅助的科研写作）

围绕主题在本地文献库检索，命中 3 篇（全部通过引用核验，citekey 可用）。一篇文献可归入多组，分组如下：

### 组 A · 方法同类：检索增强与注意力架构（技术路线相近）
- vaswani2017attention — Attention Is All You Need（2017）：自注意力架构，是后续所有「上下文组装 → 生成」范式的架构基础。与主题的关系：为「检索相关文献再起草」的流水线提供了底层序列建模范式。
- brown2020language — Language Models are Few-Shot Learners（2020）：少样本提示范式。与主题的关系：说明「上下文包」为何有效——把文献摘要注入提示即等价于少样本条件化。

### 组 B · 问题同类：让模型承担写作中的重复性环节
- brown2020language（2020）：任务规约纯文本交互，写作指令天然适配该范式。
- openai2023gpt4 — GPT-4 Technical Report（2023）：通用能力与专业基准表现。与主题的关系：界定「智能体可接管」与「必须作者裁决」的工作分界——模型能力越强，审批机制越重要。

### 组 C · 时间线：架构革命 → 提示范式 → 通用能力（领域演进三阶段）
- 2017 vaswani2017attention：架构革命，序列建模摆脱循环。
- 2020 brown2020language：提示范式确立，上下文即能力。
- 2023 openai2023gpt4：通用能力与安全议题并重。

### 检索缺口提示
库内暂缺「写作辅助工具评测」与「人机协作写作诚信」两个方向（检索词 writing assistance、human-AI co-writing 未命中）。若综述需覆盖该方向，可配置模型服务后启用补充检索，或手动导入相应 bib 条目。

（分组清单与要点已就绪，供下一步起草章节草稿使用。）`;

const W12_DRAFT = `以下为可直接插入稿件的 Related Work 章节草稿（引用仅使用上一步检索到的 3 个 citekey，全部通过引用核验）：

\\section{Related Work}

\\paragraph{Architecture foundations.}
The shift from recurrent architectures to attention-only sequence models underlies every stage of modern writing assistance: retrieval over large corpora, long-context drafting, and reranking of citations all inherit the parallelism and long-range modeling introduced by the Transformer \\cite{vaswani2017attention}. % [vaswani2017attention p.5998]
In our pipeline this matters concretely: the context-assembly stage embeds outlines, glossaries, and library chunks with the same family of encoders that this line of work made practical.

\\paragraph{Prompting as the interface to writing.}
Few-shot conditioning reframed task specification as pure text interaction, which makes a paper-oriented context pack a natural control surface: injecting curated literature chunks is equivalent to conditioning the model on evidence \\cite{brown2020language}. % [brown2020language p.1877]
We adopt this interface, but bind it to a stronger contract: every claim the model drafts must trace back to a retrievable, locally validated citation.

\\paragraph{Capability growth and the case for human verdict.}
As general-purpose models reach professional-benchmark performance, the marginal quality of machine-drafted prose is no longer the only bottleneck; responsibility and verifiability dominate \\cite{openai2023gpt4}. % [openai2023gpt4]
This motivates our central design choice: the pipeline never writes to the manuscript directly—every modification is surfaced as a diff and requires explicit author approval. % [openai2023gpt4]

\\paragraph{Positioning.}
Compared with single-point tools (grammar checking, reference formatting), we organize assistance around the full lifecycle of one paper; compared with open-ended agent frameworks, we trade autonomy for auditability. \\todo{Add 2--3 citations on writing-assistance toolkits after expanding the library.}

引用清单（citekey → 支撑的论断）：
- vaswani2017attention → 注意力架构是现代写作辅助各环节（检索/起草/重排）的架构基础；p.5998 为架构与自注意力机制定义处。
- brown2020language → 少样本条件化使「上下文包」成为自然的任务接口；p.1877 为少样本设置与结果总览。
- openai2023gpt4 → 通用模型能力增长使可验证性与责任成为瓶颈，支撑「diff 审批为核心设计」的动机。

\\todo{} 待作者核实：与单点工具的对比是否需要具体系统名与功能矩阵（建议补）。`;

const W12_CONFIRM = `## 草稿自查清单（检查点）

**citekey 核对**
- ✅ 草稿共出现 3 个 citekey：vaswani2017attention、brown2020language、openai2023gpt4，全部在检索结果内，无编造。
- ✅ 行内依据标注（% 注释里的「键 p.页码」格式）与叙述一一对应：架构主张对应 p.5998，少样本接口对应 p.1877，GPT-4 动机主张无页码（技术报告为整体支撑）。

**措辞检查**
- ⚠️ 「the marginal quality of machine-drafted prose is no longer the only bottleneck」仍略显绝对，可再软化为「may no longer be the only bottleneck」。
- ✅ 未发现贬低他人工作的表述；「trade autonomy for auditability」为中性定位表述。

**待作者确认项**
1. 分组是否合理：当前按「方法同类 / 问题同类 / 时间线」三组展开；如需并入「评测基准」一组请说明。
2. 是否补检索：库内缺「写作辅助工具评测」「人机协作诚信」方向（见上一步缺口提示），确认后可补检。
3. \\todo{} 处理：对比单点工具处建议补具体系统名，或删除该句。

（停在检查点等待确认；请在确认输入中写明修改意见，例如「删掉时间线组；第 2 段语气放缓；补检索 writing assistance」。）`;

const W12_APPLY = `## 插入说明

（演示说明：演示模式不实际改写文件，以下为该步骤在真实配置下的输出示例。）

- 插入位置：正文主体之后、结论之前（main.tex:78，最后一个 \\input 之后）。
- 已插入内容：\\section{Related Work} 完整草稿，含 3 个叙事段落与 1 个定位段落。
- 使用的 citekey：vaswani2017attention、brown2020language、openai2023gpt4（全部来自检索结果，无增删）。
- 按作者意见未采纳的内容：无（本次确认输入为「继续」，未附修改意见；如需调整分组或语气，重新运行本工作流即可）。
- 落盘前已创建快照「插入 Related Work 前」；diff 审批卡会展示完整改动，采纳后生效并自动触发一次编译验证。`;

const W3_ANALYZE = `## 润色问题清单（目标：简洁）

对照风格档案与目标，从待改文本中识别出 4 处问题（1 处必须改、3 处建议改）：

**必须改（风格档案硬约束）**
1. 冗余名词化：「能够对……进行改进」式的「对……进行 + 名词化」结构（学术中文常见冗余句式）。定位：第 2 句。理由：风格档案要求动词直接化，名词化包装增加阅读成本。

**建议改**
2. 模糊量词：「大量研究表明」无量化来源，审稿人常追问。定位：第 1 句。建议：改为「多项研究表明」并补引用。
3. hedging 叠加：「可能在某种程度上」双重弱化，反而削弱主张。定位：第 3 句。建议：保留单一弱化词「可能」即可。
4. 术语不统一：「方法/办法/方案」混用。建议：全篇统一为「方法」。

（下一步将按此清单产出最小必要修改的 diff；数学环境与 \\cite 键不动。）`;

const W3_REWRITE = `以下为按问题清单产出的 unified diff（演示示例：以典型冗余句展示修改形态；真实模式下将作用于你的选中文本）：

--- a/sections/intro.tex
+++ b/sections/intro.tex
@@ -1,3 +1,3 @@
-大量研究表明，本方法能够对写作效率进行改进，并且可能在某种程度上降低错误率。
+多项研究表明，本方法可提高写作效率，并可能降低错误率 \\cite{vaswani2017attention}。

**每处修改的理由**
1. 「大量研究」→「多项研究」：去除无量化来源的强量词（问题 2，建议改）。
2. 「能够对……进行改进」→「可提高」：拆掉名词化包装，动词直给（问题 1，必须改）。
3. 删「在某种程度上」：双重 hedging 叠加，保留「可能」已足够（问题 3，建议改）。
4. 补 \\cite 键：强主张需引用支撑（引用规则要求）；此处示例使用库内真实键。

（修改保持原句长分布与作者时态习惯；数学环境与既有 \\cite 键未做任何改动。下一步应用时将先建快照，diff 经你在检查点确认后生效。）`;

const W3_APPLY = `## 应用摘要

（演示说明：演示模式不产生真实文件改动，以下为该步骤在真实配置下的输出示例。）

- ✅ 已创建快照，标签「润色前快照」（编辑器「历史」可随时恢复）。
- ✅ 已应用 1 处 diff：intro.tex 第 1 句的冗余表达修正（见上一步 unified diff）。
- ✅ 应用后全文编译验证通过：tectonic 两轮无错误，引用解析正常。
- 跳过项：无（本次确认输入未否决任何修改）。

（若你在确认输入中否决了部分修改，此处会逐条列出跳过项与原因。）`;

const W7_PARSE = `## 审稿意见条目化（R1/R2/R3 + Meta）

**R1（方法严格派）**
- R1.1 ｜检索配置未定义，上下文组装阶段无法复现｜类型：实验补充｜方向：补「检索配置」小节 + 混合检索消融
- R1.2 ｜智能体冲突消解未形式化｜类型：写作澄清｜方向：补工作流图与伪代码，或降调为顺序流水线
- R1.3 ｜「作者裁决权保证安全」是假设而非结论｜类型：范围争议｜方向：列显式假设 + 误采纳率实验
- R1.4 ｜实验为静态演示文本，无法支撑质量主张｜类型：实验补充｜方向：补人工评级或降调主张
- R1.Q1/Q2 ｜分块粒度、latexdiff 边界情况｜类型：写作澄清｜方向：直接回答

**R2（领域专家）**
- R2.1 ｜相关工作仅 3 篇且全为基础模型谱系｜类型：定位或引用｜方向：重组三组，补工具/评测/编排文献
- R2.2 ｜「缺乏一站式工作区」缺文献证据｜类型：范围争议｜方向：补系统综述或降调为「少有」
- R2.3 ｜未论证与目标社区/track 的匹配度｜类型：范围争议｜方向：引言结尾补定位段
- R2.4 ｜单点工具对比是稻草人｜类型：写作澄清｜方向：给出具体系统与功能矩阵

**R3（实验报告规范）**
- R3.1 ｜无重复实验与方差报告｜类型：实验补充｜方向：3 次重复 + mean±std 模板
- R3.2 ｜显著性检验缺位｜类型：实验补充｜方向：paired t-test/Wilcoxon + 效应量
- R3.3 ｜基线对齐与数据泄漏未讨论｜类型：实验补充｜方向：补「威胁有效性」小节
- R3.4 ｜复现要素缺失｜类型：实验补充｜方向：公开提示词库/配置/原始数据

**Meta（领域主席）**
- M.1 整体倾向 borderline；必须修改 = R1.1、R1.2、R3.1、R3.2、R2.1；分歧点 R2 vs R3（设计贡献 vs 实证贡献）。

（共 13 条实质条目与 2 条提问；下一步将按条目起草回复。）`;

const W7_DRAFT = `## 逐条回复草稿（策略 + 正文）

- R1.1 ｜ direct-fix：感谢指出。我们已在方法节新增「检索配置」小节（v2 §3.2）：段落级 320-token 分块、1024 维编码、BM25 粗召回与余弦重排的混合检索；并补充「纯向量 vs 混合」消融（3 种子，评级 +0.4，p<0.05）。修改见 diff-07。
- R1.2 ｜ partial：感谢建议。我们补充了三泳道工作流图与 Resolve 伪代码（v2 图 2），明确「评审意见先语义聚类去重、冲突项按多数角色合并、无法合并时升级作者裁决」；完全自动的冲突消解留作未来工作，已在限制中说明。
- R1.3 ｜ argue：我们同意「安全」需区分设计意图与实证结论。v2 已将主张改写为「裁决权机制使不安全修改无法绕过作者落盘」（可由系统日志验证），并在假设清单中明示误采纳风险；小规模误采纳率实验（10 作者 × 20 含错 diff）已列入附录 A。
- R1.4 ｜ partial：v2 增加了 3 名独立评分者的人工评级（清晰度/准确性/作者负担，Krippendorff's α=0.71），并对照系统类论文的证据标准做了明确说明。
- R2.1 ｜ direct-fix：相关工作已重组为「工具谱系 / 人机协作评测 / 智能体编排」三组共 11 篇，每组按共性—差异—定位展开（v2 §2）。
- R2.2 ｜ partial：主张已降调为「少有工作以完整生命周期为单位组织写作环境」，并补引两篇系统综述作为佐证。
- R2.3 ｜ cite：我们补引系统类论文说明定位，并在引言结尾新增定位段（v2 §1 末）。
- R2.4 ｜ direct-fix：已给出 3 个具体系统的功能矩阵（v2 表 1），删除泛化表述。
- R3.1/R3.2 ｜ direct-fix：全部对比实验改为 3 种子重复，报告 mean±std 与 paired t-test（含 Cohen's d）；多重比较已做 Holm 校正（v2 §5）。
- R3.3 ｜ partial：新增「威胁有效性」小节：基线同模型同温度对齐；评测文献已从上下文包中剔除以防泄漏。
- R3.4 ｜ direct-fix：提示词库、角色配置、原始评审记录作为补充材料公开（repro.zip，12MB）。

（每条控制在 120 词内；未承诺任何未运行的实验——R1.3 的误采纳率实验已在附录给出数据。）`;

const W7_CONFIRM = `## 回复草稿汇总（按审稿人分组 · 检查点）

**R1**：R1.1 direct-fix（已改）；R1.2 partial（图与伪代码已补，全自动消解留作未来）；R1.3 argue（主张改写 + 假设清单）；R1.4 partial（人工评级已补）。
**R2**：R2.1 direct-fix；R2.2 partial（降调 + 补综述）；R2.3 cite；R2.4 direct-fix。
**R3**：R3.1/R3.2/R3.4 direct-fix；R3.3 partial。
**Meta**：必须修改五条全部落在 direct-fix/partial 内。

**冲突条目（需作者裁决）**
- R1.3（argue：安全主张可由机制保证）vs R3.1（要求实证支撑）——建议保留 argue 但附附录数据，两头都回应。
- R2.3（补定位引用）依赖最终 track 选择，与预提交自检的「track 确认」项联动。

**需作者补数据才能回复的条目**
- R1.4 的评分者一致性系数：若正式实验未完成，回复中应改为「已列入计划」而非报告数字。

（停在检查点：请在确认输入写明取舍，如「R1.3 改为 partial；R2.3 待定 track 后处理」。）`;

const W7_FINALIZE = `感谢三位评审的建设性意见。我们按条目逐一修改：必须修改档 5 条全部落实（含检索配置形式化、报告规范与相关工作重组），完整修改清单见文末。以下按审稿人分组回复。

## 审稿人一（R1 · 方法严格派）

R1.1（检索配置）：已新增 §3.2「检索配置」——段落级分块（320 token，重叠 64）+ BM25/向量混合重排；消融显示混合检索评级 +0.4（3 种子，p<0.05）。见 diff-07。

R1.2（冲突消解）：已补图 2（三泳道工作流）与 Resolve 伪代码：意见先语义聚类去重，冲突按多数角色合并，不可合并项升级作者裁决。全自动消解留作未来工作（限制节已说明）。

R1.3（安全主张）：主张已改写为机制可验证形式——「不安全修改无法绕过作者落盘」；误采纳率实验（10 作者 × 20 含错 diff，误采纳率 4%）见附录 A。

R1.4（实验证据）：已补 3 名独立评分者的人工评级（α=0.71）；证据边界在限制节明确。

R1.Q1/Q2：分块粒度为章节内段落级（不跨章节边界）；latexdiff 对数学环境做了环境级保护（跨行环境整体呈现）。

## 审稿人二（R2 · 领域专家）

R2.1（相关工作）：已重组为工具谱系/人机协作评测/智能体编排三组共 11 篇（§2）。

R2.2（新颖性主张）：已降调为「少有工作以完整生命周期为单位」，并补两篇系统综述。

R2.3（track 定位）：已在引言结尾补定位段并补引；系统类论文的证据标准已对照说明。

R2.4（稻草人）：已给出 3 个具体系统的功能矩阵（表 1）。

## 审稿人三（R3 · 实验报告规范）

R3.1/R3.2：对比实验均为 3 种子重复，报告 mean±std、paired t-test 与 Cohen's d；多重比较 Holm 校正。

R3.3：新增「威胁有效性」小节——基线同模型同温度；评测文献已从上下文包剔除。

R3.4：提示词库、角色配置与原始评审记录已随补充材料公开。

## 修改清单汇总（与稿件位置对应）

| 条目 | 稿件位置 | 状态 |
|---|---|---|
| 检索配置小节 | §3.2（新增） | 已改 |
| 工作流图 + 伪代码 | 图 2、算法 1（新增） | 已改 |
| 假设清单与主张改写 | §3.1 开头 | 已改 |
| 相关工作重组 | §2 | 已改 |
| 报告规范补齐 | §5 | 已改 |
| 威胁有效性 | §5.4（新增） | 已改 |
| 误采纳率实验 | 附录 A（新增） | 已改 |

（需落盘的修改已生成 diff 审批卡；引用变动均经核验后写入。）`;

const GENERIC_CHAT = `当前是**演示模式**：还未配置模型服务，这条回复来自内置示例数据，而不是真实 AI——所以不会假装回答你的问题。

**零配置就能完整体验的内置演示**
- 三审稿人仿真：方法严谨性 / 领域定位 / 实验可信度三个视角 + 主席汇总 + 逐弱项修改方案
- 预提交自检：三态清单，条目附可点击的 main.tex 行号定位
- 相关工作综述：只用文献库内真实 citekey 起草 Related Work，附依据页码标注
- Rebuttal 起草：逐条解析意见并按策略回复
- 学术润色：典型冗余句的 unified diff 示范

**启用真实 AI（约 30 秒）**：在上方「AI 功能尚未激活」卡片选择模型服务并粘贴 API Key，保存即生效；也可稍后在「设置 → 模型服务」中配置。配置后，本会话可自动检索文献库、读取项目上下文、经 diff 审批修改稿件。`;

const GENERIC_WORKFLOW_STEP = `这一步还没有收录演示脚本（当前内置：三审稿人仿真、Rebuttal 起草、预提交自检、相关工作综述、学术润色）。配置模型服务后，此步骤将由真实模型基于你的稿件与上下文执行。

可以先运行上述内置演示工作流体验完整闭环；或打开「设置 → 模型服务」完成配置后重跑本工作流。`;

// ---------------------------------------------------------------------------
// 关键词路由表（顺序敏感，见文件头「依赖碰撞设计」说明）
// ---------------------------------------------------------------------------

interface DemoRoute {
  id: string;
  /** 命中任一关键词即路由（ASCII 关键词按小写匹配） */
  keywords: readonly string[];
  script: string;
}

const ROUTES: readonly DemoRoute[] = [
  // W6 prep 首位：其 user 消息内嵌 {{manuscript}} 变量，先匹配自身关键词最稳
  { id: 'w6-prep', keywords: ['审稿仿真准备上下文'], script: W6_PREP },
  // W7 四步：parse 的 user 消息内嵌 W6 产物（含「【Meta-Review】」包装），须先于 W6 meta 匹配
  { id: 'w7-parse', keywords: ['逐条拆解为编号条目'], script: W7_PARSE },
  { id: 'w7-draft', keywords: ['逐条起草 rebuttal 回复'], script: W7_DRAFT },
  { id: 'w7-confirm', keywords: ['标记相互冲突的条目'], script: W7_CONFIRM },
  { id: 'w7-finalize', keywords: ['整合最终 rebuttal'], script: W7_FINALIZE },
  // W6：revise 须先于 meta——revise 的 deps 头是「【Meta-Review 汇总的结论】」（步骤名），
  // 会命中 meta 关键词；revise 自身关键词先查即可纠正
  { id: 'w6-revise', keywords: ['用户选中的弱项'], script: W6_REVISE },
  { id: 'w6-meta', keywords: ['meta-review'], script: W6_META },
  { id: 'w6-reviewer-method', keywords: ['方法严格派审稿人'], script: W6_REVIEWER_METHOD },
  { id: 'w6-reviewer-domain', keywords: ['领域专家审稿人'], script: W6_REVIEWER_DOMAIN },
  { id: 'w6-reviewer-stat', keywords: ['统计与复现'], script: W6_REVIEWER_STAT },
  // W10：report → audit → compile-check → requirements（后置步骤先查）
  { id: 'ai-fix', keywords: ['修复以下 LaTeX 编译错误'], script: [
    '> ⚠️ 演示数据（内置示例，配置模型服务后为真实 AI 修复）',
    '',
    '已分析 2 个编译错误并生成修复：',
    '',
    '**错误 1** `main.tex:14` — Undefined control sequence `\\tablsx`',
    '→ 修复：`\\tablsx` 改为 `\\table`（拼写错误，diff 已生成待审批）',
    '',
    "**错误 2** `sections/intro.tex:8` — `Citation 'smith2020' undefined`",
    '→ 修复：refs.bib 中无此条目，建议改引 `vaswani2017attention` 或先入库（已调用 citation.validate 核验）',
    '',
    '修改将以 diff 审批卡呈现，批准后自动重新编译验证。',
  ].join('\n') },
  { id: 'w10-report', keywords: ['汇总前三步结果'], script: W10_REPORT },
  { id: 'w10-audit', keywords: ['逐项合规审查'], script: W10_AUDIT },
  { id: 'w10-compile-check', keywords: ['技术合规性'], script: W10_COMPILE },
  { id: 'w10-requirements', keywords: ['结构化要求'], script: W10_REQUIREMENTS },
  // W12：confirm 须先于 draft——confirm 的 deps 头是「【起草 Related Work 的结论】」（步骤名）
  { id: 'w12-search', keywords: ['在文献库内检索并分组'], script: W12_SEARCH },
  { id: 'w12-confirm', keywords: ['自查草稿后'], script: W12_CONFIRM },
  { id: 'w12-draft', keywords: ['起草 related work'], script: W12_DRAFT },
  { id: 'w12-apply', keywords: ['修订草稿并落盘'], script: W12_APPLY },
  // W3：rewrite 先于 analyze（rewrite 的消息内嵌 analyze 输出）
  { id: 'w3-rewrite', keywords: ['基于上一步的问题清单'], script: W3_REWRITE },
  { id: 'w3-analyze', keywords: ['待润色文本'], script: W3_ANALYZE },
  { id: 'w3-apply', keywords: ['润色前快照'], script: W3_APPLY },
];

/** 工作流步骤形态的通用消息（带指令/依赖引用/变量占位但未收录脚本，如 W2/W11） */
const WORKFLOW_STEP_HINT_RE = /请执行|请调用|基于上一步|检查点|\{\{\w+\}\}/;

/**
 * 关键词路由：按最后一条 user 消息内容选取演示脚本。
 * 未命中工作流关键词时按「工作流步骤 / 通用对话」给出引导性演示说明。
 * （导出供测试直接断言路由结果）
 */
export function pickDemoScript(lastUserMessage: string): string {
  const hay = lastUserMessage.toLowerCase();
  for (const route of ROUTES) {
    if (route.keywords.some((k) => hay.includes(k.toLowerCase()))) return route.script;
  }
  return WORKFLOW_STEP_HINT_RE.test(lastUserMessage) ? GENERIC_WORKFLOW_STEP : GENERIC_CHAT;
}

function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

/**
 * 脚本化演示 Provider（零配置旗舰演示）：
 * 未配置模型服务时的 resolveProvider 回退——按关键词输出预写的高质量结构化内容，
 * 小块流式 + 模拟打字延时；不产生 tool-call（工具循环天然不启用）。
 */
export class ScriptedDemoProvider implements ChatProvider {
  readonly id = 'demo';
  readonly label = '演示模式（内置示例数据）';
  private readonly minChunk: number;
  private readonly maxChunk: number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(opts: ScriptedDemoProviderOptions = {}) {
    this.minChunk = opts.minChunkChars ?? 8;
    this.maxChunk = Math.max(opts.maxChunkChars ?? 20, this.minChunk);
    this.minDelayMs = opts.minDelayMs ?? 15;
    this.maxDelayMs = Math.max(opts.maxDelayMs ?? 35, this.minDelayMs);
  }

  async *complete(req: ChatRequest): AsyncGenerator<ChatEvent> {
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const text = `${DEMO_DISCLAIMER}\n\n${pickDemoScript(lastUser)}`;
    // 按 Unicode 码点切块，避免拆散代理对（emoji）
    const chars = Array.from(text);
    let yielded = 0;
    for (let i = 0; i < chars.length; ) {
      if (req.signal?.aborted) break;
      const size = randInt(this.minChunk, this.maxChunk);
      const delta = chars.slice(i, i + size).join('');
      i += size;
      yielded += delta.length;
      yield { type: 'text-delta', delta };
      const delay = randInt(this.minDelayMs, this.maxDelayMs);
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    }
    yield { type: 'done', usage: { inputTokens: lastUser.length, outputTokens: yielded } };
  }
}
