// @vitest-environment jsdom
/**
 * v6.4.0 对话贴图：provider 多模态组装 / store 持久化剥离 / runAgentTurn 透传 / 演示模式拦截。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMessage } from '@lemma/shared';
import { serializeSessionsForPersist, useAgentHubStore } from '@lemma/agent-hub';

beforeEach(() => {
  useAgentHubStore.setState({ sessions: [], activeSessionId: null });
});

describe('store：sendMessage 带图与持久化剥离', () => {
  it('sendMessage(text, images) 存入消息；serializeSessionsForPersist 剥离 images 防膨胀', () => {
    const sid = useAgentHubStore.getState().newSession('host', 'p');
    useAgentHubStore.getState().sendMessage(sid, '看这张图\n[图片 ×1]', ['data:image/png;base64,AAAA']);
    const msg = useAgentHubStore.getState().sessions[0]!.messages.find((m) => m.role === 'user')!;
    expect(msg.images).toEqual(['data:image/png;base64,AAAA']);

    const saved = serializeSessionsForPersist(useAgentHubStore.getState().sessions);
    const savedMsg = saved[0]!.messages.find((m) => m.role === 'user')!;
    expect(savedMsg.images).toBeUndefined();
    expect(savedMsg.content).toContain('[图片 ×1]');
    useAgentHubStore.getState().deleteSession(sid);
  });

  it('无图消息不受影响', () => {
    const sid = useAgentHubStore.getState().newSession('host', 'p');
    useAgentHubStore.getState().sendMessage(sid, '纯文本');
    const msg = useAgentHubStore.getState().sessions[0]!.messages[0]!;
    expect(msg.images).toBeUndefined();
    useAgentHubStore.getState().deleteSession(sid);
  });
});

describe('openaiCompat：带图消息组装多模态 content', () => {
  it('images 消息 → content 为 [text, image_url...]；普通消息仍为 string', async () => {
    const bodies: unknown[] = [];
    const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}

`;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(sse({ choices: [{ delta: { content: 'ok' } }] }) + 'data: [DONE]' + String.fromCharCode(10, 10)));
        c.close();
      },
    });
    const { OpenAICompatibleProvider } = await import('@lemma/agent-hub');
    const provider = new OpenAICompatibleProvider({
      id: 't', label: 'T', baseUrl: 'https://t.test/v1', apiKey: 'k',
      fetchFn: (async (_u: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(stream, { status: 200 });
      }) as never,
    });
    const messages: AgentMessage[] = [
      { id: 'u1', role: 'user', content: '看图', images: ['data:image/png;base64,B'], createdAt: 1 },
      { id: 'a1', role: 'assistant', content: '好的', createdAt: 2 },
    ];
    for await (const _ev of provider.complete({ messages, model: 'm' })) { /* drain */ }
    const body = bodies[0] as { messages: Array<{ role: string; content: unknown }> };
    const first = body.messages[0]!;
    expect(Array.isArray(first.content)).toBe(true);
    const parts = first.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[0]!.type).toBe('text');
    expect(parts[1]!.type).toBe('image_url');
    expect(parts[1]!.image_url!.url).toBe('data:image/png;base64,B');
    expect(typeof body.messages[1]!.content).toBe('string');
  });
});

describe('runAgentTurn：userImages 透传到请求', () => {
  it('带 userImages → 首条 user 消息含 image_url；不带 → 纯文本', async () => {
    const seen: unknown[] = [];
    const mkStream = () => {
      const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}

`;
      return new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(sse({ choices: [{ delta: { content: '收到图' } }] }) + 'data: [DONE]' + String.fromCharCode(10, 10)));
          c.close();
        },
      });
    };
    const { OpenAICompatibleProvider } = await import('@lemma/agent-hub');
    const provider = new OpenAICompatibleProvider({
      id: 't', label: 'T', baseUrl: 'https://t.test/v1', apiKey: 'k',
      fetchFn: (async (_u: string, init?: RequestInit) => {
        seen.push(JSON.parse(String(init?.body)));
        return new Response(mkStream(), { status: 200 });
      }) as never,
    });
    const { runAgentTurn } = await import('./agentTools');
    await runAgentTurn({ provider, model: 'm', system: 's', history: [], user: '看图', userImages: ['data:image/png;base64,Z'] });
    const body = seen[0] as { messages: Array<{ role: string; content: unknown }> };
    const userMsg = body.messages.find((m) => m.role === 'user')!;
    const parts = userMsg.content as Array<{ type: string }>;
    expect(parts.some((p) => p.type === 'image_url')).toBe(true);

    seen.length = 0;
    await runAgentTurn({ provider, model: 'm', system: 's', history: [], user: '纯文本' });
    const body2 = seen[0] as { messages: Array<{ role: string; content: unknown }> };
    const userMsg2 = body2.messages.find((m) => m.role === 'user')!;
    expect(typeof userMsg2.content).toBe('string');
  });
});
