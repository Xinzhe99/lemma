/**
 * AI 动作层：会话发送（Context Pack 注入 + 工具循环 + 引用核查护栏）、
 * 选区润色（走 diff 审批提案）、选中即问快捷动作、一键修编译错误
 * （读诊断 → 组装 prompt → 会话工具循环，tex.edit 落进阻塞审批卡）、
 * 计划模式（runPlannedTask 规划 → executePlan 逐步执行，见文末分区注释）。
 * AgentPanel 与编辑器选中工具条共用，避免循环依赖。
 */

import {
  OpenAICompatibleProvider,
  ScriptedDemoProvider,
  useAgentHubStore,
  type ChatProvider,
} from '@lemma/agent-hub';
import { validateCitations } from '@lemma/knowledge';
import { t } from './i18n';
import { useSettingsStore, type Language } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { useLibraryStore } from './state/libraryStore';
import { useProposalStore } from './state/proposalStore';
import { bibCitekeys } from './projectDoc';
import { resolveCompileEntry } from './compileAction';
import { CliAgentProvider, isCliAgentAvailable } from './cliAgent';
import { getPersona } from '@lemma/agent-hub';
import { useAgentUsageStore } from './state/agentUsage';
import type { AgentMessage } from '@lemma/shared';
import { ENABLED_TOOLS, buildContextPackMd, runAgentTurn } from './agentTools';
import { rejectPendingApproval } from './approval';
import { buildPolishPrompt, extractLatexBody, rulePolish } from './polish';
import { buildPlanPrompt, buildStepPrompt, parsePlan, type Plan } from './planMode';
import { useAgentPlansStore } from './state/agentPlans';
import { buildRuntimeContextBlock } from './runtimeContext';
import { rejectPendingUserAnswer } from './userAsk';
import { generateSessionTitle } from './sessionTitle';

export const CITATION_RULE =
  '\n\n## 核心规则\n1. 引用只能用本地文献库中存在的 citekey，可用 citation.validate 核验\n2. 写级操作（tex.edit / tex.create_file / citation.add）会弹出 diff 审批卡，用户裁决后结果回传给你\n3. 你有 19 个工具和 50 轮调用额度——不要问用户"要不要我做"，直接做\n4. user.ask 是唯一例外：只在【必须由人拍板且无法用工具查明】的分叉（目标期刊/语言/风格取舍）时用一次，选项不超过 4 个\n\n## 工作方式\n你是一个自主的学术写作 Agent。用户用自然语言描述需求，你自己决定用什么工具、什么顺序。例如：\n- "润色引言" → 读文件 → 找问题 → 修改 → 提交审批\n- "帮我找关于 diffusion 的相关论文" → 检索库 → 列出结果\n- "检查引用是否有问题" → 遍历 cite → 逐一验证 → 报告\n- "写一个 method section" → 读大纲 → 读文献 → 起草 → 提交审批\n\n不要一步步问用户确认。做完了再汇报结果。如果信息不够，先用工具获取，而不是反问。\n项目根目录若有 AGENTS.md（写作约定），它优先级最高，所有产出必须遵守。';

export interface ProviderChoice {
  provider: ChatProvider;
  model: string;
  label: string;
  real: boolean;
}

// ---------------------------------------------------------------------------
// 双语提示（D15）：润色流程的 setNote 消息。zh 保持原文，en 为准确翻译。
// 调用处经 pick(useSettingsStore.getState().language) 在发消息那一刻动态读取语言，
// 避免模块加载或长生命周期闭包造成的语言过期。
// ---------------------------------------------------------------------------

interface PolishDict {
  emptySelection: string;
  needTex: string;
  selectionMismatch: string;
  noChangeNeeded: string;
  polishFailed: (detail: string) => string;
}

export const L: Record<Language, PolishDict> = {
  zh: {
    emptySelection: '选区为空',
    needTex: '请先在编辑器打开一个 .tex 文件',
    selectionMismatch: '选区与文件内容不匹配（文件可能已变化），请重新选择',
    noChangeNeeded: '选中文本无需修改（离线规则未命中；配置模型服务可获得深度润色）',
    polishFailed: (detail) => `润色失败：${detail}`,
  },
  en: {
    emptySelection: 'The selection is empty',
    needTex: 'Open a .tex file in the editor first',
    selectionMismatch: 'The selection no longer matches the file content (the file may have changed); please reselect',
    noChangeNeeded: 'No changes needed for the selection (offline rules found nothing to fix; configure a model provider for deeper polishing)',
    polishFailed: (detail) => `Polish failed: ${detail}`,
  },
};

/** 按语言取文案（语言由调用处在发消息时动态读取） */
export function pick(lang: Language): PolishDict {
  return L[lang];
}

/**
 * 多 Provider 智能路由（v4.0.0 B）：
 * 有多个 provider 时，按任务复杂度选择：
 *   - simple（拼写修正、格式化）→ 优先 cheap tier
 *   - complex（重写、分析、审稿）→ 优先 flagship tier
 * 只有一个 provider 时行为与 resolveProvider() 完全一致。
 */
export type TaskComplexity = 'simple' | 'complex';

export function resolveProviderRouted(complexity: TaskComplexity): ProviderChoice {
  const s = useSettingsStore.getState();
  const available = s.providers.filter(
    (p) => p.baseUrl.trim().length > 0 && p.apiKey.trim().length > 0,
  );
  if (available.length <= 1) return resolveProvider();

  const preferredTier = complexity === 'simple' ? 'cheap' : 'flagship';
  const preferred = available.find((p) => p.tier === preferredTier);
  const chosen = preferred ?? available.find((p) => p.id === s.activeProviderId) ?? available[0]!;

  return {
    provider: new OpenAICompatibleProvider({
      id: chosen.id,
      label: chosen.label,
      baseUrl: chosen.baseUrl.trim(),
      apiKey: chosen.apiKey.trim(),
      fetchFn: (url, init) => fetch(url, init),
    }),
    model: chosen.model.trim() || 'default',
    label: `${chosen.label} · ${chosen.model || 'default'}`,
    real: true,
  };
}

export function resolveProvider(): ProviderChoice {
  const s = useSettingsStore.getState();
  const cfg = s.providers.find((p) => p.id === s.activeProviderId);
  const hasApi = !!cfg && cfg.baseUrl.trim().length > 0 && cfg.apiKey.trim().length > 0;
  // CLI agent 桥（v1.5.0）：可用条件 = 已启用 + 命令非空 + 桌面形态；引擎选择 auto/api/cli
  const cliReady = s.cliAgent.enabled && s.cliAgent.command.trim().length > 0 && isCliAgentAvailable();
  if (hasApi && s.agentEngine !== 'cli') {
    return {
      provider: new OpenAICompatibleProvider({
        id: cfg!.id,
        label: cfg!.label,
        baseUrl: cfg!.baseUrl.trim(),
        apiKey: cfg!.apiKey.trim(),
        fetchFn: (url, init) => fetch(url, init),
      }),
      model: cfg!.model.trim() || 'default',
      label: `${cfg!.label} · ${cfg!.model || 'default'}`,
      real: true,
    };
  }
  // CLI agent 桥（显式选择 cli，或 auto 且无 API 配置）：一次性进程调用，无工具协议
  if (cliReady && (s.agentEngine === 'cli' || !hasApi)) {
    const cli = new CliAgentProvider(s.cliAgent);
    return { provider: cli, model: s.cliAgent.command, label: cli.label, real: true };
  }
  // 零配置回退：ScriptedDemoProvider 按消息关键词输出预写的高质量演示内容
  // （W6/W7/W10/W12/W3 逐步脚本 + 通用说明），替代旧 EchoProvider 的纯回显。
  // real 保持 false：工具调用不启用，演示只覆盖文本输出；AgentPanel 的
  // providerLabel 取 provider.label，自然显示「演示模式（内置示例数据）」。
  const demo = new ScriptedDemoProvider();
  return { provider: demo, model: 'demo', label: demo.label, real: false };
}

/** 发送会话消息：组装上下文 → 流式回复（真实 provider 带工具多轮）→ 引用护栏 */
let chatAbort: AbortController | null = null;

// ---------------------------------------------------------------------------
// 长对话智能截断（v3.9.0 C）：上下文窗口有限，历史消息太多时需要裁剪。
// 策略：保留最近 10 条完整消息 + 更早的只保留前 3 轮对话的摘要。
// ---------------------------------------------------------------------------

const MAX_FULL_HISTORY = 10;

export function smartTruncateHistory(messages: AgentMessage[]): AgentMessage[] {
  if (messages.length <= MAX_FULL_HISTORY) return messages;
  const recent = messages.slice(-MAX_FULL_HISTORY);
  const older = messages.slice(0, -MAX_FULL_HISTORY);
  // 更早的消息截断到前 500 字（保留开头上下文）
  const truncatedOlder = older.map((m) => ({
    ...m,
    content: m.content.length > 500 ? m.content.slice(0, 500) + '\n…(已截断)' : m.content,
    id: `${m.id}-trunc`,
  }));
  // 最多保留 6 条截断的旧消息
  return [...truncatedOlder.slice(-6), ...recent];
}

// ---------------------------------------------------------------------------
// v7.5.0：摘要式历史压缩（对齐 agent-foundation CompactionCapability）。
// 机械截断（smartTruncateHistory）只保留旧消息开头 500 字，长会话中关键决定
// 会丢；这里改为：超过阈值时把「更早部分」用模型压成一份会话记忆摘要，
// 只发「摘要 + 最近 K 条完整消息」。摘要按会话缓存（covered = 已覆盖条数），
// 新增对话增量并入，不重复付费；压缩失败回退机械截断。UI 会话原文不动。
// ---------------------------------------------------------------------------

/** 最近 K 条消息完整保留 */
const COMPACT_KEEP_RECENT = 8;
/** 更早部分不足此字符数不值得压缩（一次模型调用换不回多少上下文） */
const COMPACT_MIN_OLDER_CHARS = 6000;
/** 单条消息进压缩 prompt 的上限 */
const COMPACT_PER_MSG_CHARS = 1200;

const COMPACT_SYSTEM = '你是会话压缩器：把学术写作对话压缩为简洁的上下文摘要，供同一 AI 恢复工作记忆。只输出摘要本身，不要任何前后缀或解释。';

interface CompactionCacheEntry {
  covered: number;
  summary: string;
}
const compactionCache = new Map<string, CompactionCacheEntry>();

/** 组装压缩 prompt（纯函数）：既有摘要（增量模式）+ 新增对话记录 */
export function buildCompactionPrompt(prevSummary: string | null, messages: AgentMessage[]): string {
  const parts: string[] = [];
  if (prevSummary) parts.push(`【既有摘要（已覆盖更早对话，在此基础上合并）】\n${prevSummary}`);
  const transcript = messages
    .map((m) => {
      const role = m.role === 'user' ? '用户' : 'AI';
      const content =
        m.content.length > COMPACT_PER_MSG_CHARS ? `${m.content.slice(0, COMPACT_PER_MSG_CHARS)}…` : m.content;
      return `${role}：${content}`;
    })
    .join('\n\n');
  if (messages.length > 0) parts.push(`【新增对话记录】\n${transcript}`);
  return [
    '请把以下学术写作会话压缩为一份「会话记忆摘要」。要求：',
    '- 保留：论文目标与当前进度、关键决定（结构/术语/方法论）、用户明确表达的偏好与要求、未完成事项',
    '- 丢弃：寒暄、重复内容、工具调用的原始输出细节（只留结论）',
    '- 用户的原话要求尽量保真转述',
    '- 输出纯文本，不超过 600 字',
    '',
    ...parts,
  ].join('\n');
}

/** 清空压缩缓存（测试辅助 / 会话删除后调用） */
export function resetCompactionCache(): void {
  compactionCache.clear();
}

/**
 * 尝试压缩发送历史：不足阈值返回 null（调用方回退机械截断）；
 * summarize 抛错同样返回 null——压缩是优化，绝不阻断对话。
 */
export async function compactHistoryForSend(
  sessionId: string,
  history: AgentMessage[],
  summarize: (prompt: string) => Promise<string>,
): Promise<AgentMessage[] | null> {
  if (history.length <= COMPACT_KEEP_RECENT + 4) return null;
  const cut = history.length - COMPACT_KEEP_RECENT;
  const older = history.slice(0, cut);
  const olderChars = older.reduce((s, m) => s + m.content.length, 0);
  if (olderChars < COMPACT_MIN_OLDER_CHARS) return null;

  const cached = compactionCache.get(sessionId);
  const prevSummary = cached && cached.covered <= cut ? cached.summary : null;
  const from = prevSummary ? cached!.covered : 0;

  let summary = prevSummary;
  // 覆盖数已追平（无新增）→ 直接复用缓存，不再调模型
  if (from < cut || !prevSummary) {
    let fresh: string;
    try {
      fresh = (await summarize(buildCompactionPrompt(prevSummary, history.slice(from, cut)))).trim();
    } catch {
      return null; // 压缩失败 → 调用方回退机械截断；压缩是优化，绝不阻断对话
    }
    if (!fresh) return null;
    summary = fresh;
    compactionCache.set(sessionId, { covered: cut, summary: fresh });
  }
  return [
    {
      id: `compact-${sessionId}-${cut}`,
      role: 'user',
      content: `[此前对话的压缩摘要（原 ${cut} 条消息已折叠，关键约定以摘要与 AGENTS.md 为准）]\n${summary}`,
      createdAt: history[0]?.createdAt ?? 0,
    },
    ...history.slice(cut),
  ];
}

/**
 * @citekey 论文提及注入（v4.3.0）：检测消息中的 @citekey 记号，把论文题录+摘要
 * 以引用块附在 user prompt 尾部——AI 直接看到论文内容，无需先调工具。
 * 每篇摘要截断 1000 字符，最多注入 3 篇（防上下文爆炸）。
 */
export function enrichWithPaperMentions(
  text: string,
  papers: { citekey: string; title: string; year?: number; venue?: { name?: string }; abstract?: string; pdfPath?: string }[],
): string {
  const mentioned = new Set<string>();
  for (const m of text.matchAll(/@([A-Za-z0-9_.:+-]+)/g)) mentioned.add(m[1]);
  if (mentioned.size === 0) return text;
  const blocks: string[] = [];
  for (const paper of papers) {
    if (!mentioned.has(paper.citekey)) continue;
    const head = `${paper.title}（${paper.year ?? '年份未知'}${paper.venue?.name ? `，${paper.venue.name}` : ''}）`;
    const abstract = (paper.abstract ?? '').trim();
    const body = abstract.length > 1000 ? `${abstract.slice(0, 1000)}…(已截断)` : abstract || '（无摘要）';
    blocks.push(
      `--- 文献 @${paper.citekey} ---\n${head}\n摘要：${body}${paper.pdfPath ? '\n（库内已附 PDF：可用 paper.read 工具读取全文）' : ''}\n--- 文献结束 ---`,
    );
    if (blocks.length >= 3) break;
  }
  if (blocks.length === 0) return text;
  return `${text}\n\n[提及的文献]\n${blocks.join('\n\n')}`;
}

/**
 * @mention 文件上下文注入（v3.6.0 A → v4.1.0 C 增强）：
 * 1. 显式引用：消息中出现文件路径 → 附上文件内容
 * 2. 意图检测（v4.1.0）：根据消息关键词自动注入相关上下文——
 *    "润色/修改/改写" → 当前活跃文件内容
 *    "引用/cite/文献" → refs.bib 的全部 citekey 列表
 *    "编译/错误/error" → 最近编译日志尾部
 */
function enrichWithFileContext(text: string): string {
  const ws = useWorkspaceStore.getState();
  const blocks: string[] = [];

  // 1. 显式文件引用（@mention 或文件路径）
  const referenced: string[] = [];
  for (const filePath of Object.keys(ws.files)) {
    if (text.includes(filePath)) referenced.push(filePath);
  }
  for (const fp of referenced.slice(0, 3)) {
    const content = ws.files[fp] ?? '';
    if (!content.trim()) continue;
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...(truncated)' : content;
    blocks.push(`--- 文件: ${fp} ---\n${truncated}\n--- 文件结束 ---`);
  }

  // 2. 意图检测（v4.1.0 C）：关键词 → 自动注入
  const lower = text.toLowerCase();

  // 润色/修改意图 → 自动附上当前活跃文件
  if (/润色|polish|改写|rewrite|修改|revise|改进|improve/.test(lower)) {
    const active = ws.activeTab;
    if (active && ws.files[active] && !referenced.includes(active)) {
      const content = ws.files[active] ?? '';
      const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...(truncated)' : content;
      blocks.push(`--- 当前编辑文件: ${active} ---\n${truncated}\n--- 文件结束 ---`);
    }
  }

  // 引用/文献意图 → 附上 .bib 中的全部 citekey
  if (/引用|cite|文献|paper|reference|bib/.test(lower)) {
    const bibPath = Object.keys(ws.files).find((f) => f.endsWith('.bib'));
    if (bibPath && ws.files[bibPath]) {
      const keys = [...ws.files[bibPath]!.matchAll(/@\w+\{([^,]+),/g)].map((m) => m[1]).filter(Boolean);
      if (keys.length > 0) {
        blocks.push(`--- 可用引用键（${bibPath}，共 ${keys.length} 条）---\n${keys.join(', ')}\n--- 列表结束 ---`);
      }
    }
  }

  // 编译/错误意图 → 附上最近编译日志尾部
  if (/编译|compile|错误|error|报错|fail/.test(lower)) {
    const log = ws.compileLog;
    if (log.length > 0) {
      blocks.push(`--- 最近编译日志（尾部 15 行）---\n${log.slice(-15).join('\n')}\n--- 日志结束 ---`);
    }
  }

  const withFiles =
    blocks.length === 0 ? text : `${text}\n\n[自动附加上下文]\n${blocks.join('\n\n')}`;
  // v4.3.0：@citekey 论文提及（题录+摘要）最后叠加
  return enrichWithPaperMentions(withFiles, useLibraryStore.getState().papers);
}

// ---------------------------------------------------------------------------
// v6.5.0：多类型附件内容提取——把用户拖入/上传的文件变成模型可读的文本块。
//  - 文本类（tex/bib/md/txt/csv/json/log/sty/cls）：直读（每文件截 8k 字符）
//  - PDF：loadPdfText 逐页抽文（截 12k）
//  - docx（桌面）：临时落盘 → pandoc 转 plain → 清理（浏览器形态提示）
//  - 其余二进制：只附文件名/大小说明，不伪装可读
// 总注入上限 40k 字符，保护上下文窗口。
// ---------------------------------------------------------------------------

const TEXTUAL_EXT = ['tex', 'bib', 'md', 'txt', 'csv', 'tsv', 'json', 'log', 'sty', 'cls', 'yaml', 'yml'];
const PER_FILE_LIMIT = 8000;
const PDF_LIMIT = 12000;
const TOTAL_LIMIT = 40000;

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** 兼容读取：优先 File.text()/arrayBuffer()，缺失时回落 FileReader（jsdom/旧内核） */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error('读取失败'));
    r.readAsText(file);
  });
}

function readFileBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(new Error('读取失败'));
    r.readAsArrayBuffer(file);
  });
}

export interface AttachmentBlocks {
  blocks: string[];
  /** 提取阶段的问题（如浏览器形态不支持 docx）——作为提示附给用户消息标记 */
  notes: string[];
}

export async function extractAttachmentBlocks(
  files: File[],
  deps: {
    loadPdfText?: (buf: ArrayBuffer) => Promise<{ numPages: number; pages: Array<{ page: number; text: string }> }>;
  } = {},
): Promise<AttachmentBlocks> {
  const blocks: string[] = [];
  const notes: string[] = [];
  let budget = TOTAL_LIMIT;
  for (const file of files) {
    if (budget <= 200) break;
    const ext = extOf(file.name);
    try {
      if (TEXTUAL_EXT.includes(ext) || file.type.startsWith('text/')) {
        const content = await readFileText(file);
        const clipped = content.slice(0, Math.min(PER_FILE_LIMIT, budget));
        blocks.push(
          `--- 附件 ${file.name} ---\n${clipped}${content.length > clipped.length ? '\n…（已截断）' : ''}\n--- 附件结束 ---`,
        );
        budget -= clipped.length;
      } else if (ext === 'pdf' || file.type === 'application/pdf') {
        const loadPdfText =
          deps.loadPdfText ?? (await import('@lemma/library/reader')).loadPdfText;
        const buf = await readFileBuffer(file);
        const result = await loadPdfText(buf);
        const text = result.pages
          .map((p) => `【第 ${p.page} 页】${p.text}`)
          .join('\n')
          .slice(0, Math.min(PDF_LIMIT, budget));
        blocks.push(
          `--- 附件 ${file.name}（PDF 共 ${result.numPages} 页，已抽全文）---\n${text}\n--- 附件结束 ---`,
        );
        budget -= text.length;
      } else if (ext === 'docx') {
        const isDesktop =
          typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ != null;
        if (!isDesktop) {
          notes.push(`${file.name}：.docx 解析需桌面版（浏览器形态不支持）`);
          continue;
        }
        const { getPlatform } = await import('./platform/types');
        const buf = await readFileBuffer(file);
        const base64 = arrayBufferToBase64(buf);
        const tmp = `sf-tmp-attach-${Date.now()}.docx`;
        // fs_write_base64 桥
        const { tauriProcRun, tauriWriteFileBase64 } = await import('./platform/tauri');
        await tauriWriteFileBase64(tmp, base64);
        try {
          const r = await tauriProcRun('pandoc', [tmp, '-t', 'plain']);
          if (r.code === 0 && r.stdout.trim()) {
            const clipped = r.stdout.slice(0, Math.min(PER_FILE_LIMIT, budget));
            blocks.push(`--- 附件 ${file.name}（Word，pandoc 转文本）---
${clipped}
--- 附件结束 ---`);
            budget -= clipped.length;
          } else {
            notes.push(`${file.name}：pandoc 解析失败（${(r.stderr || '无输出').slice(0, 80)}）`);
          }
        } finally {
          getPlatform().fs.deleteFile(tmp).catch(() => undefined);
        }
      } else {
        notes.push(`${file.name}：二进制格式（${ext || file.type || '未知'}）无法直接读取——如需分析请转成 PDF/文本/CSV`);
      }
    } catch (e) {
      notes.push(`${file.name}：读取失败（${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  return { blocks, notes };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** v6.3.0：chat 用量记录（与 research 同口径：字符折半估 token；估算非账单） */
function recordChatUsage(model: string, promptChars: number, reply: string, latencyMs: number): void {
  try {
    useAgentUsageStore.getState().record({
      kind: 'chat',
      model,
      inputTokens: Math.ceil(promptChars / 2),
      outputTokens: Math.ceil(reply.length / 2),
      latencyMs,
    });
  } catch {
    /* 用量记录失败不影响对话 */
  }
}

/** v6.2.0：Provider 错误友好化——常见 HTTP/网络错误映射为可行动的中文提示 */
export function friendlyProviderError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  const lower = raw.toLowerCase();
  if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('incorrect api key')) {
    return `${raw}
→ API Key 无效或未授权：请在「设置 → 模型服务」检查 Key 是否正确、是否过期。`;
  }
  if (lower.includes('403') || lower.includes('forbidden')) {
    return `${raw}
→ 无权访问：Key 可能没有该模型权限，或账号被限制。`;
  }
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('quota')) {
    return `${raw}
→ 请求过于频繁或额度不足：稍等片刻重试；若持续出现请检查服务商余额/限流设置。`;
  }
  if (lower.includes('404') || lower.includes('model_not_found') || lower.includes('does not exist')) {
    return `${raw}
→ 模型不存在：请在「设置 → 模型服务」核对模型名拼写。`;
  }
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted') || lower.includes('network') || lower.includes('fetch failed') || lower.includes('econnrefused')) {
    return `${raw}
→ 网络问题：检查网络/代理是否可达模型服务地址。`;
  }
  return raw;
}

/** 中止当前会话生成（停止按钮） */
export function abortChat(): void {
  chatAbort?.abort();
  chatAbort = null;
  // v7.0.0 修复：立即结算未决审批——此前要等 runAgentTurn 返回（可能正阻塞在审批上），
  // 用户点停止后审批卡仍挂着（停止按钮死区）
  rejectPendingApproval('用户停止生成，本次修改未生效');
  // v7.5.0：未决提问同样立即结算为「未作答」
  rejectPendingUserAnswer();
}

/**
 * 把外部长任务（并行研究等）的 AbortController 接到 chatAbort 上（v7.8.0）：
 * 这类任务同样把会话置为 streaming，界面上有停止按钮——不接的话按钮点了没反应。
 * 返回注销函数（任务结束时调用，避免误中止之后的对话）。
 */
export function bindChatAbort(ctrl: AbortController): () => void {
  chatAbort = ctrl;
  return () => {
    if (chatAbort === ctrl) chatAbort = null;
  };
}

/** v7.0.0 修复（重入）：同步占位——store 的 streaming 要到 sendMessage 才置位，
 * 中间隔着多个 await（上下文构建/附件提取），双发会双流交错且 chatAbort 被覆盖 */
let sendInFlight = false;

export async function sendChatMessage(text: string, images?: string[], files?: File[]): Promise<void> {
  if (sendInFlight) return;
  sendInFlight = true;
  try {
    await sendChatMessageInner(text, images, files);
  } finally {
    sendInFlight = false;
  }
}

async function sendChatMessageInner(text: string, images?: string[], files?: File[]): Promise<void> {
  const store = () => useAgentHubStore.getState();
  let sessionId = store().activeSessionId;
  if (!sessionId) sessionId = store().newSession('host', useWorkspaceStore.getState().projectName || undefined, t('sessions.newSession', useSettingsStore.getState().language));
  const session = store().sessions.find((s) => s.id === sessionId);
  if (session?.status === 'streaming') return;

  // v7.4.0 C：会话 token 预算检查（0 = 不限）
  const budget = useSettingsStore.getState().sessionBudgetTokens;
  if (budget > 0 && session) {
    const used = session.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 2), 0);
    if (used >= budget) {
      store().sendMessage(sessionId, text);
      store().appendDelta(
        sessionId,
        `

⚠️ **会话预算已用完**：本会话已消耗约 ${used} token（上限 ${budget}）。请新建会话继续，或在设置中调高「会话 token 预算」。`,
      );
      store().finishSession(sessionId, 'idle');
      return;
    }
  }

  // v3.9.0 A：AI 角色注入——不同角色有不同的行为方式
  const persona = getPersona(useSettingsStore.getState().aiPersona);
  // v7.5.0：provider 前置解析——历史压缩需要用当前 provider 调摘要模型
  const { provider, model, real } = resolveProvider();
  const settings = useSettingsStore.getState();
  // v7.0.0 修复（隔轮失忆 + 协议 400 + 费用放大）：
  //  a) 此前 .slice(0, -2) 在乐观插入【之前】快照——删掉的是上一轮真实对话（模型隔轮失忆）；
  //     快照先于插入，本就不含本轮消息，无需裁剪
  //  b) 历史过滤丢弃 role:'tool' 却保留 assistant.toolCalls → 悬空 tool_calls，
  //     严格 API（OpenAI/DeepSeek）直接 400——历史中剥离 toolCalls
  //  c) images 剥离（v6.8.0）保持——图片只随当轮发送
  const rawHistory = (store().sessions.find((s) => s.id === sessionId)?.messages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const noImages = !m.images || m.images.length === 0 ? m : (({ images: _i, ...rest }) => rest)(m);
      if (!noImages.toolCalls || noImages.toolCalls.length === 0) return noImages;
      const { toolCalls: _t, ...rest } = noImages;
      return rest;
    });
  // v7.5.0（Compaction）：长会话先尝试摘要压缩（模型折叠更早部分，保留关键决定），
  // 失败/不足阈值回退机械截断；演示模式直接机械截断
  let history: AgentMessage[];
  if (real) {
    const compacted = await compactHistoryForSend(sessionId, rawHistory, (prompt) =>
      runAgentTurn({ provider, model, system: COMPACT_SYSTEM, history: [], user: prompt, tools: [] }),
    ).catch(() => null);
    history = compacted ?? smartTruncateHistory(rawHistory);
  } else {
    history = smartTruncateHistory(rawHistory);
  }
  // v7.5.0（RuntimeContext）：注入当前时间/上下文规模/预算用量（有界投影）
  // v7.8.0 修复（无声失败）：Context Pack 组装要经检索/embedding，可能抛错——
  // 此前异常直接冒泡成 unhandled rejection（调用方是 void sendChatMessage），
  // 用户点了发送却什么都不发生、连消息都没有。改为降级：本轮不带 Context Pack
  // 继续，并在会话里留痕（可行动提示）。
  let contextMd = '';
  let preflightNote = '';
  try {
    contextMd = await buildContextPackMd(text);
  } catch (e) {
    preflightNote = `\n\n> ⚠️ 上下文组装失败（${e instanceof Error ? e.message : String(e)}）：本轮未带项目 Context Pack，仅按基础指令与你当前消息作答。\n`;
  }
  const system =
    contextMd +
    CITATION_RULE +
    persona.systemAddendum +
    buildRuntimeContextBlock({
      historyMessages: history.length,
      historyChars: history.reduce((s, m) => s + m.content.length, 0),
      sessionBudgetTokens: settings.sessionBudgetTokens,
      sessionUsedTokens: session
        ? session.messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 2), 0)
        : 0,
    });
  // v6.5.0：附件内容提取（文件 → 模型可读文本块，注入发送给 AI 的 user prompt）
  let attachmentBlocks: string[] = [];
  let attachmentNotes: string[] = [];
  if (files && files.length > 0) {
    try {
      const extracted = await extractAttachmentBlocks(files);
      attachmentBlocks = extracted.blocks;
      attachmentNotes = extracted.notes;
    } catch (e) {
      // 同上：附件提取整体异常不再吞掉整轮对话，退化为「仅文字 + 提示」
      attachmentNotes = [`附件提取失败（${e instanceof Error ? e.message : String(e)}），本轮未附带附件内容`];
    }
  }
  const fileMark = files && files.length > 0 ? `
[附件：${files.map((f) => f.name).join('、')}]` : '';

  // v7.7.0（Codex 式会话标题）：门控数据——仅「会话第一轮」（此前消息数 ≤ 1）触发；
  // 必须在乐观插入前快照，插入后消息数恒 > 1
  const isFirstRound = (store().sessions.find((s) => s.id === sessionId)?.messages.length ?? 0) <= 1;

  // UI 显示原始消息（附图/附件以标记+缩略图呈现）
  store().sendMessage(
    sessionId,
    `${text}${images && images.length > 0 ? `
[图片 ×${images.length}]` : ''}${fileMark}`,
    images,
  );
  if (preflightNote) store().appendDelta(sessionId, preflightNote); // 上下文降级留痕（v7.8.0）
  if (images && images.length > 0 && !resolveProvider().real) {
    store().appendDelta(sessionId, '⚠️ 演示模式不支持图片——请在「设置 → 模型服务」配置多模态模型（如 GLM-4V / gpt-4o / Qwen-VL）后重试。');
    store().finishSession(sessionId, 'idle');
    return;
  }

  // v3.6.0 A：@mention 文件自动附上内容（Cursor 式上下文注入）——
  // 检测消息中引用的项目文件，把内容附在发送给 AI 的 user prompt 中
  let enrichedUser = enrichWithFileContext(text);
  if (attachmentBlocks.length > 0 || attachmentNotes.length > 0) {
    const parts = [...attachmentBlocks];
    if (attachmentNotes.length > 0) {
      parts.push(`--- 附件提示 ---\n${attachmentNotes.join('\n')}\n---`);
    }
    enrichedUser = `${enrichedUser}\n\n${parts.join('\n\n')}`;
  }

  const abort = new AbortController();
  chatAbort = abort;
  let acc = '';
  const startedAt = Date.now();
  try {
    acc = await runAgentTurn({
      provider,
      model,
      system,
      history,
      user: enrichedUser,
      userImages: images,
      tools: real ? ENABLED_TOOLS : [],
      signal: abort.signal,
      // v7.5.0（RequestAffinity）：同会话稳定 cache key → 服务商前缀缓存命中（设置可关）
      cacheKey: settings.promptCacheKey !== false ? sessionId : undefined,
      onDelta: (delta) => store().appendDelta(sessionId, delta),
      onToolCall: (call) => store().appendToolCall(sessionId, call),
      onToolResult: (callId, content) => store().appendToolResult(sessionId, callId, content),
    });
  } catch (e) {
    // v7.0.0 修复：abortChat() 在 abort 同时置空 chatAbort——此前判定在用户主动停止时恒为
    // false；且 provider 把 AbortError 包装成普通 Error（name 失效）。signal.aborted 是唯一可靠判据
    const aborted = abort.signal.aborted;
    if (aborted) {
      store().appendDelta(sessionId, '\n\n[已停止]');
    } else {
      store().appendDelta(sessionId, `\n\n[调用异常] ${friendlyProviderError(e)}`);
    }
  } finally {
    chatAbort = null;
    // 会话中止/结束时，未决的阻塞审批按拒绝结算，绝不悬空
    rejectPendingApproval('会话已中止或结束，本次修改未生效');
    // v7.5.0：未决提问同样立即结算
    rejectPendingUserAnswer();
  }

  if (real && acc) {
    recordChatUsage(model, system.length + enrichedUser.length, acc, Date.now() - startedAt);
  }

  // 学术诚信护栏：引用核查
  const validKeys = [
    ...new Set([
      ...useLibraryStore.getState().papers.map((p) => p.citekey),
      ...bibCitekeys(useWorkspaceStore.getState().files),
    ]),
  ];
  // v7.0.0 修复：validateCitations 只匹配 [key] 方括号——模型实际输出 \cite{a,b}，
  // 护栏此前零检出（形同虚设）。先把 \cite 键展开为 [key] 再校验
  const citeKeys = [...acc.matchAll(/\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)]
    .flatMap((m) => m[1]!.split(',').map((k) => k.trim()).filter(Boolean))
    .map((k) => `[${k}]`)
    .join(' ');
  const check = validateCitations(`${acc}\n${citeKeys}`, validKeys);
  if (!check.ok) {
    store().appendDelta(
      sessionId,
      `\n\n---\n⚠️ **引用核查（学术诚信护栏）**：以下引用未在本地文献库或 refs.bib 中找到，疑似幻觉引用，请核实：${check.invalid
        .map((k) => `[${k}]`)
        .join(' ')}`,
    );
  }
  store().finishSession(sessionId, 'idle');

  // v7.7.0（Codex 式会话标题）：第一轮真实回复成功完成后，异步生成 AI 标题。
  // fire-and-forget：generateSessionTitle 失败/超时返回 null，这里再兜一层 catch；
  // 仅当标题仍是首条消息前缀的派生值时才覆盖（用户手动改名后不抢）。
  if (real && isFirstRound && acc && !abort.signal.aborted) {
    void generateSessionTitle(text, acc)
      .then((title) => {
        if (!title) return;
        const hub = useAgentHubStore.getState();
        const s = hub.sessions.find((x) => x.id === sessionId);
        const firstUser = s?.messages.find((m) => m.role === 'user');
        if (!s || !firstUser) return;
        // 与 store.sendMessage 的派生规则一致：首条 user 消息 trim 后取前 24 字
        if (s.title === firstUser.content.trim().slice(0, 24)) hub.renameSession(s.id, title);
      })
      .catch(() => undefined);
  }
}

/** 润色编辑器选中文本：产生整文件 diff 提案（规则润色离线可用，模型走 runAgentTurn） */
export async function polishSelection(selection: string): Promise<void> {
  const t = pick(useSettingsStore.getState().language);
  const trimmed = selection.trim();
  const proposalStore = useProposalStore.getState();
  if (!trimmed) {
    proposalStore.setNote(t.emptySelection);
    return;
  }
  const ws = useWorkspaceStore.getState();
  const file = ws.activeTab;
  if (!file || !file.endsWith('.tex') || ws.files[file] === undefined) {
    proposalStore.setNote(t.needTex);
    return;
  }
  const before = ws.files[file]!;
  if (!before.includes(selection)) {
    proposalStore.setNote(t.selectionMismatch);
    return;
  }

  const { real, model, provider } = resolveProvider();
  let polished: string;
  let via: string;
  if (real) {
    try {
      const system = await buildContextPackMd('学术润色（选中文本）');
      const reply = await runAgentTurn({
        provider,
        model,
        system,
        history: [],
        user: buildPolishPrompt(selection),
      });
      polished = extractLatexBody(reply);
      via = model;
    } catch (e) {
      proposalStore.setNote(t.polishFailed(e instanceof Error ? e.message : String(e)));
      return;
    }
  } else {
    polished = rulePolish(selection);
    via = '规则润色（离线）';
  }

  if (!polished.trim() || polished.trim() === trimmed) {
    proposalStore.setNote(t.noChangeNeeded);
    return;
  }
  proposalStore.setProposal({
    file,
    before,
    after: before.replace(selection, polished),
    kind: 'polish',
    label: 'AI 润色（选中文本）',
    via,
  });
}

// ---------------------------------------------------------------------------
// AI 扩写 / 缩写（v3.0.0 ①②）：选区级段落操作，与 polishSelection 同架构。
// ---------------------------------------------------------------------------

type SelectionMode = 'expand' | 'condense';

const MODE_PROMPTS: Record<SelectionMode, (text: string) => string> = {
  expand: (t) =>
    `请对以下学术段落进行扩写：添加更多技术细节、解释关键概念、给出具体例子或数据支撑。要求：\n` +
    `- 保持原意与学术语气\n- 扩充至原文的 1.5-2 倍长度\n- 保留所有 LaTeX 命令原样\n- 不要添加引用（由作者决定引谁）\n\n原文：\n${t}`,
  condense: (t) =>
    `请对以下学术段落进行缩写：删除冗余表达、合并重复观点、精简句式。要求：\n` +
    `- 保留核心论点与关键数据\n- 压缩至原文的 50-70% 长度\n- 保留所有 LaTeX 命令与引用原样\n- 不丢失任何技术信息\n\n原文：\n${t}`,
};

const MODE_LABELS: Record<SelectionMode, string> = {
  expand: 'AI 扩写（添加细节）',
  condense: 'AI 缩写（精简表达）',
};

/** AI 扩写/缩写的通用实现 */
async function transformSelection(selection: string, mode: SelectionMode): Promise<void> {
  const t = pick(useSettingsStore.getState().language);
  const trimmed = selection.trim();
  const proposalStore = useProposalStore.getState();
  if (!trimmed) {
    proposalStore.setNote(t.emptySelection);
    return;
  }
  const ws = useWorkspaceStore.getState();
  const file = ws.activeTab;
  if (!file || !file.endsWith('.tex') || ws.files[file] === undefined) {
    proposalStore.setNote(t.needTex);
    return;
  }
  const before = ws.files[file]!;
  if (!before.includes(selection)) {
    proposalStore.setNote(t.selectionMismatch);
    return;
  }

  const { real, model, provider } = resolveProvider();
  let result: string;
  let via: string;
  if (real) {
    try {
      const system = await buildContextPackMd(mode === 'expand' ? '学术扩写' : '学术缩写');
      const reply = await runAgentTurn({
        provider,
        model,
        system,
        history: [],
        user: MODE_PROMPTS[mode](selection),
      });
      result = extractLatexBody(reply);
      via = model;
    } catch (e) {
      proposalStore.setNote(t.polishFailed(e instanceof Error ? e.message : String(e)));
      return;
    }
  } else {
    // 离线演示：简单模拟（扩写=加一句解释，缩写=取前半）
    result = mode === 'expand'
      ? `${trimmed} This is further supported by the observation that the proposed mechanism consistently yields measurable improvements across evaluation settings.`
      : trimmed.split('.')[0] + '.';
    via = '离线演示';
  }

  if (!result.trim() || result.trim() === trimmed) {
    proposalStore.setNote(t.noChangeNeeded);
    return;
  }
  proposalStore.setProposal({
    file,
    before,
    after: before.replace(selection, result),
    kind: 'polish',
    label: MODE_LABELS[mode],
    via,
  });
}

/** AI 扩写选区：添加更多细节、解释、例子 */
export async function expandSelection(selection: string): Promise<void> {
  await transformSelection(selection, 'expand');
}

/** AI 缩写选区：精简表达，保留核心论点 */
export async function condenseSelection(selection: string): Promise<void> {
  await transformSelection(selection, 'condense');
}

/**
 * 选中句子改写器（v1.6.0 ②）：返回 2–4 个改写变体（由调用方渲染挑选卡）。
 * 真实模型：要求输出 N 行变体并解析；演示/离线：本地规则改写（同义词替换 +
 * 句式微调，命中词典才会产生变化——未命中返回空数组并提示）。不动稿件：
 * 用户点选变体后由调用方构造 EditProposal 走 diff 审批。
 */
export async function paraphraseSelection(selection: string, count = 3): Promise<string[]> {
  const t = pick(useSettingsStore.getState().language);
  const trimmed = selection.trim();
  const proposalStore = useProposalStore.getState();
  if (!trimmed) {
    proposalStore.setNote(t.emptySelection);
    return [];
  }
  const ws = useWorkspaceStore.getState();
  const file = ws.activeTab;
  if (!file || !file.endsWith('.tex') || ws.files[file] === undefined) {
    proposalStore.setNote(t.needTex);
    return [];
  }

  const { real, model, provider } = resolveProvider();
  if (real) {
    let reply: string;
    try {
      const system = await buildContextPackMd('学术句子改写');
      reply = await runAgentTurn({
        provider,
        model,
        system,
        history: [],
        user:
          `请把下面的学术句子改写为 ${count} 个不同的表达变体（改写此句）。要求：保持学术语气与原意，不增删信息；保留所有 \\cite / \\ref / \\label 等 LaTeX 命令与数学环境原样；每行一个变体，不要编号与解释。\n\n${trimmed}`,
      });
    } catch (e) {
      proposalStore.setNote(t.polishFailed(e instanceof Error ? e.message : String(e)));
      return [];
    }
    const variants = reply
      .split('\n')
      .map((l) => l.replace(/^\s*\d+[.、)]\s*/, '').trim())
      .filter((l) => l.length > 0 && l !== trimmed);
    const uniq = [...new Set(variants)].slice(0, count);
    if (uniq.length === 0) {
      proposalStore.setNote(t.noChangeNeeded);
    }
    return uniq;
  }

  // 离线规则改写：同义词替换（THESAURUS 命中才产生变化）+ 被动化微调，最多 2 个变体
  const { THESAURUS } = await import('@lemma/editor');
  const words = trimmed.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  const hits = words.filter((w) => THESAURUS[w.toLowerCase()]?.[0]);
  if (hits.length === 0) {
    proposalStore.setNote(t.noChangeNeeded);
    return [];
  }
  const swap = (nth: number): string =>
    trimmed.replace(/[A-Za-z][A-Za-z'-]*/g, (w) => {
      const alts = THESAURUS[w.toLowerCase()];
      if (!alts) return w;
      const pickWord = alts[Math.min(nth, alts.length - 1)] ?? w;
      return w[0] === w[0].toUpperCase() ? pickWord[0].toUpperCase() + pickWord.slice(1) : pickWord;
    });
  return [swap(0), swap(1)].filter((v, i, a) => v !== trimmed && a.indexOf(v) === i);
}

export type QuickAskKind = 'explain' | 'translate' | 'find';

const QUICK_PROMPTS: Record<QuickAskKind, (text: string) => string> = {
  explain: (t) => `请解释以下选中文本的含义与作用（涉及公式时逐项说明符号）：\n\n${t}`,
  translate: (t) =>
    `请把以下选中文本在中英之间互译（英文→中文，中文→英文）：保留所有 LaTeX 命令、数学环境与 \\cite 键不动，只翻译自然语言：\n\n${t}`,
  find: (t) =>
    `请检索本地文献库（可用 library.search_fulltext 工具），推荐与以下选中文本最相关的文献并说明相关性：\n\n${t}`,
};

/** 选中即问：解释 / 翻译 / 找文献，作为会话消息发送 */
export function quickAsk(kind: QuickAskKind, text: string): void {
  void sendChatMessage(QUICK_PROMPTS[kind](text));
}

// ---------------------------------------------------------------------------
// AI 一键修编译错误（P0）：读 compileLog → 解析 error 级诊断 → 组装 prompt
// （错误清单 + 出错文件/入口/活动 .tex 的上下文片段）→ 经 sendChatMessage 走
// 既有会话与工具循环：真实 provider 携带 ENABLED_TOOLS（tex.edit 自动落进
// 阻塞 diff 审批卡，用户裁决后回传模型——产品哲学：AI 只提案，人拍板）；
// 演示模式由 ScriptedDemoProvider 按 prompt 关键词路由（「修复以下 LaTeX
// 编译错误」，demo 脚本由集成者补充，见 demo.ts ROUTES）。
// UI 入口为命令 compile.aiFix（commands.ts，集成者注册），本模块只导出动作。
// ---------------------------------------------------------------------------

/** 单条编译错误（从 compileLog 诊断行解析） */
export interface CompileErrorItem {
  file: string;
  line: number | null;
  message: string;
}

export interface CompileErrorDigest {
  errors: CompileErrorItem[];
  /** 诊断中出现过的文件（按出现顺序去重） */
  files: string[];
}

/** 单条错误上限与清单上限（防失控 prompt：超长日志截断为「前 N 条」） */
const MAX_ERRORS_IN_PROMPT = 30;

/**
 * 解析编译日志中的 error 级诊断行。compileAction.logDiagnostics 的写入格式为
 * `  [severity] file:line message`（file 缺 line 时为 `  [severity] file message`），
 * 真实引擎与模拟引擎两条路径共用该格式，故解析日志行即同时覆盖两者。
 * warning 级忽略（一键修复只针对失败原因）。
 */
export function parseCompileErrors(log: readonly string[]): CompileErrorDigest {
  const errors: CompileErrorItem[] = [];
  const files: string[] = [];
  const seen = new Set<string>();
  for (const raw of log) {
    const m = /^\s*\[error\]\s+(\S+?)(?::(\d+))?\s+(.*)$/.exec(raw);
    if (!m) continue;
    const file = m[1]!;
    const line = m[2] !== undefined && /^\d+$/.test(m[2]) ? Number(m[2]) : null;
    errors.push({ file, line, message: m[3] ?? '' });
    if (!seen.has(file)) {
      seen.add(file);
      files.push(file);
    }
  }
  return { errors, files };
}

/** 日志中的诊断文件名解析到工作区实际路径：优先精确匹配，其次补 .tex 扩展名 */
function resolveErrorFile(name: string, files: Record<string, string>): string | null {
  if (files[name] !== undefined) return name;
  if (!name.endsWith('.tex') && files[`${name}.tex`] !== undefined) return `${name}.tex`;
  return null;
}

/** 片段窗口：错误行前后各 PAD 行；同文件多错误合并窗口后按区间输出 */
const CONTEXT_PAD = 12;
/** 单文件片段字符上限与上下文总上限（长文档防 prompt 爆炸） */
const MAX_SNIPPET_CHARS = 4000;
const MAX_CONTEXT_CHARS = 9000;

/**
 * 组装出错文件的上下文片段（纯函数）：错误文件（含 \input 链上能解析到的）
 * 按错误行 ±12 行截取；无行号的文件取开头。焦点文件（入口/活动 .tex）不在
 * 错误清单时补充全文开头，帮助模型看到导言区（宏包加载错误常源于此）。
 */
export function buildFixCompileErrorsContext(
  digest: CompileErrorDigest,
  files: Record<string, string>,
  focus: { entry: string | null; active: string | null },
): string {
  // 文件顺序：出错文件（按出现顺序）→ 入口 → 活动 .tex
  const ordered: string[] = [];
  const push = (p: string | null): void => {
    if (!p || files[p] === undefined || ordered.includes(p)) return;
    ordered.push(p);
  };
  for (const name of digest.files) push(resolveErrorFile(name, files));
  push(focus.entry);
  push(focus.active && focus.active.endsWith('.tex') ? focus.active : null);

  // 每个文件聚合错误行窗口
  const linesByFile = new Map<string, number[]>();
  for (const e of digest.errors) {
    const resolved = resolveErrorFile(e.file, files);
    if (!resolved || e.line === null) continue;
    const list = linesByFile.get(resolved) ?? [];
    list.push(e.line);
    linesByFile.set(resolved, list);
  }

  const parts: string[] = [];
  let total = 0;
  for (const path of ordered) {
    if (total >= MAX_CONTEXT_CHARS) break;
    const content = files[path]!;
    const lines = content.split('\n');
    const errLines = linesByFile.get(path) ?? [];
    let snippet: string;
    if (errLines.length > 0) {
      // 多错误合并窗口：排序后按 [line-PAD, line+PAD] 融合为区间组
      const spans: [number, number][] = [];
      for (const ln of [...errLines].sort((a, b) => a - b)) {
        const start = Math.max(1, ln - CONTEXT_PAD);
        const end = Math.min(lines.length, ln + CONTEXT_PAD);
        const last = spans[spans.length - 1];
        if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
        else spans.push([start, end]);
      }
      snippet = spans
        .map(([s, e]) => {
          const body = lines
            .slice(s - 1, e)
            .map((text, i) => `${s + i}: ${text}`)
            .join('\n');
          return `（第 ${s}–${e} 行）\n${body}`;
        })
        .join('\n…\n');
    } else {
      const e = Math.min(lines.length, 60);
      snippet = `（第 1–${e} 行）\n${lines.slice(0, e).map((text, i) => `${i + 1}: ${text}`).join('\n')}`;
    }
    if (snippet.length > MAX_SNIPPET_CHARS) snippet = `${snippet.slice(0, MAX_SNIPPET_CHARS)}\n…（已截断）`;
    parts.push(`### ${path}\n${snippet}`);
    total += snippet.length;
  }
  return parts.join('\n\n');
}

/**
 * 组装一键修编译错误的完整 prompt（保持中文：演示路由关键词为中文原文，
 * 真实模型对中文指令同样稳定）。首句固定含路由关键词「修复以下 LaTeX 编译错误」。
 */
export function buildFixCompileErrorsPrompt(
  digest: CompileErrorDigest,
  files: Record<string, string>,
  focus: { entry: string | null; active: string | null },
): string {
  const list = digest.errors
    .slice(0, MAX_ERRORS_IN_PROMPT)
    .map((e, i) => `${i + 1}. ${e.file}${e.line !== null ? `:${e.line}` : ''} — ${e.message}`)
    .join('\n');
  const more = digest.errors.length > MAX_ERRORS_IN_PROMPT
    ? `\n（共 ${digest.errors.length} 条，仅列出前 ${MAX_ERRORS_IN_PROMPT} 条）`
    : '';
  const context = buildFixCompileErrorsContext(digest, files, focus);
  return [
    '请修复以下 LaTeX 编译错误：逐条分析根因，用 tex.edit 工具给出最小必要的修改；每次修改会弹出 diff 审批卡，由用户裁决后才落盘。',
    '',
    '## 错误清单（最近一次编译的诊断）',
    list + more,
    '',
    '## 相关文件上下文（带行号）',
    context || '（出错文件不在当前工作区）',
    '',
    '## 修改要求',
    '- 只修复导致 error 的最小问题，不要顺手重写无关内容；',
    '- 数学环境内容与既有 \\cite 键保持不动；',
    '- 若错误源于宏包缺失，优先给不引入新依赖的替代写法；',
    '- 全部修改后调用 tex.compile 验证是否恢复。',
  ].join('\n');
}

// 双语文案（D15 同款约定：调用处发消息那一刻动态读取语言）
interface FixCompileDict {
  noErrors: string;
}

export const FIX_L: Record<Language, FixCompileDict> = {
  zh: {
    noErrors: '编译日志中没有 error 级诊断——无需修复。若刚改动过源码，请先重新编译。',
  },
  en: {
    noErrors: 'No error-level diagnostics in the compile log — nothing to fix. Recompile first if you just edited the sources.',
  },
};

/** 按语言取一键修复文案 */
export function pickFix(lang: Language): FixCompileDict {
  return FIX_L[lang];
}

/**
 * AI 一键修编译错误：日志无 error 时直接在提案卡位置给出提示（不发起会话）；
 * 否则组装 prompt 后经 sendChatMessage 进入既有会话流（真实 provider 带
 * ENABLED_TOOLS：tex.edit 阻塞审批、tex.compile 复验；演示模式按关键词路由）。
 */
export async function fixCompileErrors(): Promise<void> {
  const ws = useWorkspaceStore.getState();
  const digest = parseCompileErrors(ws.compileLog);
  if (digest.errors.length === 0) {
    useProposalStore.getState().setNote(pickFix(useSettingsStore.getState().language).noErrors);
    return;
  }
  const prompt = buildFixCompileErrorsPrompt(digest, ws.files, {
    entry: resolveCompileEntry(),
    active: ws.activeTab,
  });
  await sendChatMessage(prompt);
}

// ---------------------------------------------------------------------------
// 计划模式（Plan Mode）：先规划后自主执行的多步能力。
// 复用 Agent 会话通道（乐观消息 + appendDelta 流式 + finishSession），
// 不另起独立模式；计划是「特殊 assistant 消息 + agentPlans store 的执行态」。
// 流程：runPlannedTask（规划轮，纯文本不带工具）→ parsePlan → upsert 到
// agentPlans（键 = 承载计划的 assistant 消息 id）→ 用户在 PlanCard 点
// 【批准并执行】→ executePlan 逐步 buildStepPrompt + runAgentTurn（真实
// provider 带 ENABLED_TOOLS：写级工具照常落阻塞 diff 审批卡，不绕过任何
// 安全机制；演示模式不带工具）→ 每步结果写回 statuses/outputs →
// 全部完结 appendDelta 汇总消息。UI 接线（AgentPanel/命令/演示路由）见报告。
// ---------------------------------------------------------------------------

/** 计划执行轮的 AbortController（abortPlan 停止当前计划；与 chatAbort 同步指向，
 *  让 ChatPanel 的停止按钮在计划轮同样生效） */
let planAbort: AbortController | null = null;

/** 中止当前计划（规划轮或逐步执行轮） */
export function abortPlan(): void {
  planAbort?.abort();
  planAbort = null;
  // v7.8.0：与 abortChat 对齐——计划轮里的写级工具正阻塞在审批/提问上时，
  // 只 abort 信号不会结算它们，PlanCard 会一直转圈到用户手动点卡（看起来像卡死）
  rejectPendingApproval('计划已中止，本次修改未生效');
  rejectPendingUserAnswer();
}

/** 挂起中的 executePlan（按 msgId 去重：批准/重试连点不会并发驱动同一计划） */
const executingPlans = new Set<string>();

/** 找到包含指定消息的会话（计划挂在 assistant 消息上，执行态里不冗余存 sessionId） */
function sessionOfMessage(msgId: string): string | null {
  const s = useAgentHubStore
    .getState()
    .sessions.find((sess) => sess.messages.some((m) => m.id === msgId));
  return s?.id ?? null;
}

/**
 * 计划模式入口：用户提出复杂任务 → 规划轮产出计划 JSON。
 * 规划轮为纯文本生成（tools 空：计划只规划不执行），回复流式呈现；
 * parsePlan 命中 → 计划登记到 agentPlans（键 = 刚完成的 assistant 消息 id），
 * 等待用户在 PlanCard 批准；未命中（模型给了普通回答/演示模式未收录路由）→
 * 就此结束，普通回答已流式呈现，不产出计划卡。
 */
export async function runPlannedTask(userRequest: string): Promise<void> {
  const store = () => useAgentHubStore.getState();
  let sessionId = store().activeSessionId;
  if (!sessionId) sessionId = store().newSession('host', useWorkspaceStore.getState().projectName || undefined, t('sessions.newSession', useSettingsStore.getState().language));
  if (store().sessions.find((s) => s.id === sessionId)?.status === 'streaming') return;

  // v7.8.0 修复（无声失败）：同 sendChatMessage——上下文组装抛错时此前整轮规划
  // 直接冒泡（调用方是 void），用户点「计划模式」后什么都没发生。降级为空上下文继续。
  let contextMd = '';
  let preflightNote = '';
  try {
    contextMd = await buildContextPackMd(userRequest);
  } catch (e) {
    preflightNote = `\n\n> ⚠️ 上下文组装失败（${e instanceof Error ? e.message : String(e)}）：本次规划未带项目 Context Pack。\n`;
  }
  const system = contextMd + CITATION_RULE;
  // v7.8.0：历史快照必须取「乐观插入之前」的**全部**历史——当前 user 消息尚未入列，
  // 再 slice(0, -2) 会把上一轮的 user+assistant 一并丢掉（模型隔轮失忆；
  // sendChatMessageInner 的 v7.0.0 修复即为此，计划轮此前漏改）
  const history = smartTruncateHistory(
    (store().sessions.find((s) => s.id === sessionId)?.messages ?? []).filter(
      (m) => m.role === 'user' || m.role === 'assistant',
    ),
  );
  store().sendMessage(sessionId, userRequest.trim());
  if (preflightNote) store().appendDelta(sessionId, preflightNote); // 上下文降级留痕（v7.8.0）

  const { provider, model } = resolveProvider();
  const abort = new AbortController();
  planAbort = abort;
  chatAbort = abort;
  let acc = '';
  try {
    acc = await runAgentTurn({
      provider,
      model,
      system,
      history,
      user: buildPlanPrompt(userRequest, contextMd),
      tools: [], // 规划轮只规划不执行
      signal: abort.signal,
      onDelta: (delta) => store().appendDelta(sessionId, delta),
    });
  } catch (e) {
    // v7.0.0 修复：abortChat() 在 abort 同时置空 chatAbort——此前判定在用户主动停止时恒为
    // false；且 provider 把 AbortError 包装成普通 Error（name 失效）。signal.aborted 是唯一可靠判据
    const aborted = abort.signal.aborted;
    if (aborted) {
      store().appendDelta(sessionId, '\n\n[已停止]');
    } else {
      store().appendDelta(sessionId, `\n\n[调用异常] ${friendlyProviderError(e)}`);
    }
  } finally {
    if (planAbort === abort) planAbort = null;
    if (chatAbort === abort) chatAbort = null;
    rejectPendingApproval('会话已中止或结束，本次修改未生效');
  }

  const plan = parsePlan(acc);
  if (!plan) {
    store().finishSession(sessionId, 'idle');
    return; // 普通回答：原文已流式呈现，无计划卡
  }

  // msgId 取刚完成的 assistant 消息 id（从 store 读最后一条 assistant）
  const session = store().sessions.find((s) => s.id === sessionId);
  const assistantId = [...(session?.messages ?? [])].reverse().find((m) => m.role === 'assistant')?.id;
  if (assistantId) useAgentPlansStore.getState().upsert(assistantId, plan);
  store().finishSession(sessionId, 'idle');
}

/** 逐步执行的前步产出过滤：只取当前步骤之前、有产出的步骤（buildStepPrompt 内再裁预算） */
function priorOutputsOf(plan: Plan, outputs: Record<string, string>, stepId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const s of plan.steps) {
    if (s.id === stepId) break;
    if (outputs[s.id]) out[s.id] = outputs[s.id];
  }
  return out;
}

/**
 * 执行（或续跑/重试）一份已批准的计划：从首个 pending/failed 步骤起逐步执行。
 * 每步走 runAgentTurn（真实 provider 带 ENABLED_TOOLS → 写级自动进阻塞审批）；
 * 单步失败 → failed 并停（用户可跳过续跑/重试/中止）；全部完结 → 会话追加汇总
 * 消息「✅ 计划完成：goal（N 步）」。步骤正文不刷进会话（结果落在 PlanCard
 * 清单），工具调用卡附着在计划消息上保留操作轨迹。
 */
export async function executePlan(msgId: string): Promise<void> {
  if (executingPlans.has(msgId)) return; // 并发保护：批准/重试连点只驱动一次
  const plansStore = useAgentPlansStore.getState();
  const execution = plansStore.plans[msgId];
  if (!execution) return;
  const sessionId = sessionOfMessage(msgId);
  if (!sessionId) return;
  if (useAgentHubStore.getState().sessions.find((s) => s.id === sessionId)?.status === 'streaming') return;

  executingPlans.add(msgId);
  const store = () => useAgentHubStore.getState();
  store().finishSession(sessionId, 'streaming');

  const { provider, model, real } = resolveProvider();
  const abort = new AbortController();
  planAbort = abort;
  chatAbort = abort;

  let stopped = false; // 失败/中止后停轮（区别于正常完结）
  let aborted = false;
  let system = '';
  try {
    // v7.8.0 修复（计划卡永久卡死）：上下文构建必须在 try 内——它要调 embedding
    // 检索，可能抛错（模型服务未配/网络失败）；此前它在 try 之外，异常会带着
    // executingPlans 里的 msgId 与会话 streaming 态逃逸，此后批准/重试全被去重
    // 挡回、会话永远转圈，只能重启应用。
    try {
      system = (await buildContextPackMd(execution.plan.goal)) + CITATION_RULE;
    } catch (e) {
      store().appendDelta(sessionId, `\n\n[调用异常] ${friendlyProviderError(e)}（计划未开始执行，可修正后重试）`);
      store().finishSession(sessionId, 'idle');
      return;
    }
    for (;;) {
      const exec = useAgentPlansStore.getState().plans[msgId];
      if (!exec) break; // 计划被清理（新会话等）
      const step = exec.plan.steps.find((s) => (exec.statuses[s.id] ?? 'pending') === 'failed')
        ?? exec.plan.steps.find((s) => (exec.statuses[s.id] ?? 'pending') === 'pending');
      if (!step) break; // 全部 done/skipped：正常完结

      useAgentPlansStore.getState().start(msgId, step.id);
      try {
        const acc = await runAgentTurn({
          provider,
          model,
          system,
          history: [],
          user: buildStepPrompt(exec.plan, step, priorOutputsOf(exec.plan, exec.outputs, step.id), exec.statuses),
          tools: real ? ENABLED_TOOLS : [],
          signal: abort.signal,
          // 步骤正文不进会话（落在 PlanCard）；工具调用卡附着在计划消息上
          onToolCall: (call) => store().appendToolCall(sessionId, call),
          onToolResult: (callId, content) => store().appendToolResult(sessionId, callId, content),
        });
        if (abort.signal.aborted) {
          aborted = true;
          useAgentPlansStore.getState().failStep(msgId, step.id, '已中止：用户停止了计划执行');
          stopped = true;
          break;
        }
        const output = acc.trim() || '（本步无文本产出）';
        // 学术诚信护栏：步骤产出里的引用核查（告警并入本步产出，PlanCard 可见）
        const validKeys = [
          ...new Set([
            ...useLibraryStore.getState().papers.map((p) => p.citekey),
            ...bibCitekeys(useWorkspaceStore.getState().files),
          ]),
        ];
        const check = validateCitations(acc, validKeys);
        const finalOutput = check.ok
          ? output
          : `${output}\n\n⚠️ 引用核查：以下引用未在本地文献库或 refs.bib 中找到，请核实：${check.invalid.map((k) => `[${k}]`).join(' ')}`;
        useAgentPlansStore.getState().finishStep(msgId, step.id, finalOutput);
      } catch (e) {
        useAgentPlansStore.getState().failStep(msgId, step.id, e instanceof Error ? e.message : String(e));
        stopped = true;
        break; // 单步失败 → 停轮，用户决定跳过/重试/中止
      }
    }
  } finally {
    executingPlans.delete(msgId);
    if (planAbort === abort) planAbort = null;
    if (chatAbort === abort) chatAbort = null;
    // 会话中止/结束时，未决的阻塞审批按拒绝结算，绝不悬空
    rejectPendingApproval('计划执行已结束或中止，未决修改未生效');
    rejectPendingUserAnswer();
  }

  const exec = useAgentPlansStore.getState().plans[msgId];
  if (stopped) {
    if (aborted) store().appendDelta(sessionId, `\n\n⏹️ 计划已中止：${execution.plan.goal}`);
  } else if (exec) {
    const total = exec.plan.steps.length;
    const skipped = exec.plan.steps.filter((s) => exec.statuses[s.id] === 'skipped').length;
    store().appendDelta(
      sessionId,
      `\n\n✅ 计划完成：${exec.plan.goal}（${total} 步${skipped > 0 ? `，${skipped} 步跳过` : ''}）`,
    );
  }
  store().finishSession(sessionId, 'idle');
}

/**
 * 跳过失败步骤并续跑剩余步骤（PlanCard【跳过失败步】）。
 * stepId 缺省取第一个 failed 步骤；无失败步骤时仅续跑（等同 executePlan）。
 */
export async function skipFailedStep(msgId: string, stepId?: string): Promise<void> {
  const exec = useAgentPlansStore.getState().plans[msgId];
  if (!exec) return;
  const target =
    (stepId && (exec.statuses[stepId] === 'failed' || exec.statuses[stepId] === 'running') ? stepId : null)
    ?? exec.plan.steps.find((s) => exec.statuses[s.id] === 'failed')?.id;
  if (target) useAgentPlansStore.getState().skipStep(msgId, target);
  await executePlan(msgId);
}
