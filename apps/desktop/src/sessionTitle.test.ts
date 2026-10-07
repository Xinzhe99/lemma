/**
 * 会话标题 AI 自动总结（v7.7.0，Codex 式）测试：
 *  - sanitizeSessionTitle：引号/「标题：」前缀/尾部句号清洗、首行提取、12 字截断、空输出；
 *  - buildSessionTitlePrompt：双消息注入与超长截断；
 *  - generateSessionTitle（mock fetch SSE）：
 *      · 演示模式不触发（不发包，真实 provider 才触发）；
 *      · 真实 provider 单轮无工具调用，system 为标题提示，输出清洗后回填；
 *      · 请求失败静默返回 null；15s 超时返回 null（fake timers + 悬挂 fetch）；
 *  - aiActions.sendChatMessage 集成门控：仅第一轮成功回复后覆盖派生标题；
 *    第二轮不重复触发；用户手动改名后不覆盖（store.renameSession 直改标题）。
 * 全程不依赖真实网络：fetch 以 SSE ReadableStream stub。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentHubStore } from '@lemma/agent-hub';
import {
  SESSION_TITLE_SYSTEM,
  buildSessionTitlePrompt,
  generateSessionTitle,
  sanitizeSessionTitle,
} from './sessionTitle';
import { sendChatMessage } from './aiActions';
import { useSettingsStore } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { resetContextPackCache } from './agentTools';

const PROVIDER = {
  id: 'p1',
  label: '测试服务',
  baseUrl: 'https://api.test/v1',
  apiKey: 'sk-test',
  model: 'test-model',
  tier: 'cheap' as const,
};

function seedProject(): void {
  useWorkspaceStore.setState({
    projectName: 'test',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}

function resetHub(): void {
  useAgentHubStore.setState({ sessions: [], activeSessionId: null, runs: [] });
  resetContextPackCache();
}

beforeEach(() => {
  resetHub();
  seedProject();
  useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useSettingsStore.setState({ providers: [], activeProviderId: null, language: 'zh' });
});

/** SSE 帮手：文本 → 两个 delta + finish + [DONE] */
function sseOfText(text: string): string {
  const mid = Math.ceil(text.length / 2);
  const esc = (s: string): string => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  return [
    `data: {"choices":[{"delta":{"content":"${esc(text.slice(0, mid))}"}}]}\n\n`,
    `data: {"choices":[{"delta":{"content":"${esc(text.slice(mid))}"}}]}\n\n`,
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    'data: [DONE]\n\n',
  ].join('');
}

function sseResponse(text: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(sseOfText(text)));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

interface Body {
  messages: Array<{ role: string; content: string }>;
  tools?: Array<{ function: { name: string } }>;
}

describe('sanitizeSessionTitle（结果清洗）', () => {
  it('去中英引号、去尾部句号与省略号', () => {
    expect(sanitizeSessionTitle('“文献综述的实操指南”。')).toBe('文献综述的实操指南');
    expect(sanitizeSessionTitle('"Polish intro".')).toBe('Polish intro');
    expect(sanitizeSessionTitle('‘扩散模型综述’…')).toBe('扩散模型综述');
    expect(sanitizeSessionTitle('「实验设计」；')).toBe('实验设计');
  });

  it('去「标题：/Title:」前缀与列表符号（模型常见越界输出）；超 12 字截断', () => {
    expect(sanitizeSessionTitle('标题：审稿意见应对')).toBe('审稿意见应对');
    // 清洗后 13 字 → 截断到 12 字（尾部 s 被截掉）
    expect(sanitizeSessionTitle('- Title: Rebuttal tips。')).toBe('Rebuttal tip');
  });

  it('取首个非空行；空/纯符号输出返回空串', () => {
    expect(sanitizeSessionTitle('\n  第二行才是内容\n第三行')).toBe('第二行才是内容');
    expect(sanitizeSessionTitle('')).toBe('');
    expect(sanitizeSessionTitle('  \n \n')).toBe('');
    expect(sanitizeSessionTitle('“”。')).toBe('');
  });

  it('按 Unicode 码点截断到 12 字', () => {
    const long = '这是一个超过十二个字的长标题需要被截断';
    expect(Array.from(long)).toHaveLength(19);
    expect(sanitizeSessionTitle(long)).toBe('这是一个超过十二个字的长');
    expect(Array.from(sanitizeSessionTitle(long))).toHaveLength(12);
    expect(sanitizeSessionTitle('abc')).toBe('abc');
  });
});

describe('buildSessionTitlePrompt（prompt 组装）', () => {
  it('包含用户消息与 AI 回复', () => {
    const prompt = buildSessionTitlePrompt('帮我润色引言', '好的，建议如下……');
    expect(prompt).toContain('用户：帮我润色引言');
    expect(prompt).toContain('AI：好的，建议如下……');
  });

  it('超长内容截断（首条消息 300 字 / 回复 600 字上限）', () => {
    const prompt = buildSessionTitlePrompt('长'.repeat(400), '复'.repeat(800));
    expect(prompt).toContain(`用户：${'长'.repeat(300)}…`);
    expect(prompt).toContain(`AI：${'复'.repeat(600)}…`);
    expect(prompt).not.toContain('长'.repeat(301));
  });
});

describe('generateSessionTitle（真实 provider 门控 + 静默失败）', () => {
  it('演示模式（无真实 provider）不触发：不发包直接返回 null', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(generateSessionTitle('问题', '回答')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('真实 provider：单轮无工具调用，system 为标题提示，输出清洗后返回', async () => {
    useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
    const bodies: Body[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body ?? '{}')) as Body);
        return sseResponse('“文献综述的实操指南”。');
      }),
    );
    await expect(generateSessionTitle('怎么做好文献综述', '建议先从综述性文献入手')).resolves.toBe(
      '文献综述的实操指南',
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.messages[0]).toMatchObject({ role: 'system', content: SESSION_TITLE_SYSTEM });
    // tools:[] → 请求体不带工具（纯文本生成，无工具循环）
    expect(bodies[0]!.tools).toBeUndefined();
    const user = bodies[0]!.messages.find((m) => m.role === 'user');
    expect(user?.content).toContain('怎么做好文献综述');
    expect(user?.content).toContain('建议先从综述性文献入手');
  });

  it('请求失败完全静默：返回 null 不抛错', async () => {
    useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('boom');
      }),
    );
    await expect(generateSessionTitle('问题', '回答')).resolves.toBeNull();
  });

  it('15s 超时返回 null（Promise.race，悬挂 fetch）', async () => {
    vi.useFakeTimers();
    try {
      useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
      vi.stubGlobal('fetch', vi.fn(async () => new Promise<Response>(() => undefined)));
      const pending = generateSessionTitle('问题', '回答');
      const check = expect(pending).resolves.toBeNull();
      await vi.advanceTimersByTimeAsync(15100);
      await check;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------
// aiActions 集成门控：第一轮成功回复后 fire-and-forget 覆盖；改名后不覆盖
// ---------------------------------------------------------------------------

describe('sendChatMessage 集成（标题自动总结门控）', () => {
  it('第一轮真实回复完成后：派生前缀标题被 AI 标题覆盖', async () => {
    useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Body;
        const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
        return sseResponse(system.includes('会话标题') ? '“文献综述的实操指南”。' : '第一轮回复完成。');
      }),
    );
    await sendChatMessage('帮我梳理文献综述的写作思路');
    // 临时标题立即为前缀派生值
    expect(useAgentHubStore.getState().sessions[0]!.title).toBe('帮我梳理文献综述的写作思路');
    // AI 标题异步落地后覆盖（fire-and-forget）
    await vi.waitFor(() =>
      expect(useAgentHubStore.getState().sessions[0]!.title).toBe('文献综述的实操指南'),
    );
  });

  it('第二轮不再触发标题生成（仅第一轮），标题保持不变', async () => {
    useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
    let titleCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Body;
        const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
        if (system.includes('会话标题')) {
          titleCalls += 1;
          return sseResponse('“某个标题”。');
        }
        return sseResponse('后续轮回复。');
      }),
    );
    await sendChatMessage('第一轮问题');
    await vi.waitFor(() => expect(useAgentHubStore.getState().sessions[0]!.title).not.toBe('第一轮问题'));
    expect(titleCalls).toBe(1);
    const titled = useAgentHubStore.getState().sessions[0]!.title;
    await sendChatMessage('第二轮问题');
    await new Promise((r) => setTimeout(r, 20));
    expect(titleCalls).toBe(1); // 不重复触发
    expect(useAgentHubStore.getState().sessions[0]!.title).toBe(titled);
  });

  it('用户已手动改名 → AI 标题不覆盖（仅覆盖派生值）', async () => {
    useSettingsStore.setState({ providers: [PROVIDER], activeProviderId: 'p1' });
    let resolveTitle: ((r: Response) => void) | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string | URL | RequestInfo, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}')) as Body;
        const system = body.messages.find((m) => m.role === 'system')?.content ?? '';
        if (system.includes('会话标题')) {
          return new Promise<Response>((resolve) => {
            resolveTitle = resolve; // 悬挂：等测试先手动改名
          });
        }
        return sseResponse('第一轮回复完成。');
      }),
    );
    await sendChatMessage('帮我做实验设计');
    await vi.waitFor(() => expect(resolveTitle).not.toBeNull());
    const sid = useAgentHubStore.getState().activeSessionId!;
    useAgentHubStore.getState().renameSession(sid, '手动改的标题');
    resolveTitle!(sseResponse('“AI 生成的标题”'));
    await new Promise((r) => setTimeout(r, 20));
    expect(useAgentHubStore.getState().sessions.find((s) => s.id === sid)!.title).toBe('手动改的标题');
  });

  it('演示模式（无真实 provider）：标题保持前缀派生值，不发任何请求', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendChatMessage('帮我润色引言');
    expect(fetchMock).not.toHaveBeenCalled(); // ScriptedDemoProvider 不走 fetch
    expect(useAgentHubStore.getState().sessions[0]!.title).toBe('帮我润色引言');
  });
});
