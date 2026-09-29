import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '@scholarforge/shared';
import { OpenAICompatibleProvider, parseSseChunk } from './openaiCompat';
import type { FetchLike } from './openaiCompat';
import type { ChatEvent, ChatRequest } from './types';

function msg(role: AgentMessage['role'], content: string): AgentMessage {
  return { id: `${role}-1`, role, content, createdAt: 0 };
}

function sseResponse(payload: string | string[], status = 200): Response {
  // 传入字符串时按 9 字节任意切块，模拟分片边界（半个 JSON 跨 chunk）
  const chunks =
    typeof payload === 'string' ? payload.match(/[\s\S]{1,9}/g) ?? [] : payload;
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, statusText: status === 200 ? 'OK' : 'Error' });
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

async function collect(req: ChatRequest, provider: OpenAICompatibleProvider): Promise<ChatEvent[]> {
  const events: ChatEvent[] = [];
  for await (const ev of provider.complete(req)) events.push(ev);
  return events;
}

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [msg('user', '你好')],
  model: 'deepseek-chat',
  ...over,
});

describe('parseSseChunk', () => {
  it('解析完整事件、[DONE] 与注释行', () => {
    const { events, rest } = parseSseChunk(': ping\n\ndata: {"a":1}\n\ndata: [DONE]\n\n');
    expect(events).toEqual([{ a: 1 }, '[DONE]']);
    expect(rest).toBe('');
  });

  it('半个 JSON 跨 chunk 时留在 rest', () => {
    const { events, rest } = parseSseChunk('data: {"choices":[{"delta":{"con');
    expect(events).toEqual([]);
    expect(rest).toBe('data: {"choices":[{"delta":{"con');
    const next = parseSseChunk(rest + 'tent":"你"}}]}\n\n');
    expect(next.events).toEqual([{ choices: [{ delta: { content: '你' } }] }]);
  });

  it('多行 data 拼接为一个 JSON', () => {
    const { events } = parseSseChunk('data: {"a":\ndata: 1}\n\n');
    expect(events).toEqual([{ a: 1 }]);
  });

  it('兼容 \\r\\n 行尾', () => {
    const { events } = parseSseChunk('data: {"a":1}\r\n\r\n');
    expect(events).toEqual([{ a: 1 }]);
  });
});

describe('OpenAICompatibleProvider', () => {
  it('文本流式输出 + [DONE] 收尾 + 请求体映射', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const fetchFn: FetchLike = async (u, i) => {
      url = u;
      init = i;
      return sseResponse(
        [
          sse({ choices: [{ delta: { content: '你' } }] }),
          sse({ choices: [{ delta: { content: '好' } }] }),
          'data: [DONE]\n\n',
        ].join(''), // sseResponse 内部任意切块，模拟分片边界
      );
    };
    const provider = new OpenAICompatibleProvider({
      id: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1/',
      apiKey: 'sk-test',
      fetchFn,
    });
    const events = await collect(
      req({
        messages: [msg('system', '你是助手'), msg('user', '你好'), { ...msg('tool', '{"n":1}', ), id: 't1', toolCallId: 'call_9' }],
        tools: [
          {
            name: 'library.search',
            description: '检索',
            permission: 'read',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
        ],
      }),
      provider,
    );

    expect(url).toBe('https://api.deepseek.com/v1/chat/completions');
    const body = JSON.parse(String(init?.body));
    expect(body.stream).toBe(true);
    expect(body.model).toBe('deepseek-chat');
    expect(body.messages).toEqual([
      { role: 'system', content: '你是助手' },
      { role: 'user', content: '你好' },
      { role: 'tool', tool_call_id: 'call_9', content: '{"n":1}' },
    ]);
    expect(body.tools[0].function.name).toBe('library.search');
    expect(body.tools[0].function.parameters.required).toEqual(['query']);

    expect(events.filter((e) => e.type === 'text-delta').map((e) => (e as any).delta).join('')).toBe('你好');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('tool_calls 增量拼装（id/name/arguments 分片合并）与 usage 提取', async () => {
    const fetchFn: FetchLike = async () =>
      sseResponse([
        sse({
          choices: [
            { delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'library.se', arguments: '{"query":' } }] } },
          ],
        }),
        sse({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'arch', arguments: '"diffusion"}' } }] } },
          ],
        }),
        // 整名重复的宽容场景：不重复拼接
        sse({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { name: 'library.search', arguments: '' } }] } },
          ],
        }),
        sse({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 8 } }),
        'data: [DONE]\n\n',
      ].join(''));

    const provider = new OpenAICompatibleProvider({
      id: 'glm',
      label: 'GLM',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: 'k',
      fetchFn,
    });
    const events = await collect(req(), provider);

    const toolCalls = events.filter((e) => e.type === 'tool-call');
    expect(toolCalls).toHaveLength(1);
    expect((toolCalls[0] as any).call).toEqual({
      id: 'call_1',
      tool: 'library.search',
      args: { query: 'diffusion' },
    });
    const done = events.at(-1);
    expect(done).toMatchObject({ type: 'done', usage: { inputTokens: 12, outputTokens: 8 } });
  });

  it('finish_reason 缺失时在流结束兜底冲刷工具调用', async () => {
    const fetchFn: FetchLike = async () =>
      sseResponse([
        sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c2', function: { name: 'tex.compile', arguments: '{}' } }] } }] }),
        'data: [DONE]\n\n',
      ].join(''));
    const provider = new OpenAICompatibleProvider({
      id: 'kimi', label: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: 'k', fetchFn,
    });
    const events = await collect(req(), provider);
    expect(events).toHaveLength(2);
    expect((events[0] as any).call.tool).toBe('tex.compile');
    expect(events[1].type).toBe('done');
  });

  it('HTTP 非 2xx 转为 error 事件', async () => {
    const fetchFn: FetchLike = async () => new Response('unauthorized', { status: 401 });
    const provider = new OpenAICompatibleProvider({
      id: 'x', label: 'x', baseUrl: 'https://x.example/v1', apiKey: 'k', fetchFn,
    });
    const events = await collect(req(), provider);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as any).message).toContain('401');
  });

  it('网络异常转为 error 事件', async () => {
    const fetchFn: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const provider = new OpenAICompatibleProvider({
      id: 'x', label: 'x', baseUrl: 'https://x.example/v1', apiKey: 'k', fetchFn,
    });
    const events = await collect(req(), provider);
    expect(events[0]).toMatchObject({ type: 'error' });
    expect((events[0] as any).message).toContain('ECONNREFUSED');
  });
});
