/**
 * 投稿文书生成器（SubmitPanel「投稿文书」区，代理D）：
 * 纯函数层——四类文书（Highlights / 利益声明 / 数据可用性 / 中文 Cover Letter）
 * 的 prompt 构建、Highlights 宽容解析与字数统计、双语标签。
 *
 * 设计约束：
 * - 零 store / 零 provider 依赖，可独立单测；生成动作（resolveProvider +
 *   runAgentTurn，均只读消费自 aiActions / agentTools）在 SubmitPanel 内进行，
 *   不经 sendChatMessage（避免写入 Agent 会话）。
 * - 每类 prompt 的首句固定含该类的演示路由关键词（ScriptedDemoProvider 按最后
 *   一条 user 消息的关键词路由，demo.ts 由集成者维护）：
 *     highlights        →「生成 3 至 5 条 Highlights」
 *     declarations      →「起草利益声明」
 *     dataAvailability  →「起草数据可用性」
 *     coverLetterZh     →「起草中文投稿信」
 *   各 prompt 撰写时避免出现其它类的路由关键词（依赖碰撞设计，同 demo.ts 约定）。
 */

/** 文书种类 */
export type DocKind = 'highlights' | 'declarations' | 'dataAvailability' | 'coverLetterZh';

/** 渲染顺序（SubmitPanel 按钮顺序） */
export const DOC_KINDS: readonly DocKind[] = [
  'highlights',
  'declarations',
  'dataAvailability',
  'coverLetterZh',
];

/** 双语标签（按钮与结果区标题共用；读 settingsStore.language 选取） */
export const DOC_LABELS: Record<DocKind, { zh: string; en: string }> = {
  highlights: { zh: 'Highlights', en: 'Highlights' },
  declarations: { zh: '利益声明', en: 'Declarations' },
  dataAvailability: { zh: '数据可用性', en: 'Data availability' },
  coverLetterZh: { zh: '中文 Cover Letter', en: 'Cover Letter (Chinese)' },
};

// ---------------------------------------------------------------------------
// Highlights 硬约束（Elsevier 等投稿系统的通行要求）
// ---------------------------------------------------------------------------

/** Highlights 条数下限 */
export const HIGHLIGHTS_MIN_ITEMS = 3;
/** Highlights 条数上限 */
export const HIGHLIGHTS_MAX_ITEMS = 5;
/** 每条字符上限（含空格；超过时 UI 徽标转黄警示） */
export const HIGHLIGHTS_CHAR_LIMIT = 85;

/** 字数统计：按 Unicode 码点计（中文 1 字 = 1，代理对不重复计） */
export function charCount(text: string): number {
  return Array.from(text).length;
}

// ---------------------------------------------------------------------------
// Prompt 构建
// ---------------------------------------------------------------------------

/** 进入 prompt 的稿件全文上限（防 prompt 爆炸；超出截断并注明） */
export const MAX_MANUSCRIPT_CHARS = 12000;

const PROMPTS: Record<DocKind, string> = {
  highlights: [
    '请为下面的稿件生成 3 至 5 条 Highlights（投稿系统 Highlights 栏目）：',
    '- 每条用一句完整的话陈述一个核心发现或贡献，不超过 85 字符（含空格）；',
    '- 动词开头、具体可核查，有量化结果时保留数字，不写口号式空话，不重复稿件标题；',
    '- 只输出要点本身：每条一行、以「- 」开头，不要编号、不要标题行、不要解释性文字、不要 Markdown 代码围栏。',
  ].join('\n'),
  declarations: [
    '请为下面的稿件起草利益声明（Declarations），逐栏目输出：',
    '- 利益冲突（Competing interests）：给出「所有作者声明无利益冲突」或存在利益关系的标准表述；',
    '- 资助（Funding）：写明资助机构与项目编号，未知处用【待作者补充：资助机构与编号】占位，禁止编造；',
    '- 作者贡献（Author contributions）：按 CRediT 分类（概念化、方法、实验、数据分析、写作与修改等）给出分工框架，具体作者名与分工用【待作者补充：…】占位；',
    '- 伦理声明与知情同意（如涉及人类/动物实验）一句话带过，不适用则标注「不适用」。',
    '输出为可直接粘贴进投稿系统的纯文本分节清单，不要 Markdown 代码围栏。',
  ].join('\n'),
  dataAvailability: [
    '请为下面的稿件起草数据可用性声明（Data availability statement）：',
    '- 说明研究数据、代码与材料是否公开、在哪里获取；',
    '- 数据链接与 DOI 未知时写【待作者补充：数据仓库链接】并提醒作者补充，禁止编造 URL、DOI 或许可协议；',
    '- 产生了新数据集的写明发布仓库与许可；未产生新数据则明确「本文未产生新的数据集」；',
    '- 输出 2–4 句可直接粘贴进投稿系统的纯文本，不要 Markdown 代码围栏。',
  ].join('\n'),
  coverLetterZh: [
    '请为下面的稿件起草中文投稿信（Cover Letter）：',
    '- 面向期刊编辑部，依次包含：稿件标题与建议栏目、研究问题与核心贡献（2–3 句）、与期刊读者群及收稿范围的匹配点、原创性与未一稿多投声明、通讯作者联系方式；',
    '- 事实未知处（栏目名、联系方式等）用【待作者补充：…】占位，禁止编造；',
    '- 输出可直接使用的中文信件正文（称呼、正文、落款），不要 Markdown 代码围栏。',
  ].join('\n'),
};

function manuscriptBlock(manuscript: string): string {
  const trimmed = manuscript.trim();
  if (!trimmed) {
    return '（稿件为空：请按通用模板输出，未知信息一律以【待作者补充：…】占位。）';
  }
  if (charCount(trimmed) <= MAX_MANUSCRIPT_CHARS) return trimmed;
  const head = Array.from(trimmed).slice(0, MAX_MANUSCRIPT_CHARS).join('');
  return `${head}\n…（稿件过长，已截断，仅保留前 ${MAX_MANUSCRIPT_CHARS} 字符）`;
}

/**
 * 组装某类文书的完整生成 prompt（纯函数）：该类中文指令 + 稿件全文。
 * 首行即含演示路由关键词（见文件头说明）。
 */
export function buildDocPrompt(kind: DocKind, manuscript: string): string {
  return `${PROMPTS[kind]}\n\n## 稿件全文\n\n${manuscriptBlock(manuscript)}`;
}

/** 生成文书用的 system 提示（静态短句，不组装 Context Pack——稿件已在 user 消息内） */
export const DOC_SYSTEM_PROMPT =
  '你是学术投稿助手：按用户指令为指定稿件撰写投稿文书。只输出文书本身（纯文本或按指令的列表格式），不输出无关解释、寒暄或 Markdown 代码围栏；未提供的事实一律以【待作者补充：…】占位，禁止编造。';

// ---------------------------------------------------------------------------
// Highlights 宽容解析
// ---------------------------------------------------------------------------

/**
 * 列表行标记：允许 markdown 粗体包裹的
 * 「- / * / • / + / – / —」或「1. / 1、 / 1)」序号。
 */
const LIST_MARKER_RE = /^(?:\*\*\s*)?(?:[-*•+–—]|\d+\s*[.、)])\s*(?:\*\*\s*)?/;

/** 演示声明（> 引用行）、Markdown 标题、Highlights 栏目标题行：跳过（代码围栏由调用处的 inFence 状态处理） */
function isNoiseLine(line: string): boolean {
  if (line.startsWith('>')) return true; // ScriptedDemoProvider 的演示声明行
  if (/^#{1,6}\s/.test(line)) return true;
  if (/^highlights?\s*[:：]?$/i.test(line.replace(/\*/g, '').trim())) return true;
  return false;
}

/**
 * 宽容解析 Highlights（或任何逐条清单）文本为字符串数组：
 * - 支持「- / * / • / + / – / —」与「1. / 1、 / 1)」序号，标记与 markdown 粗体剥掉；
 * - 跳过空行、演示声明（> 开头）、Markdown 标题、代码围栏（含围栏内部整段）；
 * - 无任何列表标记时按非空行原样返回（自由格式输出仍逐行呈现）；
 * - 见到列表标记后，无标记的折行续文并入上一条（宽容拼接，不丢内容）。
 */
export function parseHighlights(text: string): string[] {
  const items: string[] = [];
  let sawMarker = false;
  let inFence = false; // 代码围栏内部整段跳过（围栏行本身也跳过）
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('```')) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (isNoiseLine(line)) continue;
    const m = LIST_MARKER_RE.exec(line);
    if (m) {
      sawMarker = true;
      const item = line.slice(m[0].length).trim().replace(/\*{1,2}$/, '').trim();
      if (item) items.push(item);
    } else if (!sawMarker) {
      items.push(line);
    } else {
      const last = items[items.length - 1];
      if (last !== undefined) items[items.length - 1] = `${last} ${line}`;
    }
  }
  return items;
}
