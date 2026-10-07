/**
 * OpenAI 兼容 API 适配器：DeepSeek / GLM / Kimi / Qwen / OpenAI 等共用
 * {baseUrl}/chat/completions + SSE 流式协议。fetch 由宿主注入，便于测试与代理配置。
 */
import type { AgentMessage, ToolCallRequest, ToolDef } from '@lemma/shared';
import type { ChatEvent, ChatProvider, ChatRequest, ChatUsage } from './types';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface OpenAICompatibleProviderOptions {
  id: string;
  label: string;
  /** 如 https://api.deepseek.com/v1（不带尾部斜杠） */
  baseUrl: string;
  apiKey: string;
  fetchFn: FetchLike;
}

/** SSE 事件分片（可能有半个 JSON 跨 chunk），返回已完整的事件负载与剩余缓冲 */
export function parseSseChunk(buffer: string): { events: unknown[]; rest: string } {
  const events: unknown[] = [];
  // 事件以空行分隔；兼容 \n 与 \r\n
  const parts = buffer.split(/\r?\n\r?\n/);
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const dataLines: string[] = [];
    for (const line of part.split(/\r?\n/)) {
      if (line.startsWith(':')) continue; // SSE 注释/心跳
      if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
    if (dataLines.length === 0) continue;
    const payload = dataLines.join('\n');
    if (payload === '[DONE]') {
      events.push('[DONE]');
      continue;
    }
    try {
      events.push(JSON.parse(payload));
    } catch {
      events.push(payload); // 宽容：无法解析时原样透传，由消费者忽略
    }
  }
  return { events, rest };
}

interface ToolCallAcc {
  index: number;
  id: string;
  name: string;
  arguments: string;
}

/** tool_calls 增量分片合并：id 取首个非空；name 分片拼接（重复全名时跳过）；arguments 纯拼接 */
function mergeToolCallDelta(acc: ToolCallAcc, fragment: Record<string, unknown>): void {
  const fragId = typeof fragment.id === 'string' ? fragment.id : '';
  if (fragId && !acc.id) acc.id = fragId;
  const fn = fragment.function as Record<string, unknown> | undefined;
  const fragName = typeof fn?.name === 'string' ? fn.name : '';
  if (fragName) {
    if (!acc.name) acc.name = fragName;
    else if (fragName !== acc.name) acc.name += fragName; // 名字被拆成多片时拼接，整名重复时忽略
  }
  const fragArgs = typeof fn?.arguments === 'string' ? fn.arguments : '';
  if (fragArgs) acc.arguments += fragArgs;
}

/** 工具调用兜底 id 的全局序号（兼容不回传 id 的网关，跨轮唯一） */
let callSeq = 0;

// ---------------------------------------------------------------------------
// v7.6.0 修复：DeepSeek 等网关要求 function.name 匹配 ^[a-zA-Z0-9_-]+$，
// 本域工具名带点（tex.edit / paper.read）会直接 400 拒绝。派发前把点改写为
// 下划线，收到 tool-call 时按派发表映射回真实工具名；无派发表（模型自造名）
// 原样透传由执行器报「未知工具」。
// ---------------------------------------------------------------------------
export function toWireToolName(name: string): string {
  return name.replace(/\./g, '_');
}

function buildWireToolMap(tools: ToolDef[] | undefined): Map<string, string> {
  const map = new Map<string, string>();
  for (const t of tools ?? []) {
    const wire = toWireToolName(t.name);
    // 派发冲突（如同时存在 a.b 与 a_b）时不映射该名，双方原样传输
    if (map.has(wire) && map.get(wire) !== t.name) map.delete(wire);
    else map.set(wire, t.name);
  }
  return map;
}

function toRequestMessages(messages: AgentMessage[], wireNames: Map<string, string>): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content };
    }
    // v6.4.0 对话贴图：带 images 的消息组装 OpenAI 多模态 content（text + image_url）
    const content =
      m.images && m.images.length > 0
        ? [
            { type: 'text', text: m.content },
            ...m.images.map((url) => ({ type: 'image_url', image_url: { url } })),
          ]
        : m.content;
    const out: Record<string, unknown> = { role: m.role, content };
    if (m.toolCalls?.length) {
      out.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: wireNames.get(tc.tool) ?? toWireToolName(tc.tool), arguments: JSON.stringify(tc.args) },
      }));
    }
    return out;
  });
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string;
  readonly label: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchFn: FetchLike;

  constructor(opts: OpenAICompatibleProviderOptions) {
    this.id = opts.id;
    this.label = opts.label;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetchFn;
  }

  async *complete(req: ChatRequest): AsyncGenerator<ChatEvent> {
    // 线上工具名（点→下划线）→ 真实工具名 的派发表（见 toWireToolName 注释）
    const wireNames = buildWireToolMap(req.tools);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toRequestMessages(req.messages, wireNames),
      stream: true,
      stream_options: { include_usage: true },
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: toWireToolName(t.name), description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = 'auto';
    }
    if (req.cacheKey) body.prompt_cache_key = req.cacheKey; // v7.5.0：会话亲和（不识别的网关会忽略）
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;

    let res: Response;
    try {
      res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
    } catch (e) {
      // v7.0.0 修复：用户中止与网络错误不可区分地包装成 error——中止应与流阶段一致
      // 地正常收尾，否则宿主误报「网络问题」
      if (req.signal?.aborted) {
        return; // 正常结束（done）；已拼装的 toolCalls 由 finally 的 flushToolCalls 冲刷
      }
      yield { type: 'error', message: `请求失败：${errMsg(e)}` };
      return;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      yield {
        type: 'error',
        message: `接口返回 ${res.status}${text ? `：${text.slice(0, 400)}` : ''}`,
      };
      return;
    }

    const toolAcc = new Map<number, ToolCallAcc>();
    let usage: ChatUsage | undefined;
    let toolsFlushed = false;

    /**
     * 单帧处理：覆盖 usage、合并 tool_calls 分片，返回该帧的正文增量（无正文返回空串）。
     * v7.8.0 修复：尾帧（流结束时未以空行终止的最后一帧）此前只取 usage，
     * 正文与工具分片被静默丢弃——末段文字消失。
     */
    const consumeChunk = (chunk: Record<string, any>): string => {
      const u = chunk.usage;
      if (u && typeof u === 'object') {
        usage = {
          inputTokens: numberOrUndefined(u.prompt_tokens ?? u.input_tokens),
          outputTokens: numberOrUndefined(u.completion_tokens ?? u.output_tokens),
        };
      }
      const choice = chunk.choices?.[0];
      if (!choice) return '';
      const delta = choice.delta ?? {};
      for (const fragment of delta.tool_calls ?? []) {
        const index = typeof fragment.index === 'number' ? fragment.index : 0;
        let acc = toolAcc.get(index);
        if (!acc) {
          acc = { index, id: '', name: '', arguments: '' };
          toolAcc.set(index, acc);
        }
        mergeToolCallDelta(acc, fragment);
      }
      return typeof delta.content === 'string' ? delta.content : '';
    };

    const flushToolCalls = (): ChatEvent[] => {
      if (toolsFlushed || toolAcc.size === 0) return [];
      toolsFlushed = true;
      return [...toolAcc.values()]
        .sort((a, b) => a.index - b.index)
        .map((acc) => {
          let args: Record<string, unknown> = {};
          try {
            args = acc.arguments ? JSON.parse(acc.arguments) : {};
          } catch {
            // v7.0.0 修复：非空却解析失败 = max_tokens 截断——此前静默降级 {} 执行，
            // 工具带空参数跑偏且模型收到误导性「参数缺失」。显式报错让模型知道根因
            if (acc.arguments.trim().length > 0) {
              throw new Error(
                `工具 ${acc.name} 的参数 JSON 不完整（疑似被 max_tokens 截断）——请减小参数体积或分步执行后重试`,
              );
            }
            args = {};
          }
          return {
            type: 'tool-call',
            // v7.0.0 修复：兜底 id 加全局序号——跨轮重复 id 会让工具卡结果张冠李戴
            // v7.6.0：线上名（下划线）映射回真实工具名（点号）
            call: { id: acc.id || `call_${++callSeq}`, tool: wireNames.get(acc.name) ?? acc.name, args },
          } satisfies ChatEvent;
        });
    };

    let buffer = '';
    const decoder = new TextDecoder();
    const reader = res.body?.getReader();

    if (!reader) {
      yield { type: 'error', message: '响应缺少可读流' };
      return;
    }

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const ev of parsed.events) {
          if (ev === '[DONE]') continue; // 统一在流结束后收尾
          if (typeof ev !== 'object' || ev === null) continue;
          const chunk = ev as Record<string, any>;
          const text = consumeChunk(chunk);
          if (text) {
            yield { type: 'text-delta', delta: text };
          }
          // finish_reason 到达即按序发出已拼装完成的工具调用
          if (chunk.choices?.[0]?.finish_reason) {
            for (const ev2 of flushToolCalls()) yield ev2;
          }
        }
      }
      // 流结束：冲刷未终止的尾帧（正文/工具调用/usage 一并收尾）与漏发的工具调用
      const tail = parseSseChunk(buffer + '\n\n');
      for (const ev of tail.events) {
        if (ev === '[DONE]' || typeof ev !== 'object' || ev === null) continue;
        const text = consumeChunk(ev as Record<string, any>);
        if (text) {
          yield { type: 'text-delta', delta: text };
        }
      }
      for (const ev2 of flushToolCalls()) yield ev2;
      yield { type: 'done', usage };
    } catch (e) {
      if (req.signal?.aborted) {
        yield { type: 'done', usage };
      } else {
        yield { type: 'error', message: `流读取失败：${errMsg(e)}` };
      }
    }
  }
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
