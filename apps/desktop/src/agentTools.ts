/**
 * Agent 工具层（宿主侧）：
 * - 只读工具（library.search_fulltext / project.context / tex.last_errors / citation.validate）
 *   直接绑定应用真实数据；
 * - 写级工具（tex.edit / citation.add）经阻塞式人工审批（approval.ts），裁决回传模型；
 * - execute 级（snapshot.create / tex.compile）自动执行（快照是安全网、编译只读反馈）；
 * - runAgentTurn：带工具调用的多轮生成循环（chat 与工作流共用）。
 * 未接通的工具（figure.render / 外发类）执行器返回明确说明，模型可降级处理。
 */

import {
  PAPER_TOOLS,
  checkCall,
  createToolExecutor,
  type ChatProvider,
  type ToolExecutor,
} from '@lemma/agent-hub';
import type { AgentMessage, ToolCallRequest, ToolDef } from '@lemma/shared';
import { buildContextPack, extractGlossary, renderContextPackMd, validateCitations } from '@lemma/knowledge';
import type { GlossaryTerm } from '@lemma/shared';
import { mergeSearchHits, searchArxiv, searchCrossref, type PaperSearchHit } from '@lemma/library';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { buildMemoryInjection, useAgentMemoryStore } from './state/agentMemory';
import { useAgentHubStore } from '@lemma/agent-hub';
import { bibCitekeys, combinedDoc, outlineAcrossFiles } from './projectDoc';
import { requestToolApproval, type ApprovalFn } from './approval';
import { resolveCompileEntry, runCompile } from './compileAction';
import { queueSourceGoto } from './synctexBridge';
import { scheduleAutoCommit } from './git/gitService';
import { withTransientRetry, isTransientError } from './retryPolicy';
import { isRepairableRequestError, sanitizeAgentMessages } from './historyIntegrity';
import { findInstructionsFile, renderInstructionsBlock } from './projectInstructions';
import { requestUserAnswer, type AskOption } from './userAsk';
import { applyUnifiedDiff } from './diffApply';
import { findVenueProfile, listVenueNames } from './submission/venues';

/** 本形态已接通的工具名（含写级，写级走人工审批） */
export const ENABLED_TOOL_NAMES = [
  'library.search_fulltext',
  'paper.read',
  'web.search_scholar',
  'project.context',
  'tex.last_errors',
  'citation.validate',
  'tex.edit',
  'citation.add',
  'snapshot.create',
  'tex.compile',
  'submission.checklist',
  'project.read_file',
  'project.find_in_files',
  'project.list_files',
  'tex.create_file',
  'memory.write',
  'git.log',
  'git.show',
  'user.ask',
] as const;

export const ENABLED_TOOLS: ToolDef[] = PAPER_TOOLS.filter((t) =>
  (ENABLED_TOOL_NAMES as readonly string[]).includes(t.name),
);

/** 权限策略（5.3）：balanced——read 放行、execute 放行、write 走审批、export 拦截 */
const POLICY = { mode: 'balanced' as const, allowExport: false };

function outlineMd(files: Record<string, string>): string {
  return outlineAcrossFiles(files)
    .map(({ file, node }) => `${'  '.repeat(Math.max(0, node.level - 1))}- ${node.title}（${file}）`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Context Pack 缓存（v4.2.0）：outline + glossary 只依赖文件内容，与 query 无关。
// 每条 chat 消息 / 每次 AI 操作都重建一遍是大开销（全文件解析 ×2）；这里按
// 「文件路径 + 内容长度」做廉价签名 memo——文件未变时直接复用，变了才重算。
// 签名含 length：任何编辑几乎必然改变长度，即时失效；同长度异内容的最坏情形
// 只是 glossary 落后一拍，对 AI 上下文无害。
// ---------------------------------------------------------------------------
let packCacheSig = '';
let packCacheOutline = '';
let packCacheGlossary: GlossaryTerm[] = [];

function filesSignature(files: Record<string, string>): string {
  const parts: string[] = [];
  for (const path of Object.keys(files).sort()) parts.push(`${path}:${files[path].length}`);
  return parts.join('|');
}

function outlineAndGlossary(files: Record<string, string>): { outline: string; glossary: GlossaryTerm[] } {
  const sig = filesSignature(files);
  if (sig !== packCacheSig) {
    packCacheSig = sig;
    packCacheOutline = outlineMd(files);
    packCacheGlossary = extractGlossary(combinedDoc(files));
  }
  return { outline: packCacheOutline, glossary: packCacheGlossary };
}

/** 测试辅助：清空 outline/glossary memo */
export function resetContextPackCache(): void {
  packCacheSig = '';
  packCacheOutline = '';
  packCacheGlossary = [];
}

/** 组装 Context Pack 并渲染为 prompt-ready markdown（chat / 工具 / 工作流共用） */
export async function buildContextPackMd(query: string): Promise<string> {
  const files = useWorkspaceStore.getState().files;
  const { outline, glossary } = outlineAndGlossary(files);
  const search = useLibraryStore.getState().searchKnowledge;
  const chunks = await search(query, 5);
  // Agent 记忆注入点：审批历史学到的偏好 + 近期采纳统计（agentMemory store；空记忆时为 ''）
  const memoryInjection = buildMemoryInjection();
  // v7.5.0（FileContext）：项目根 AGENTS.md / LEMMA.md 用户手写约定，注入优先级最高
  const instructionsFile = findInstructionsFile(files);
  const pack = buildContextPack({
    outline,
    glossary,
    relatedChunks: chunks,
    projectMemory: [
      ...(instructionsFile ? [renderInstructionsBlock(files[instructionsFile]!)] : []),
      '演示项目约定：所有 AI 修改须经 diff 审批后落盘，引用必须本地可验证。',
      ...(memoryInjection ? [memoryInjection] : []),
    ],
  });
  return renderContextPackMd(pack);
}

function validCitationKeys(): string[] {
  return [
    ...new Set([
      ...useLibraryStore.getState().papers.map((p) => p.citekey),
      ...bibCitekeys(useWorkspaceStore.getState().files),
    ]),
  ];
}

/** 项目里第一个 .bib（无则 refs.bib） */
function bibTargetPath(): string {
  const files = useWorkspaceStore.getState().files;
  return Object.keys(files).find((p) => p.endsWith('.bib')) ?? 'refs.bib';
}

function bibtexEntryOf(entry: Record<string, unknown>): string {
  const key = String(entry.citekey ?? entry.key ?? 'unnamed').replace(/[^A-Za-z0-9_:-]/g, '');
  const title = String(entry.title ?? 'Untitled');
  const authors = Array.isArray(entry.authors) ? entry.authors.map(String) : entry.author !== undefined ? [String(entry.author)] : [];
  const year = entry.year !== undefined ? Number(entry.year) : undefined;
  const venue = entry.venue !== undefined ? String(entry.venue) : undefined;
  const doi = entry.doi !== undefined ? String(entry.doi) : undefined;
  const lines = [`@misc{${key},`, `  title = {${title}},`];
  if (authors.length > 0) lines.push(`  author = {${authors.join(' and ')}},`);
  if (Number.isFinite(year)) lines.push(`  year = {${year}},`);
  if (venue) lines.push(`  howpublished = {${venue}},`);
  if (doi) lines.push(`  doi = {${doi}},`);
  lines.push('}');
  return lines.join('\n');
}

/** v5.9.0：把产物记入当前激活会话（无激活会话静默跳过；同一文件只留最新） */
function recordSessionArtifact(file: string, kind: 'edit' | 'create'): void {
  const st = useAgentHubStore.getState();
  const sid = st.activeSessionId;
  if (!sid) return;
  st.recordArtifact(sid, file, kind);
}

/** 两文本的首个差异行（1 起）；完全相同返回 null——供 AI 改动后的 PDF 定位 */
export function firstDiffLine(before: string, after: string): number | null {
  if (before === after) return null;
  const a = before.split('\n');
  const b = after.split('\n');
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return i + 1;
  }
  return null;
}

/**
 * diff 的 ---/+++ 文件头是否明确指向了**另一个项目文件**（v7.8.0）。
 * 返回该文件名表示「改错文件」风险，null 表示可安全应用。
 * 判定保守：头缺失、占位名（不在工作区里，如「原始/修改后」）、/dev/null 一律放行；
 * 只要有一个头与目标一致也放行。
 */
export function diffTargetMismatch(
  diff: string,
  target: string,
  files: Record<string, string>,
): string | null {
  const headers: string[] = [];
  for (const raw of diff.split('\n')) {
    const line = raw.trimEnd();
    if (!line.startsWith('---') && !line.startsWith('+++')) continue;
    const name = line
      .slice(3)
      .split('\t')[0]!
      .trim()
      .replace(/^[ab]\//, '')
      .replace(/^\.\//, '');
    if (!name || name === '/dev/null') continue;
    headers.push(name);
  }
  if (headers.length === 0 || headers.includes(target)) return null;
  return headers.find((h) => h in files) ?? null;
}

/** 创建绑定真实应用数据的工具执行器；写级操作经 approval 阻塞等待人工裁决 */
export function createAppToolExecutor(approval: ApprovalFn = requestToolApproval): ToolExecutor {
  return createToolExecutor({
    'library.search_fulltext': async (args) => {
      const query = String(args.query ?? '');
      // v7.8.0：注册表声明的是 `limit`（模型照声明传参），此前只读 `args.k`——
      // 模型传 limit 时被静默忽略、固定返回 5 条。两者都接受，默认 10（与声明一致）。
      const raw = typeof args.limit === 'number' ? args.limit : typeof args.k === 'number' ? args.k : 10;
      const k = Math.max(1, Math.min(Math.trunc(raw), 50));
      const hits = await useLibraryStore.getState().searchKnowledge(query, k);
      return {
        hits: hits.map((h) => ({
          citekey: h.citekey ?? h.paperId,
          heading: h.heading,
          page: h.page,
          snippet: h.text.slice(0, 200),
        })),
      };
    },
    // v4.3.0：AI 读文献——附件 PDF 抽全文（懒加载 reader 子入口，用到才拉 pdfjs），
    // 无附件时题录+摘要兜底。pages 过滤 + 12k 字符截断防上下文爆炸。
    'paper.read': async (args) => {
      const id = String(args.id ?? '').trim();
      const lib = useLibraryStore.getState();
      const paper = lib.papers.find((p) => p.id === id || p.citekey === id);
      if (!paper) {
        return {
          found: false,
          reason: `文献库中未找到 id/citekey 为「${id}」的文献`,
          candidates: lib.papers.slice(0, 10).map((p) => p.citekey),
        };
      }
      const base = {
        found: true,
        citekey: paper.citekey,
        title: paper.title,
        authors: paper.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')).join(' and '),
        year: paper.year,
        venue: paper.venue?.name,
        readStatus: paper.readStatus,
        tags: paper.tags,
      };
      const attachment = lib.pdfAttachments[paper.id];
      if (!attachment) {
        return {
          ...base,
          source: 'abstract',
          abstract: paper.abstract ?? '',
          note: '该文献未附 PDF——仅返回题录与摘要；如需全文分析，请提示用户在文献库 attach PDF 后重试',
        };
      }
      try {
        const { loadPdfText } = await import('@lemma/library/reader');
        const result = await loadPdfText(attachment);
        const wanted = Array.isArray(args.pages)
          ? args.pages.map((p) => Number(p)).filter((n) => Number.isInteger(n) && n >= 1)
          : undefined;
        const pages = wanted && wanted.length > 0
          ? result.pages.filter((p) => wanted.includes(p.page))
          : result.pages;
        const LIMIT = 12000;
        const text = pages
          .map((p) => `【第 ${p.page} 页】\n${p.text}`)
          .join('\n\n');
        return {
          ...base,
          source: 'pdf',
          numPages: result.numPages,
          pages: pages.map((p) => p.page),
          text: text.length > LIMIT ? `${text.slice(0, LIMIT)}\n…（已截断，如需其余部分请指定 pages 分段读取）` : text,
        };
      } catch (e) {
        return {
          ...base,
          source: 'abstract',
          abstract: paper.abstract ?? '',
          note: `PDF 解析失败（${e instanceof Error ? e.message : String(e)}），已回退摘要`,
        };
      }
    },
    // v4.3.0：AI 自主找库外新文献——复用文献库的 arXiv + Crossref 聚合检索
    // （桌面形态无跨域限制；两路任一失败不拖垮另一路）
    'web.search_scholar': async (args) => {
      const query = String(args.query ?? '').trim();
      if (!query) return { ok: false, reason: '缺少检索词（query）' };
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 20) : 10;
      const http = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };
      const [arxiv, crossref] = await Promise.allSettled([
        searchArxiv(query, http, limit),
        searchCrossref(query, http, limit),
      ]);
      const hits: PaperSearchHit[] = [
        ...(arxiv.status === 'fulfilled' ? arxiv.value : []),
        ...(crossref.status === 'fulfilled' ? crossref.value : []),
      ];
      if (hits.length === 0) {
        const failures = [arxiv, crossref].filter((r) => r.status === 'rejected')
          .map((r) => (r as PromiseRejectedResult).reason instanceof Error
            ? (r as PromiseRejectedResult).reason.message
            : String((r as PromiseRejectedResult).reason))
          .join('；');
        return {
          ok: false,
          reason: failures ? `两路检索均无结果或失败：${failures}` : '无结果，建议更换检索词',
        };
      }
      return {
        ok: true,
        query,
        sources: {
          arxiv: arxiv.status === 'fulfilled' ? arxiv.value.length : -1,
          crossref: crossref.status === 'fulfilled' ? crossref.value.length : -1,
        },
        hits: mergeSearchHits(hits)
          .slice(0, limit)
          .map((h) => ({
            title: h.title,
            authors: h.authors.map((a) => [a.given, a.family].filter(Boolean).join(' ')).slice(0, 4).join(', '),
            year: h.year,
            venue: h.venue?.name,
            doi: h.doi,
            arxivId: h.arxivId,
            abstract: (h.abstract ?? '').slice(0, 400),
          })),
        note: '如需入库可调用 citation.add 生成 BibTeX（写级，将走人工审批）',
      };
    },
    'project.context': async () => buildContextPackMd(''),
    'tex.last_errors': async () => {
      const log = useWorkspaceStore.getState().compileLog;
      return { lines: log.slice(-20) };
    },
    'citation.validate': async (args) => {
      // 注册表同时要求 key 与 claim；claim 在本形态无实现（判断「文献是否支撑主张」
      // 需要读全文），此前被静默吞掉、只回 {ok, invalid}——模型易把 ok 误当成
      // 「主张已被文献支撑」（学术诚信风险）。如实标注 claim 未评估。
      const keys =
        Array.isArray(args.keys) ? args.keys.map(String) : typeof args.key === 'string' ? [args.key] : [];
      const valid = validCitationKeys();
      const result = validateCitations(keys.map((k) => `[${k}]`).join(' '), valid);
      // 直连比对兜底：validateCitations 走 markdown 引用正则（键至少 2 字符），
      // 1 字符键或非常规字符键会被当成「文中无引用」→ ok:true 的假通过
      const validSet = new Set(valid);
      const invalid = [...new Set([...result.invalid, ...keys.filter((k) => k.trim() && !validSet.has(k))])];
      return {
        ok: invalid.length === 0,
        invalid,
        usedKeys: result.usedKeys,
        claimChecked: false,
        note: '本工具只核验 bib 键是否存在于本地文献库/refs.bib；「文献是否支撑 claim」未做判断，请阅读全文后再下结论',
      };
    },
    'tex.edit': async (args) => {
      const ws = useWorkspaceStore.getState();
      const file = String(args.file ?? ws.activeTab ?? '');
      const before = ws.files[file];
      if (before === undefined) return { applied: false, reason: `文件不存在：${file || '（未指定）'}` };
      let after: string;
      if (typeof args.diff === 'string' && args.diff.trim()) {
        // v7.8.0 修复（改错文件）：diff 的 ---/+++ 头若明确指向另一个项目文件，
        // 而内容又恰好与该文件某段一致时会静默改到别的文件上——直接拒绝并说明
        const wrongTarget = diffTargetMismatch(args.diff, file, ws.files);
        if (wrongTarget) {
          return {
            applied: false,
            reason: `diff 的文件头指向「${wrongTarget}」，与本次目标文件「${file}」不一致——为避免改错文件已拒绝；请改为「${file}」或在 diff 中省略 ---/+++ 头`,
          };
        }
        const applied = applyUnifiedDiff(before, args.diff);
        if (!applied.ok) return { applied: false, reason: `diff 应用失败：${applied.error}` };
        after = applied.text;
      } else if (typeof args.content === 'string') {
        after = args.content;
      } else if (typeof args.find === 'string' && args.find) {
        if (!before.includes(args.find)) {
          return { applied: false, reason: 'find 文本在文件中未命中，未做任何修改' };
        }
        // v7.8.0 修复：替换值按字面处理——String.replace 的字符串替换会解释
        // $&/$`/$'/$1/$$ 等模式（LaTeX 里 `$$…$$`、`$1` 都可能出现），
        // 此前会把模型给的替换文本静默改写（`$$` 塌缩成 `$`、`` $` `` 注入整段前缀）
        const replacement = typeof args.replace === 'string' ? args.replace : '';
        after = before.replace(args.find, () => replacement);
      } else {
        return { applied: false, reason: '需要提供 diff、content（整文件替换）或 find/replace（局部替换）之一' };
      }
      if (after === before) return { applied: false, reason: '修改前后内容相同' };

      // v7.8.0：注册表声明的 summary（本次修改的一句话说明）此前被静默丢弃——
      // 审批卡标题带上它，用户不必从 diff 猜这次改动的意图
      const summary = typeof args.summary === 'string' ? args.summary.trim() : '';
      const decision = await approval({
        file,
        before,
        after,
        kind: 'tool-edit',
        label: summary ? `AI 修改稿件：${summary.slice(0, 60)}` : 'AI 修改稿件（tex.edit）',
        via: 'agent 工具调用',
      });
      if (!decision.approved) return { applied: false, reason: decision.note };
      // v7.8.0 修复（双重落盘 + 谎报取消）：审批卡采纳时先按用户裁决落盘、再回传 token
      // （AgentPanel onAccept → snapshotFile/updateFile → resolveToolApproval）——v7.0.0 的
      // 陈旧覆盖防护把「已由审批卡落盘」误判成「审批期间被其他修改」，于是模型收到
      // 「已取消——请重试本次编辑」并可能重发同一修改；部分采纳还会被整份提案覆盖。
      // 现在区分：内容已变 = 审批路径已写入（不再二次写入，如实回报）；内容未变 =
      // 由本执行器落盘（保留「审批期间被他人改动则放弃」的语义）。
      const latest = useWorkspaceStore.getState().files[file];
      // 文件在审批期间被删除 / 工作区已切换（审批卡路径写入要求文件存在，missing 必非本流程）
      if (latest === undefined) {
        return { applied: false, reason: '文件在审批期间被删除或工作区已切换，本次修改未应用' };
      }
      const appliedByApproval = latest !== before;
      if (!appliedByApproval) {
        ws.snapshotFile(file, 'AI 工具修改前的快照');
        useWorkspaceStore.getState().updateFile(file, after);
      }
      // v5.0.0 所见即所得：记录首个变更行，编译成功后 PDF 自动滚到该处
      const firstChangedLine = firstDiffLine(before, appliedByApproval ? latest : after);
      if (firstChangedLine !== null) queueSourceGoto(file, firstChangedLine);
      scheduleAutoCommit('修改稿件'); // v5.0.0：AI 改动自动进版本历史
      recordSessionArtifact(file, 'edit'); // v5.9.0：会话产物清单
      return {
        applied: true,
        file,
        // 部分采纳（或其他裁决结果）时当前内容与提案不一致——明确告知，别让模型以为已按提案落盘
        note:
          appliedByApproval && latest !== after
            ? `${decision.note}；注意：当前文件内容是用户裁决后的版本，与本次提案不完全一致，请以 project.read_file 读到的内容为准`
            : decision.note,
      };
    },
    'citation.add': async (args) => {
      const ws = useWorkspaceStore.getState();
      const path = bibTargetPath();
      const before = ws.files[path] ?? '';
      const entrySource =
        args.entry && typeof args.entry === 'object'
          ? (args.entry as Record<string, unknown>)
          : (args as Record<string, unknown>);
      const entry = bibtexEntryOf(entrySource);
      const citekey = String(entrySource.citekey ?? entrySource.key ?? 'unnamed');
      const after = `${before.trimEnd()}${before.trim() ? '\n\n' : ''}${entry}\n`;
      const decision = await approval({
        file: path,
        before,
        after,
        kind: 'add-citation',
        label: `AI 添加引用（${citekey}）`,
        via: 'agent 工具调用',
      });
      if (!decision.approved) return { applied: false, reason: decision.note };
      // v7.8.0 修复（首条引用永不落盘 + 空 bib 假成功）：此前用 `files[path] !== before`
      // 比较，bib 尚不存在时 undefined !== '' 恒成立 → 全新的 refs.bib 被误报
      // 「bib 文件在审批期间发生了其他修改，为避免覆盖已取消」，首条引用永远加不进去；
      // 而空 bib（''）通过该比较后走 createFile——已存在的文件 createFile 不覆盖内容，
      // 于是报 applied:true 却什么都没写。现在按「是否存在」决定 create/update，
      // 与 tex.edit 同口径地识别「审批卡已落盘」。
      const latest = useWorkspaceStore.getState().files[path];
      // 原先有内容的 bib 在审批期间被删除 / 工作区已切换：不凭空重建一份只剩本条目的 bib
      if (latest === undefined && before !== '') {
        return { applied: false, reason: 'bib 文件在审批期间被删除或工作区已切换，本次引用未写入' };
      }
      const appliedByApproval = (latest ?? '') !== before;
      const created = latest === undefined;
      if (!appliedByApproval) {
        if (created) useWorkspaceStore.getState().createFile(path, after);
        else useWorkspaceStore.getState().updateFile(path, after);
      }
      scheduleAutoCommit(`添加引用 ${citekey}`); // v5.0.0：AI 改动自动进版本历史
      // v5.9.0 会话产物清单：新建 refs.bib 记 create，追加条目记 edit（面板区分展示）
      recordSessionArtifact(path, created ? 'create' : 'edit');
      return { applied: true, file: path, note: decision.note };
    },
    // v5.2.0：AI 感知修订历史（Prism 式「在完整上下文含历史修订中工作」）——
    // 只读工具，浏览器/无 git 形态诚实降级
    'git.log': async (args) => {
      const { gitLog, getGitAvailability } = await import('./git/gitService');
      if (getGitAvailability() !== 'ok') {
        return { ok: false, reason: '内置 git 不可用（需桌面形态 + 系统 git）' };
      }
      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 50) : 20;
      const commits = await gitLog(limit);
      return { ok: true, count: commits.length, commits };
    },
    'git.show': async (args) => {
      const hash = String(args.hash ?? '').trim();
      if (!hash) return { ok: false, reason: '缺少 hash（可先调 git.log）' };
      const { getGitAvailability, ensureGitRepo } = await import('./git/gitService');
      if (getGitAvailability() !== 'ok') {
        return { ok: false, reason: '内置 git 不可用（需桌面形态 + 系统 git）' };
      }
      if (!(await ensureGitRepo())) return { ok: false, reason: 'git 仓库初始化失败' };
      const { tauriProcRun } = await import('./platform/tauri');
      const stat = await tauriProcRun('git', ['show', '--stat', '--format=%h %ad %s', '--date=iso-strict', hash]);
      if (stat.code !== 0) {
        return { ok: false, reason: `git show 失败：${(stat.stderr || stat.stdout).trim().slice(0, 160)}` };
      }
      const patch = await tauriProcRun('git', ['show', '--format=', hash]);
      const full = patch.stdout;
      const LIMIT = 6000;
      return {
        ok: true,
        stat: stat.stdout.slice(0, 2000),
        diff: full.length > LIMIT ? `${full.slice(0, LIMIT)}\n…（已截断）` : full,
      };
    },
    // v4.4.0：AI 自主记忆——把项目约定/审稿结论/用户偏好写入 agent-memory，
    // 经 buildMemoryInjection 注入此后每次生成的 Context Pack。写级：走 diff
    // 审批卡（伪文件「项目记忆」，diff 即新增行），用户可见可拒。
    'memory.write': async (args) => {
      const key = String(args.key ?? '').trim();
      const value = String(args.value ?? '').trim();
      if (!key || !value) return { written: false, reason: 'key 与 value 均不能为空' };
      const mem = useAgentMemoryStore.getState();
      const note = `【${key}】${value}`;
      const before = mem.styleNotes.length > 0 ? mem.styleNotes.join('\n') : '（项目记忆为空）';
      const after = [...mem.styleNotes, note].join('\n');
      const decision = await approval({
        file: '项目记忆（agent-memory）',
        before,
        after,
        kind: 'tool-edit',
        label: `AI 写入项目记忆（${key}）`,
        via: 'agent 工具调用',
      });
      if (!decision.approved) return { written: false, reason: decision.note };
      mem.addStyleNote(note);
      return { written: true, key, note: '已写入，将注入后续所有会话的上下文' };
    },
    'snapshot.create': async (args) => {
      const ws = useWorkspaceStore.getState();
      const file = typeof args.file === 'string' && args.file ? args.file : (ws.activeTab ?? resolveCompileEntry() ?? '');
      if (!file || ws.files[file] === undefined) return { created: false, reason: '未指定或文件不存在' };
      ws.snapshotFile(file, typeof args.label === 'string' && args.label ? args.label : 'agent 快照');
      return { created: true, file };
    },
    'tex.compile': async () => {
      const result = await runCompile();
      return {
        success: result.ok,
        entry: result.entry,
        passes: result.passes,
        diagnostics: result.diagnostics,
        note: '桌面形态为真实编译（tectonic/latexmk），成功后自动打开 PDF 预览',
      };
    },
    'submission.checklist': async (args) => {
      // 注册表参数名为 journal；兼容 venue（WF-1 契约定为按 venue 匹配，两者取一即可）
      const query =
        typeof args.journal === 'string' && args.journal.trim()
          ? args.journal
          : typeof args.venue === 'string'
            ? args.venue
            : '';
      if (!query.trim()) {
        return {
          matched: false,
          query,
          candidates: listVenueNames(),
          note: '未提供期刊/会议名称（journal）；candidates 为内置投稿档案列表，可换用其中名称后重试',
        };
      }
      const venue = findVenueProfile(query);
      if (!venue) {
        return {
          matched: false,
          query,
          candidates: listVenueNames(),
          note: `未匹配到「${query}」的投稿档案；candidates 为内置档案列表，可换用其中名称后重试`,
        };
      }
      return { matched: true, query, venue };
    },
    // —— v3.7.0：Cursor 级 AI 工具（读文件/搜索/列表/创建） ——
    'project.read_file': async (args) => {
      const path = String(args.path ?? '').trim();
      const ws = useWorkspaceStore.getState();
      const content = ws.files[path];
      if (content === undefined) {
        return { error: `文件不存在：${path}`, available: Object.keys(ws.files) };
      }
      const lines = content.split('\n');
      return {
        path,
        totalLines: lines.length,
        content: lines.length > 200 ? lines.slice(0, 200).join('\n') + '\n...(截断，共 ' + lines.length + ' 行)' : content,
      };
    },
    'project.find_in_files': async (args) => {
      const query = String(args.query ?? '').trim();
      if (!query) return { error: '未提供搜索文本' };
      const files = useWorkspaceStore.getState().files;
      const LIMIT = 50;
      const hits: { file: string; line: number; text: string }[] = [];
      // v7.8.0：命中上限此前静默生效（totalHits 恒等于已返回条数）——模型会把
      // 「50 条」当成全部命中，据此判断「没有别处引用」。达上限即停并显式标注截断
      let truncated = false;
      for (const [path, content] of Object.entries(files)) {
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (!(lines[i] ?? '').includes(query)) continue;
          if (hits.length >= LIMIT) {
            truncated = true;
            break;
          }
          hits.push({ file: path, line: i + 1, text: (lines[i] ?? '').trim().slice(0, 120) });
        }
        if (truncated) break;
      }
      return {
        query,
        totalHits: hits.length,
        truncated,
        ...(truncated ? { note: `命中过多，仅返回前 ${LIMIT} 条（可能还有更多），如需完整清单请缩小搜索范围` } : {}),
        hits,
      };
    },
    'project.list_files': async () => {
      const files = useWorkspaceStore.getState().files;
      const list = Object.entries(files).map(([path, content]) => ({
        path,
        lines: content.split('\n').length,
        type: path.endsWith('.tex') ? 'tex' : path.endsWith('.bib') ? 'bib' : 'other',
      }));
      return { total: list.length, files: list };
    },
    'tex.create_file': async (args) => {
      const path = String(args.path ?? '').trim();
      const content = String(args.content ?? '');
      if (!path || !content.trim()) return { created: false, reason: '需要 path 和 content' };
      const ws = useWorkspaceStore.getState();
      if (ws.files[path] !== undefined) return { created: false, reason: `文件已存在：${path}（用 tex.edit 修改）` };
      const decision = await approval({
        file: path,
        before: '',
        after: content,
        kind: 'tool-edit',
        label: `AI 创建文件（${path}）`,
        via: 'agent 工具调用',
      });
      if (!decision.approved) return { created: false, reason: decision.note };
      // v7.8.0：审批期间同名文件可能已被创建（用户手动新建/其他会话写入）——
      // createFile 对已存在的路径不覆盖内容，此前会谎报 created:true 而实际什么都没写
      if (useWorkspaceStore.getState().files[path] !== undefined) {
        return { created: false, reason: `文件在审批期间已存在：${path}（未覆盖，请改用 tex.edit 修改）` };
      }
      ws.createFile(path, content);
      recordSessionArtifact(path, 'create'); // v5.9.0：会话产物清单（新建同步登记）
      return { created: true, path, note: decision.note };
    },
    // v7.5.0（UserInteraction）：选项式提问卡阻塞等待用户拍板，答案回传模型。
    // 与审批同模式：会话中止时由 rejectPendingUserAnswer 自动结算为「未作答」。
    'user.ask': async (args) => {
      const question = String(args.question ?? '').trim();
      if (!question) return { answered: false, reason: '缺少 question' };
      const options: AskOption[] = (Array.isArray(args.options) ? args.options : [])
        .map((o) =>
          typeof o === 'string'
            ? { label: o.trim() }
            : {
                label: String((o as Record<string, unknown>)?.label ?? '').trim(),
                description: String((o as Record<string, unknown>)?.description ?? '').trim() || undefined,
              },
        )
        .filter((o) => o.label.length > 0)
        .slice(0, 4);
      const allowCustom = args.allowCustom !== false;
      // 选项全空且不许自由输入 = 无法作答，给最简单的二选一兜底
      const finalOptions = options.length > 0 ? options : allowCustom ? [] : [{ label: '继续' }, { label: '停止' }];
      const answer = await requestUserAnswer(question, finalOptions, allowCustom);
      if (answer === null) return { answered: false, reason: '用户未作答（会话已中止或被新提问取代）——请基于现状自主决策并说明' };
      return { answered: true, answer };
    },
  });
}

export interface AgentTurnEventHandlers {
  onDelta?: (text: string) => void;
  onToolCall?: (call: ToolCallRequest) => void;
  onToolResult?: (callId: string, content: string) => void;
}

export interface AgentTurnOptions extends AgentTurnEventHandlers {
  provider: ChatProvider;
  model: string;
  system: string;
  history: AgentMessage[];
  user: string;
  /** 传空数组则不带工具（纯文本生成） */
  tools?: ToolDef[];
  signal?: AbortSignal;
  /** 最多几轮工具调用（防失控） */
  maxToolRounds?: number;
  /** v6.4.0：随首条 user 消息附图（dataUrl；provider 组装多模态 content） */
  userImages?: string[];
  /** v7.5.0：会话亲和缓存键（prompt_cache_key），同会话保持不变以提升前缀缓存命中 */
  cacheKey?: string;
  /** 写级操作的审批函数（测试可注入） */
  approval?: ApprovalFn;
}

/**
 * 带工具调用的多轮生成：文本流式回调；模型发起 tool-call 时先过权限门
 * （export 级拦截），再执行（写级在执行器内阻塞等待人工审批）、回填 role=tool
 * 消息并继续生成，直到模型给出最终文本或达到轮次上限。返回最终文本。
 */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<string> {
  const { provider, model, system, history, user, signal } = opts;
  const tools = opts.tools ?? [];
  const maxToolRounds = opts.maxToolRounds ?? 50;
  const executor = createAppToolExecutor(opts.approval);

  // v7.4.0：瞬态重试计数（跨轮保持——连续失败共享预算）
  let transientRetryCount = 0;
  const MAX_TRANSIENT_RETRIES = 3;
  // v7.5.0：一次性历史自愈（SelfHealing）——400 类协议错误时清理消息序列后重试一次
  let selfHealed = false;

  const messages: AgentMessage[] = [
    { id: 'sys', role: 'system', content: system, createdAt: Date.now() },
    ...history,
    {
      id: 'user-0',
      role: 'user',
      content: user,
      // v6.4.0：随消息附图（provider 组装多模态 content；仅本轮请求携带）
      ...(opts.userImages && opts.userImages.length > 0 ? { images: opts.userImages } : {}),
      createdAt: Date.now() + 1,
    },
  ];

  let finalText = '';
  for (let round = 0; round <= maxToolRounds; round++) {
    let roundText = '';
    const toolCalls: ToolCallRequest[] = [];

    // v7.0.0 修复：用户点停止后仍执行工具（含写级审批）——循环每轮先检查中止
    if (signal?.aborted) {
      return finalText || '（已停止）';
    }
    // v7.4.0 A：瞬态错误自动重试（1s→2s→4s 退避，最多 3 次；永久错误不重试）
    // 流式 iterator 不可直接 retry（部分 delta 已消费），改为整轮 provider.complete 重试
    let streamError: Error | null = null;
    if (transientRetryCount < MAX_TRANSIENT_RETRIES) {
      try {
        for await (const ev of provider.complete({ messages, model, tools, signal, cacheKey: opts.cacheKey })) {
          if (ev.type === 'text-delta') {
            roundText += ev.delta;
            opts.onDelta?.(ev.delta);
          } else if (ev.type === 'tool-call') {
            toolCalls.push(ev.call);
          } else if (ev.type === 'error') {
            throw new Error(ev.message);
          }
        }
        streamError = null;
      } catch (e) {
        if (signal?.aborted) throw e;
        if (isTransientError(e) && transientRetryCount < MAX_TRANSIENT_RETRIES) {
          transientRetryCount++;
          const delay = Math.min(1000 * Math.pow(2, transientRetryCount - 1), 8000);
          roundText = ''; // 丢弃部分 delta，整轮重试
          toolCalls.length = 0;
          await new Promise<void>((r) => setTimeout(r, delay));
          round--; // 重试本轮（外层 for 会 round++）
          continue; // 跳过本轮后续（工具执行等）
        }
        // v7.5.0（SelfHealing）：400 类协议错误 → 清理消息序列（孤儿 tool 消息/
        // 重复结果/悬空 tool_calls）后原轮重试一次；修不动则透传原错误
        if (!selfHealed && isRepairableRequestError(e)) {
          const repaired = sanitizeAgentMessages(messages);
          const changed =
            repaired.length !== messages.length || repaired.some((m, i) => m !== messages[i]);
          if (changed) {
            selfHealed = true;
            messages.length = 0;
            messages.push(...repaired);
            roundText = '';
            toolCalls.length = 0;
            round--; // 重试本轮
            continue;
          }
        }
        streamError = e instanceof Error ? e : new Error(String(e));
      }
    } else {
      // 重试预算已耗尽：直接消费流（错误自然抛出）
      for await (const ev of provider.complete({ messages, model, tools, signal, cacheKey: opts.cacheKey })) {
        if (ev.type === 'text-delta') {
          roundText += ev.delta;
          opts.onDelta?.(ev.delta);
        } else if (ev.type === 'tool-call') {
          toolCalls.push(ev.call);
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }
    }
    if (streamError) {
      // v7.4.0 B：工具调用中断恢复——仅在本轮已有工具调用时注入恢复说明
      // （模型可能已看到部分工具执行，重启后需检查状态再决策）；纯模型失败透传原始错误
      if (streamError instanceof Error && signal?.aborted !== true && messages.some((m) => m.role === 'tool')) {
        throw new Error(
          `模型请求中断（${streamError.message}）。已执行的工具可能已部分或全部完成，请检查当前文件状态后再决定是否重试。`,
        );
      }
      throw streamError;
    }

    finalText = roundText || finalText;

    if (toolCalls.length === 0) break;
    if (round === maxToolRounds) {
      // v6.2.0：轮次用尽的诚实收尾——不再静默丢弃待执行的工具调用；
      // 给用户明确说明 + 让最后一段文本可见（此前工具轮的空回复会让用户一脸茫然）
      if (!finalText.trim()) {
        finalText = '（本轮工具调用次数已达上限，任务未完全收尾）';
      }
      finalText += `

---
⚠️ 已连续调用 ${maxToolRounds} 轮工具仍未收尾（安全上限）。可以发送「继续」让我接着做，或告诉我调整目标。`;
      break;
    }

    // 记录 assistant 的工具调用并逐个执行回填
    messages.push({
      id: `assistant-${round}`,
      role: 'assistant',
      content: roundText,
      toolCalls,
      createdAt: Date.now(),
    });
    for (const call of toolCalls) {
      if (signal?.aborted) {
        // v7.0.0：中止后不再执行剩余工具，回填说明后退出
        messages.push({
          id: `tool-${call.id}`,
          role: 'tool',
          toolCallId: call.id,
          content: JSON.stringify({ error: '用户已停止生成' }),
          createdAt: Date.now(),
        });
        continue;
      }
      opts.onToolCall?.(call);
      let output: unknown;
      const gate = checkCall(call.tool, POLICY);
      if (gate.decision === 'blocked') {
        output = { error: `权限拦截：${gate.reason}` };
      } else {
        try {
          output = await executor.execute(call);
        } catch (e) {
          output = { error: e instanceof Error ? e.message : String(e) };
        }
      }
      const content = JSON.stringify(output);
      opts.onToolResult?.(call.id, content);
      messages.push({
        id: `tool-${call.id}`,
        role: 'tool',
        toolCallId: call.id,
        content,
        createdAt: Date.now(),
      });
    }
  }

  return finalText;
}
