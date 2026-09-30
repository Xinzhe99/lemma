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
} from '@scholarforge/agent-hub';
import type { AgentMessage, ToolCallRequest, ToolDef } from '@scholarforge/shared';
import { buildContextPack, extractGlossary, renderContextPackMd, validateCitations } from '@scholarforge/knowledge';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { bibCitekeys, combinedDoc, outlineAcrossFiles } from './projectDoc';
import { requestToolApproval, type ApprovalFn } from './approval';
import { resolveCompileEntry, runCompile } from './compileAction';
import { applyUnifiedDiff } from './diffApply';
import { findVenueProfile, listVenueNames } from './submission/venues';

/** 本形态已接通的工具名（含写级，写级走人工审批） */
export const ENABLED_TOOL_NAMES = [
  'library.search_fulltext',
  'project.context',
  'tex.last_errors',
  'citation.validate',
  'tex.edit',
  'citation.add',
  'snapshot.create',
  'tex.compile',
  'submission.checklist',
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

/** 组装 Context Pack 并渲染为 prompt-ready markdown（chat / 工具 / 工作流共用） */
export async function buildContextPackMd(query: string): Promise<string> {
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

/** 创建绑定真实应用数据的工具执行器；写级操作经 approval 阻塞等待人工裁决 */
export function createAppToolExecutor(approval: ApprovalFn = requestToolApproval): ToolExecutor {
  return createToolExecutor({
    'library.search_fulltext': async (args) => {
      const query = String(args.query ?? '');
      const k = typeof args.k === 'number' ? args.k : 5;
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
    'project.context': async () => buildContextPackMd(''),
    'tex.last_errors': async () => {
      const log = useWorkspaceStore.getState().compileLog;
      return { lines: log.slice(-20) };
    },
    'citation.validate': async (args) => {
      const keys =
        Array.isArray(args.keys) ? args.keys.map(String) : typeof args.key === 'string' ? [args.key] : [];
      const result = validateCitations(keys.map((k) => `[${k}]`).join(' '), validCitationKeys());
      return { ok: result.ok, invalid: result.invalid };
    },
    'tex.edit': async (args) => {
      const ws = useWorkspaceStore.getState();
      const file = String(args.file ?? ws.activeTab ?? '');
      const before = ws.files[file];
      if (before === undefined) return { applied: false, reason: `文件不存在：${file || '（未指定）'}` };
      let after: string;
      if (typeof args.diff === 'string' && args.diff.trim()) {
        const applied = applyUnifiedDiff(before, args.diff);
        if (!applied.ok) return { applied: false, reason: `diff 应用失败：${applied.error}` };
        after = applied.text;
      } else if (typeof args.content === 'string') {
        after = args.content;
      } else if (typeof args.find === 'string' && args.find) {
        if (!before.includes(args.find)) {
          return { applied: false, reason: 'find 文本在文件中未命中，未做任何修改' };
        }
        after = before.replace(args.find, typeof args.replace === 'string' ? args.replace : '');
      } else {
        return { applied: false, reason: '需要提供 diff、content（整文件替换）或 find/replace（局部替换）之一' };
      }
      if (after === before) return { applied: false, reason: '修改前后内容相同' };

      const decision = await approval({
        file,
        before,
        after,
        kind: 'tool-edit',
        label: 'AI 修改稿件（tex.edit）',
        via: 'agent 工具调用',
      });
      if (!decision.approved) return { applied: false, reason: decision.note };
      ws.snapshotFile(file, 'AI 工具修改前的快照');
      useWorkspaceStore.getState().updateFile(file, after);
      return { applied: true, file, note: decision.note };
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
      if (before === '') useWorkspaceStore.getState().createFile(path, after);
      else useWorkspaceStore.getState().updateFile(path, after);
      return { applied: true, file: path, note: decision.note };
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
  const maxToolRounds = opts.maxToolRounds ?? 3;
  const executor = createAppToolExecutor(opts.approval);

  const messages: AgentMessage[] = [
    { id: 'sys', role: 'system', content: system, createdAt: Date.now() },
    ...history,
    { id: 'user-0', role: 'user', content: user, createdAt: Date.now() + 1 },
  ];

  let finalText = '';
  for (let round = 0; round <= maxToolRounds; round++) {
    let roundText = '';
    const toolCalls: ToolCallRequest[] = [];

    for await (const ev of provider.complete({ messages, model, tools, signal })) {
      if (ev.type === 'text-delta') {
        roundText += ev.delta;
        opts.onDelta?.(ev.delta);
      } else if (ev.type === 'tool-call') {
        toolCalls.push(ev.call);
      } else if (ev.type === 'error') {
        throw new Error(ev.message);
      }
    }

    finalText = roundText || finalText;

    if (toolCalls.length === 0 || round === maxToolRounds) break;

    // 记录 assistant 的工具调用并逐个执行回填
    messages.push({
      id: `assistant-${round}`,
      role: 'assistant',
      content: roundText,
      toolCalls,
      createdAt: Date.now(),
    });
    for (const call of toolCalls) {
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
