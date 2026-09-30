/**
 * Agent 工具层（宿主侧）：
 * - 把论文域只读工具（library.search_fulltext / project.context / tex.last_errors / citation.validate）
 *   绑定到应用真实数据；
 * - runAgentTurn：带工具调用的多轮生成循环（chat 与工作流共用）。
 * 写级工具（tex.edit 等）在浏览器形态暂未接通，执行器会返回明确说明让模型降级处理。
 */

import {
  PAPER_TOOLS,
  createToolExecutor,
  type ChatProvider,
  type ToolExecutor,
} from '@scholarforge/agent-hub';
import type { AgentMessage, ToolCallRequest, ToolDef } from '@scholarforge/shared';
import { buildContextPack, extractGlossary, renderContextPackMd, validateCitations } from '@scholarforge/knowledge';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { bibCitekeys, combinedDoc, outlineAcrossFiles } from './projectDoc';

/** 本形态已接通的只读工具名 */
export const ENABLED_TOOL_NAMES = [
  'library.search_fulltext',
  'project.context',
  'tex.last_errors',
  'citation.validate',
] as const;

export const ENABLED_TOOLS: ToolDef[] = PAPER_TOOLS.filter((t) =>
  (ENABLED_TOOL_NAMES as readonly string[]).includes(t.name),
);

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

/** 创建绑定真实应用数据的工具执行器 */
export function createAppToolExecutor(): ToolExecutor {
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
      const keys = Array.isArray(args.keys) ? args.keys.map(String) : [];
      const result = validateCitations(keys.map((k) => `[${k}]`).join(' '), validCitationKeys());
      return { ok: result.ok, invalid: result.invalid };
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
}

/**
 * 带工具调用的多轮生成：文本流式回调；模型发起 tool-call 时执行、回填 role=tool
 * 消息并继续生成，直到模型给出最终文本或达到轮次上限。返回最终文本。
 */
export async function runAgentTurn(opts: AgentTurnOptions): Promise<string> {
  const { provider, model, system, history, user, signal } = opts;
  const tools = opts.tools ?? [];
  const maxToolRounds = opts.maxToolRounds ?? 3;
  const executor = createAppToolExecutor();

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
      try {
        output = await executor.execute(call);
      } catch (e) {
        output = { error: e instanceof Error ? e.message : String(e) };
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
