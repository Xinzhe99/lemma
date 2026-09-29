import { describe, expect, it } from 'vitest';
import { buildPrompt, CliProvider, EchoProvider, extractJsonlEvents, extractUsage, MockProcessRunner } from './cli';
import type { ChatRequest } from './types';

const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [
    { id: 's1', role: 'system', content: '你是论文助手', createdAt: 0 },
    { id: 'u1', role: 'user', content: '帮我检索 diffusion 文献', createdAt: 1 },
  ],
  model: 'cli',
  ...over,
});

async function run(req: ChatRequest, provider: CliProvider | EchoProvider) {
  const events = [];
  for await (const ev of provider.complete(req)) events.push(ev);
  return events;
}

describe('buildPrompt', () => {
  it('序列化消息角色与工具清单', () => {
    const text = buildPrompt(
      req({
        tools: [
          {
            name: 'library.search',
            description: '检索库内题录',
            permission: 'read',
            parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          },
        ],
      }),
    );
    expect(text).toContain('[system] 你是论文助手');
    expect(text).toContain('[user] 帮我检索 diffusion 文献');
    expect(text).toContain('library.search');
  });
});

describe('extractJsonlEvents / extractUsage', () => {
  it('claude stream-json：text 与 tool_use 内容项', () => {
    const events = extractJsonlEvents({
      type: 'assistant',
      message: { content: [{ type: 'text', text: '你好' }, { type: 'tool_use', id: 'tu_1', name: 'paper.read', input: { id: 'p1' } }] },
    });
    expect(events).toContainEqual({ type: 'text-delta', delta: '你好' });
    expect(events).toContainEqual({
      type: 'tool-call',
      call: { id: 'tu_1', tool: 'paper.read', args: { id: 'p1' } },
    });
  });

  it('codex exec --json：item.completed 的 agent_message 与 tool_call', () => {
    expect(
      extractJsonlEvents({ type: 'item.completed', item: { type: 'agent_message', text: '草稿完成' } }),
    ).toEqual([{ type: 'text-delta', delta: '草稿完成' }]);
    expect(
      extractJsonlEvents({ type: 'item.completed', item: { type: 'tool_call', id: 'tc_1', tool: 'tex.compile', arguments: '{}' } }),
    ).toEqual([{ type: 'tool-call', call: { id: 'tc_1', tool: 'tex.compile', args: {} } }]);
  });

  it('delta.content / tool_call 字符串参数 / error 事件', () => {
    expect(extractJsonlEvents({ delta: { content: '流式片段' } })).toEqual([{ type: 'text-delta', delta: '流式片段' }]);
    expect(extractJsonlEvents({ tool_call: { id: 'a', name: 'figure.render', arguments: '{"code":"x"}' } })).toEqual([
      { type: 'tool-call', call: { id: 'a', tool: 'figure.render', args: { code: 'x' } } },
    ]);
    expect(extractJsonlEvents({ type: 'error', message: '配额不足' })).toEqual([{ type: 'error', message: '配额不足' }]);
  });

  it('usage 宽容提取（两套字段名）', () => {
    expect(extractUsage({ usage: { input_tokens: 3, output_tokens: 4 } })).toEqual({ inputTokens: 3, outputTokens: 4 });
    expect(extractUsage({ usage: { prompt_tokens: 5, completion_tokens: 6 } })).toEqual({ inputTokens: 5, outputTokens: 6 });
    expect(extractUsage({ usage: {} })).toBeUndefined();
    expect(extractUsage({})).toBeUndefined();
  });
});

describe('CliProvider（jsonl 模式）', () => {
  const script = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 'x' }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '你好' }] } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '草稿完成' } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu_1', name: 'paper.read', input: { id: 'p1' } }] } }),
    JSON.stringify({ type: 'result', result: '完成', usage: { input_tokens: 5, output_tokens: 7 } }),
  ].join('\n');

  function makeProvider(runner: MockProcessRunner) {
    return new CliProvider({
      id: 'codex-cli',
      label: 'Codex CLI',
      command: 'codex',
      args: ['exec', '--json'],
      cwd: '/tmp/project',
      outputMode: 'jsonl',
      runner,
    });
  }

  it('按行解析为事件序列，进程退出发 done 并带 usage', async () => {
    const runner = new MockProcessRunner(script);
    const events = await run(req(), makeProvider(runner));
    expect(events).toEqual([
      { type: 'text-delta', delta: '你好' },
      { type: 'text-delta', delta: '草稿完成' },
      { type: 'tool-call', call: { id: 'tu_1', tool: 'paper.read', args: { id: 'p1' } } },
      { type: 'text-delta', delta: '完成' },
      { type: 'done', usage: { inputTokens: 5, outputTokens: 7 } },
    ]);
    expect(runner.spawnCalls).toEqual([{ cmd: 'codex', args: ['exec', '--json'], cwd: '/tmp/project' }]);
    expect(runner.written.join('')).toContain('[user] 帮我检索 diffusion 文献');
  });

  it('输出按任意小块切块时跨 chunk 重组（半行缓冲）', async () => {
    const runner = new MockProcessRunner(script, { chunkSize: 7 });
    const events = await run(req(), makeProvider(runner));
    expect(events.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('')).toBe('你好草稿完成完成');
    expect(events.at(-1)).toMatchObject({ type: 'done', usage: { inputTokens: 5, outputTokens: 7 } });
  });
});

describe('CliProvider（text 模式）', () => {
  it('整段输出作为 text-delta', async () => {
    const runner = new MockProcessRunner('第一段\n第二段');
    const provider = new CliProvider({
      id: 'zcode', label: 'ZCode', command: 'zcode', cwd: '/tmp/p', outputMode: 'text', runner,
    });
    const events = await run(req(), provider);
    expect(events.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('')).toBe('第一段\n第二段');
    expect(events.at(-1)?.type).toBe('done');
  });
});

describe('EchoProvider', () => {
  it('按小块延时回显最后一条用户消息', async () => {
    const provider = new EchoProvider({ delayMs: 0, chunkSize: 3 });
    const events = await run(req(), provider);
    expect(events.filter((e) => e.type === 'text-delta').map((e: any) => e.delta).join('')).toBe('帮我检索 diffusion 文献');
    expect(events.at(-1)?.type).toBe('done');
  });

  it('预先中止时直接结束', async () => {
    const provider = new EchoProvider({ delayMs: 0 });
    const controller = new AbortController();
    controller.abort();
    const events = [];
    for await (const ev of provider.complete({ ...req(), signal: controller.signal })) events.push(ev);
    expect(events).toEqual([{ type: 'done' }]);
  });
});
