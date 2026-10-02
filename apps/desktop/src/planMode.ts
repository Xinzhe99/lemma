/**
 * 计划模式（Plan Mode）纯函数层：
 * - parsePlan：从 agent 回复中宽容解析计划 JSON（```json 围栏优先，回退首个 `{`
 *   到配对 `}` 的平衡扫描；坏 JSON / 结构不符返回 null，走普通消息渲染）；
 * - buildPlanPrompt：规划轮 prompt（指示模型只输出计划、不执行；约束保守分解、
 *   写文件类步骤单列；含演示路由关键词「输出执行计划」）；
 * - buildStepPrompt：单步执行 prompt（goal + 步骤清单概览 + 本步详情 + 前步产出
 *   摘要 ≤1200 字；含演示路由关键词「逐步骤说明」）。
 * 纯函数无副作用、无 store 依赖，供 aiActions 调度层与测试直接使用。
 */

/** 单个计划步骤（usesTools 为提示性声明，实际工具仍由 agent 自主调用并经权限门） */
export interface PlanStep {
  id: string;
  title: string;
  detail?: string;
  usesTools?: string[];
}

/** 一份可执行计划：目标 + 有序步骤（1..MAX_PLAN_STEPS） */
export interface Plan {
  goal: string;
  steps: PlanStep[];
}

/** 步骤数上限（超出截断——宽容降级而非整体拒绝） */
export const MAX_PLAN_STEPS = 12;
/** 单步 prompt 中前步产出摘要的总字符上限 */
export const PRIOR_OUTPUTS_BUDGET = 1200;

// ---------------------------------------------------------------------------
// parsePlan
// ---------------------------------------------------------------------------

/** 提取 ```json 围栏内的第一段候选文本（无围栏返回 null） */
function extractFencedJson(reply: string): string | null {
  const fence = /```(?:json|JSON)\s*([\s\S]*?)```/.exec(reply);
  const body = fence?.[1]?.trim();
  return body && body.startsWith('{') ? body : null;
}

/**
 * 平衡扫描：从首个 `{` 起配对到闭花的 `}`（跳过字符串字面量内的花括号），
 * 返回候选 JSON 文本；无 `{` 或未闭合返回 null。
 */
function extractBalancedJson(reply: string): string | null {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return reply.slice(start, i + 1);
    }
  }
  return null;
}

/** 单个 step 字段的宽容降级：title 必填（非空字符串），其余字段类型纠正 */
function coerceStep(raw: unknown, index: number): PlanStep | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const title = typeof o.title === 'string' ? o.title.trim() : '';
  if (!title) return null; // title 必填：缺 title 的步骤直接丢弃（降级）
  const id =
    typeof o.id === 'string' && o.id.trim() ? o.id.trim() : `s${index + 1}`;
  const detail = typeof o.detail === 'string' && o.detail.trim() ? o.detail.trim() : undefined;
  const usesTools = Array.isArray(o.usesTools)
    ? o.usesTools.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    : undefined;
  return usesTools && usesTools.length > 0 ? { id, title, detail, usesTools } : { id, title, detail };
}

/**
 * 宽容解析 agent 回复中的计划：
 * 1. 优先取 ```json 围栏；否则从首个 `{` 平衡扫描到配对 `}`；
 * 2. JSON.parse 失败 → null（调用方按普通 assistant 消息渲染）；
 * 3. 结构校验降级：goal 必须为非空字符串；steps 过滤掉缺 title 的条目后
 *    至少 1 步（否则 null），至多 MAX_PLAN_STEPS 步（超出取前 N 步）；
 * 4. 步骤 id 缺省补 `s1..sn`，重复 id 追加序号保证唯一（statuses 按_id 索引）。
 */
export function parsePlan(reply: string): Plan | null {
  const candidate = extractFencedJson(reply) ?? extractBalancedJson(reply);
  if (!candidate) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const o = parsed as Record<string, unknown>;
  const goal = typeof o.goal === 'string' ? o.goal.trim() : '';
  if (!goal) return null;
  if (!Array.isArray(o.steps)) return null;

  const seen = new Set<string>();
  const steps: PlanStep[] = [];
  for (const raw of o.steps) {
    const step = coerceStep(raw, steps.length);
    if (!step) continue;
    let id = step.id;
    if (seen.has(id)) id = `${id}#${steps.length + 1}`; // 去重：重复 id 加序号
    seen.add(id);
    steps.push(step.id === id ? step : { ...step, id });
    if (steps.length >= MAX_PLAN_STEPS) break; // 超上限截断（降级）
  }
  if (steps.length === 0) return null;
  return { goal, steps };
}

// ---------------------------------------------------------------------------
// buildPlanPrompt
// ---------------------------------------------------------------------------

/**
 * 规划轮 prompt：指示模型只产出计划（```json 围栏，goal/steps[{id,title,detail,
 * usesTools}]，id 用 s1..sn），不执行任何操作。首句固定含演示路由关键词
 * 「输出执行计划」（ScriptedDemoProvider 计划路由由集成者补充）。
 */
export function buildPlanPrompt(userRequest: string, contextMd: string): string {
  return [
    '请为以下任务输出执行计划（只规划，不执行任何修改或工具调用）：',
    '',
    '## 用户任务',
    userRequest.trim(),
    '',
    '## 项目上下文',
    contextMd.trim() || '（无）',
    '',
    '## 输出格式（严格遵守）',
    '只输出一个 ```json 代码围栏，不要输出其它文字。围栏内容结构：',
    '{"goal": "任务目标一句话", "steps": [{"id": "s1", "title": "步骤标题", "detail": "本步做什么、判断标准", "usesTools": ["会用到的工具名"]}, ...]}',
    '- id 依次用 s1、s2、…；steps 至少 1 步、至多 12 步；',
    '- 每步 title 必填且简洁（一行内）；detail 说明本步做什么；usesTools 列出预计',
    '  使用的工具（如 library.search_fulltext、tex.edit、tex.compile，可省略）。',
    '',
    '## 计划约束',
    '- 计划应保守分解：每步只做一件事，粒度以「一步能独立验证」为准；',
    '- 写文件类步骤单列（每个 tex.edit / citation.add 落盘动作独立成步，',
    '  执行时会逐条弹出 diff 审批卡由用户裁决）；',
    '- 只读类操作（检索文献、读上下文、读编译日志）可与相邻分析合并，不必拆细；',
    '- 首步通常是收集信息，末步通常是验证（如编译复查）。',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// buildStepPrompt
// ---------------------------------------------------------------------------

/** 状态在概览里的单字标记（与 PlanCard 图标语义一致） */
const STATUS_MARK: Record<string, string> = {
  done: '✓',
  failed: '✗',
  skipped: '⇣',
  running: '◐',
  pending: '○',
};

/**
 * 单步执行 prompt：goal + 步骤清单概览（带状态）+ 本步详情 + 前步产出摘要。
 * 前步产出按计划顺序取当前步骤之前、有产出的步骤，总量截断到
 * PRIOR_OUTPUTS_BUDGET（1200 字）。首句固定含演示路由关键词「逐步骤说明」。
 */
export function buildStepPrompt(
  plan: Plan,
  step: PlanStep,
  priorOutputs: Record<string, string>,
  statuses?: Record<string, string>,
): string {
  const overview = plan.steps
    .map((s) => {
      const mark = STATUS_MARK[statuses?.[s.id] ?? ''] ?? (s.id === step.id ? '▶' : '○');
      const flag = s.id === step.id ? ' ← 本步' : '';
      return `${mark} ${s.id}：${s.title}${flag}`;
    })
    .join('\n');

  const parts: string[] = [];
  let used = 0;
  for (const s of plan.steps) {
    if (s.id === step.id || used >= PRIOR_OUTPUTS_BUDGET) break;
    const out = (priorOutputs[s.id] ?? '').trim();
    if (!out) continue;
    const budget = PRIOR_OUTPUTS_BUDGET - used;
    const body = out.length > budget ? `${out.slice(0, budget)}…（已截断）` : out;
    parts.push(`【${s.id} ${s.title} 的产出】\n${body}`);
    used += body.length;
  }

  const lines: string[] = [
    `请按以下计划逐步骤说明并执行当前步骤（${step.id}）：完成本步即停，不要越权做后续步骤。`,
    '',
    '## 任务目标',
    plan.goal,
    '',
    '## 步骤清单概览',
    overview,
    '',
    '## 本步详情',
    `- 步骤：${step.id} ${step.title}`,
    step.detail ? `- 说明：${step.detail}` : '- 说明：（无额外说明，按标题执行）',
  ];
  if (step.usesTools?.length) lines.push(`- 预计工具：${step.usesTools.join('、')}`);
  lines.push(
    '',
    parts.length > 0 ? `## 前步产出摘要\n${parts.join('\n\n')}` : '## 前步产出摘要\n（本步为首步，无前步产出）',
    '',
    '## 执行要求',
    '- 只完成本步；需要修改稿件时用 tex.edit（会弹出 diff 审批卡，被拒绝时勿重试同一修改）；',
    '- 引用文献只能使用上下文中列出的 citekey；',
    '- 结束时给出本步结论（做了什么、发现什么、下一步依赖本步的什么信息）。',
  );
  return lines.join('\n');
}
