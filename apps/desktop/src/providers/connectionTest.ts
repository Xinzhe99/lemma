/**
 * 模型服务连接测试（激活器 P0）：保存前即可验证 BaseURL / API Key / 模型可用性。
 *
 * 策略（两步，失败即短路）：
 *  1. GET {baseUrl}/models（带 Authorization）——验证连通性与 Key，记录延迟；
 *  2. 若填了 model，再发一条 1-token chat（max_tokens:1, "ping"）——验证模型可调用并回显 reply。
 *
 * 浏览器 CORS 说明：多数 OpenAI 兼容端点（DeepSeek / GLM 等）允许跨域；若浏览器控制台报
 * CORS，桌面版（Tauri WKWebView）无此限制——该提示会拼进网络错误文案。
 * http 可注入（测试 mock fetch）；错误文案为中文（含处置建议）。
 */

export interface TestProviderConfig {
  baseUrl: string;
  apiKey: string;
  /** 可选：填了才走第 2 步 chat 验证 */
  model?: string;
}

export type TestResultStep = 'models' | 'chat';

export interface TestResult {
  ok: boolean;
  /** 第 1 步（/models）往返延迟；失败时缺省 */
  latencyMs?: number;
  /** 第 2 步验证的模型名 */
  model?: string;
  /** 第 2 步回显的模型回复（1-token，可能为空串则缺省） */
  reply?: string;
  /** 失败原因（中文，含处置建议） */
  error?: string;
  /** 失败发生在哪一步 */
  step: TestResultStep;
}

export type TestFetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** 单请求超时：真实端点挂起时别让按钮永远转圈 */
export const TEST_TIMEOUT_MS = 15000;

const CORS_HINT = '；请检查网络/代理是否可达（若浏览器控制台报 CORS，桌面版无此限制）';

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** 带超时的请求：超时触发 abort → fetch 以 AbortError 拒绝（注入的 mock 可忽略 signal） */
async function request(http: TestFetchLike, url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TEST_TIMEOUT_MS);
  try {
    return await http(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 网络层失败（DNS/断网/代理/CORS/超时）统一成中文文案 */
function networkError(e: unknown): string {
  const aborted = e instanceof Error && e.name === 'AbortError';
  return aborted
    ? `连接超时（${TEST_TIMEOUT_MS / 1000} 秒无响应）${CORS_HINT}`
    : `无法连接到服务（${e instanceof Error ? e.message : String(e)}）${CORS_HINT}`;
}

/** chat/completions 响应的最小结构（宽容解析，字段缺失不致命） */
interface ChatCompletionLike {
  choices?: { message?: { content?: unknown }; text?: unknown }[];
  error?: { message?: unknown } | string;
}

async function parseJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const v = (await res.json()) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 提取服务端 error.message（如 "Model Not Exist"），取不到给空串 */
async function extractErrorMessage(res: Response): Promise<string> {
  const body = await parseJson(res);
  const err = body?.error;
  const msg = typeof err === 'string' ? err : err && typeof err === 'object' ? (err as { message?: unknown }).message : undefined;
  return typeof msg === 'string' ? msg.slice(0, 120) : '';
}

/** 连接测试入口。http 缺省用全局 fetch（浏览器/桌面运行时）。 */
export async function testProvider(cfg: TestProviderConfig, http: TestFetchLike = (url, init) => fetch(url, init)): Promise<TestResult> {
  const base = normalizeBase(cfg.baseUrl ?? '');
  const key = (cfg.apiKey ?? '').trim();
  const model = (cfg.model ?? '').trim();
  if (!base) {
    return { ok: false, step: 'models', error: '请先填写 BaseURL（如 https://api.deepseek.com/v1，注意是否含 /v1）' };
  }
  if (!key) {
    return { ok: false, step: 'models', error: '请先填写 API Key' };
  }
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // ---- 第 1 步：GET /models 验证连通与 Key ----
  let latencyMs: number;
  try {
    const started = Date.now();
    const res = await request(http, `${base}/models`, { method: 'GET', headers });
    latencyMs = Date.now() - started;
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, step: 'models', error: `API Key 无效或未授权（HTTP ${res.status}）` };
      }
      if (res.status === 404) {
        return { ok: false, step: 'models', error: 'BaseURL 不对（HTTP 404，检查是否含 /v1 或地址拼写）' };
      }
      return { ok: false, step: 'models', error: `服务返回 HTTP ${res.status}，请检查 BaseURL 与服务状态` };
    }
  } catch (e) {
    return { ok: false, step: 'models', error: networkError(e) };
  }

  // ---- 第 2 步（可选）：1-token chat 验证模型可用 ----
  if (!model) {
    return { ok: true, step: 'models', latencyMs };
  }
  try {
    const res = await request(http, `${base}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
    });
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        return { ok: false, step: 'chat', model, error: `API Key 无效或未授权（HTTP ${res.status}）` };
      }
      // 到这里说明 /models 已通过，非鉴权失败大概率是模型名问题（多为 404/400）
      const detail = await extractErrorMessage(res);
      return {
        ok: false,
        step: 'chat',
        model,
        error: `模型不可用（model: ${model}，HTTP ${res.status}${detail ? `：${detail}` : ''}）——请核对模型名是否在该服务存在`,
      };
    }
    const body = await parseJson(res);
    const choice = (body as ChatCompletionLike | null)?.choices?.[0];
    const raw = typeof choice?.message?.content === 'string' ? choice.message.content : typeof choice?.text === 'string' ? choice.text : '';
    return { ok: true, step: 'chat', latencyMs, model, ...(raw ? { reply: raw } : {}) };
  } catch (e) {
    return { ok: false, step: 'chat', model, error: networkError(e) };
  }
}
