/**
 * connectionTest 测试（激活器 P0）：注入 mock http，覆盖五条路径——
 * 成功（带模型/不带模型）、401（Key 无效）、404（BaseURL 不对）、网络错（含 CORS 提示）、
 * 模型不存在（/models 通过但 chat 失败）；外加请求形态（URL/鉴权头/max_tokens:1/ping）
 * 与空参守卫。
 */
import { describe, expect, it, vi } from 'vitest';
import { testProvider, TEST_TIMEOUT_MS } from './connectionTest';

/** 手搓 Response 形状（ok/status/json），避免依赖运行时 Response 实现 */
function res(status: number, body?: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => (body === undefined ? {} : body),
  } as Response;
}

function okModels(): Response {
  return res(200, { data: [{ id: 'deepseek-chat' }] });
}

function okChat(reply = 'p'): Response {
  return res(200, { choices: [{ message: { role: 'assistant', content: reply } }] });
}

const CFG = { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-test', model: 'deepseek-chat' };

describe('testProvider · 成功路径', () => {
  it('带模型：/models 通过 + 1-token chat 通过 → ok，回显延迟/模型/reply，step=chat', async () => {
    const http = vi.fn(async (url: string) => (url.endsWith('/models') ? okModels() : okChat('pong')));
    const r = await testProvider(CFG, http);

    expect(r.ok).toBe(true);
    expect(r.step).toBe('chat');
    expect(r.model).toBe('deepseek-chat');
    expect(r.reply).toBe('pong');
    expect(typeof r.latencyMs).toBe('number');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.error).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(2);
  });

  it('不带模型：只打 /models → ok，step=models，不发起 chat', async () => {
    const http = vi.fn(async () => okModels());
    const r = await testProvider({ baseUrl: CFG.baseUrl, apiKey: CFG.apiKey }, http);

    expect(r.ok).toBe(true);
    expect(r.step).toBe('models');
    expect(r.model).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledWith('https://api.deepseek.com/v1/models', expect.anything());
  });

  it('请求形态：GET /models 与 POST /chat/completions 均带 Bearer；chat 体为 max_tokens:1 + ping', async () => {
    const http = vi.fn(async (url: string, _init?: RequestInit) => (url.endsWith('/models') ? okModels() : okChat()));
    await testProvider(CFG, http);

    const [mUrl, mInit] = http.mock.calls[0]!;
    expect(mUrl).toBe('https://api.deepseek.com/v1/models');
    expect(mInit!.method).toBe('GET');
    expect((mInit!.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');

    const [cUrl, cInit] = http.mock.calls[1]!;
    expect(cUrl).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(cInit!.method).toBe('POST');
    expect(JSON.parse(cInit!.body as string)).toEqual({
      model: 'deepseek-chat',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    });
  });

  it('baseUrl 带尾部斜杠会被归一；chat 回复为空串时 reply 缺省但 ok 保持', async () => {
    const http = vi.fn(async (url: string) => (url.endsWith('/models') ? okModels() : okChat('')));
    const r = await testProvider({ ...CFG, baseUrl: 'https://api.deepseek.com/v1/' }, http);
    expect(r.ok).toBe(true);
    expect(http.mock.calls[0]![0]).toBe('https://api.deepseek.com/v1/models');
    expect(r.reply).toBeUndefined();
  });
});

describe('testProvider · 失败路径', () => {
  it('401 → API Key 无效（models 步短路，不再发 chat）', async () => {
    const http = vi.fn(async () => res(401, { error: { message: 'invalid key' } }));
    const r = await testProvider(CFG, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('models');
    expect(r.error).toContain('API Key 无效');
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('404 → BaseURL 不对（提示检查 /v1）', async () => {
    const http = vi.fn(async () => res(404));
    const r = await testProvider({ baseUrl: 'https://api.deepseek.com', apiKey: 'sk' }, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('models');
    expect(r.error).toContain('BaseURL 不对');
    expect(r.error).toContain('/v1');
  });

  it('网络错（fetch 拒绝）→ 提示检查网络/代理，并附 CORS/桌面版说明', async () => {
    const http = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const r = await testProvider(CFG, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('models');
    expect(r.error).toContain('检查网络/代理');
    expect(r.error).toContain('CORS');
    expect(r.error).toContain('桌面版无此限制');
  });

  it('模型不存在：/models 通过但 chat 404 → step=chat，错误点名模型', async () => {
    const http = vi.fn(async (url: string) =>
      url.endsWith('/models') ? okModels() : res(404, { error: { message: 'Model Not Exist' } }),
    );
    const r = await testProvider(CFG, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('chat');
    expect(r.model).toBe('deepseek-chat');
    expect(r.error).toContain('模型不可用');
    expect(r.error).toContain('deepseek-chat');
    expect(r.error).toContain('Model Not Exist');
  });

  it('chat 步 400（如模型名拼错）同样归为模型不可用', async () => {
    const http = vi.fn(async (url: string) => (url.endsWith('/models') ? okModels() : res(400)));
    const r = await testProvider(CFG, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('chat');
    expect(r.error).toContain('模型不可用');
  });

  it('chat 步网络失败 → 网络错误文案，step=chat', async () => {
    const http = vi.fn(async (url: string) => {
      if (url.endsWith('/models')) return okModels();
      throw new TypeError('network down');
    });
    const r = await testProvider(CFG, http);
    expect(r.ok).toBe(false);
    expect(r.step).toBe('chat');
    expect(r.error).toContain('检查网络/代理');
  });

  it('空参守卫：缺 BaseURL / 缺 API Key 直接返回中文提示，不发请求', async () => {
    const http = vi.fn(async () => okModels());
    const noBase = await testProvider({ baseUrl: '', apiKey: 'sk' }, http);
    expect(noBase.ok).toBe(false);
    expect(noBase.error).toContain('BaseURL');

    const noKey = await testProvider({ baseUrl: CFG.baseUrl, apiKey: '  ' }, http);
    expect(noKey.ok).toBe(false);
    expect(noKey.error).toContain('API Key');
    expect(http).not.toHaveBeenCalled();
  });
});

describe('testProvider · 超时', () => {
  it('TEST_TIMEOUT_MS 为 15 秒量级（防按钮永转）', () => {
    expect(TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(10000);
    expect(TEST_TIMEOUT_MS).toBeLessThanOrEqual(30000);
  });
});
