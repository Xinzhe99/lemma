// @vitest-environment jsdom
/**
 * v6.8.0 bug 修复回归：
 *  1. sendChatMessage 历史剥离 images（防每轮重复上传历史图片）
 *  2. 用户停止（AbortError）显示 [已停止] 而非网络错误
 *  3. gitignore 包含 sf-tmp-attach-*（docx 临时文件）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const procMock = vi.hoisted(() => vi.fn());
vi.mock('./platform/tauri', () => ({
  tauriProcRun: procMock,
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
  tauriWriteFileBase64: vi.fn(),
}));

import { sendChatMessage } from './aiActions';
import { useAgentHubStore } from '@lemma/agent-hub';
import { useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { useLibraryStore } from './state/libraryStore';

const requests: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];

function mkStream(text: string): ReadableStream<Uint8Array> {
  const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(sse + 'data: [DONE]\n\n'));
      c.close();
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  requests.length = 0;
  useAgentHubStore.setState({ sessions: [], activeSessionId: null });
  useWorkspaceStore.setState({ files: {}, compileLog: [] });
  useLibraryStore.setState({ papers: [], pdfAttachments: {} });
});

describe('修复 1：历史剥离 images', () => {
  it('第二轮请求不再携带第一轮的图片（image_url 只出现在当轮）', async () => {
    useSettingsStore.setState({
      providers: [{ id: 'p', label: 'T', baseUrl: 'https://t/v1', apiKey: 'k', model: 'm', tier: 'flagship' }],
      activeProviderId: 'p',
    });
    const { OpenAICompatibleProvider } = await import('@lemma/agent-hub');
    const provider = new OpenAICompatibleProvider({
      id: 'p', label: 'T', baseUrl: 'https://t/v1', apiKey: 'k',
      fetchFn: (async (_u: string, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)));
        return new Response(mkStream('收到'), { status: 200 });
      }) as never,
    });
    const orig = (await import('./agentTools')).runAgentTurn;
    const { sendChatMessage } = await import('./aiActions');
    const mod = await import('./agentTools');
    vi.spyOn(mod, 'runAgentTurn').mockImplementation(async (opts) => {
      for await (const _ev of provider.complete({ messages: opts.history as never, model: opts.user ? 'm' : 'm' })) { /* drain */ }
      // 模拟真实组装：直接验证 opts.history 无 images
      const leaked = (opts.history as Array<{ images?: string[] }>).some((m) => m.images?.length);
      (mod as unknown as { __leaked?: boolean }).__leaked = leaked;
      return 'ok';
    });

    // 第一轮带图
    await sendChatMessage('看图', ['data:image/png;base64,A']);
    // 第二轮纯文本：history 应包含第一轮 user 消息但无 images
    await sendChatMessage('继续');
    const leaked = (mod as unknown as { __leaked?: boolean }).__leaked;
    expect(leaked).toBe(false);
    vi.spyOn(mod, 'runAgentTurn').mockRestore();
    void orig;
  });
});

describe('修复 2：停止 ≠ 网络错误', () => {
  it('用户停止（abortChat 后 AbortError）→ 回复尾注 [已停止]（无「网络」字样）', async () => {
    useSettingsStore.setState({
      providers: [{ id: 'p', label: 'T', baseUrl: 'https://t/v1', apiKey: 'k', model: 'm', tier: 'flagship' }],
      activeProviderId: 'p',
    });
    const mod = await import('./agentTools');
    const { abortChat } = await import('./aiActions');
    vi.spyOn(mod, 'runAgentTurn').mockImplementation(async () => {
      abortChat(); // 模拟用户在流式中点停止（真实时序：fetch 拒绝 → catch）
      const err = new Error('请求失败：The operation was aborted');
      throw err;
    });
    await sendChatMessage('hi');
    const sid = useAgentHubStore.getState().activeSessionId!;
    const msgs = useAgentHubStore.getState().sessions.find((s) => s.id === sid)!.messages;
    const assistant = msgs.find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('[已停止]');
    expect(assistant.content).not.toContain('网络');
    vi.spyOn(mod, 'runAgentTurn').mockRestore();
  });

  it('真实网络错误仍走友好化提示', async () => {
    useSettingsStore.setState({
      providers: [{ id: 'p', label: 'T', baseUrl: 'https://t/v1', apiKey: 'k', model: 'm', tier: 'flagship' }],
      activeProviderId: 'p',
    });
    const mod = await import('./agentTools');
    vi.spyOn(mod, 'runAgentTurn').mockRejectedValue(new Error('HTTP 401 Unauthorized'));
    await sendChatMessage('hi');
    const sid = useAgentHubStore.getState().activeSessionId!;
    const assistant = useAgentHubStore.getState().sessions.find((s) => s.id === sid)!.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.content).toContain('API Key');
    vi.spyOn(mod, 'runAgentTurn').mockRestore();
  });
});
