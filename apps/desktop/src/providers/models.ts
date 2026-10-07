/**
 * 模型列表拉取（v7.6.0）：OpenAI 兼容网关普遍支持 GET {baseUrl}/models。
 * 拉取成功 → 下拉建议列表；失败（端点不支持/网络）→ 返回错误信息由 UI 呈现，
 * 用户仍可手填模型名。纯函数模块，无副作用。
 */

export interface FetchModelsResult {
  models: string[];
  error?: string;
}

export async function fetchModels(baseUrl: string, apiKey: string, fetchFn?: typeof fetch): Promise<FetchModelsResult> {
  const root = baseUrl.trim().replace(/\/+$/, '');
  if (!root) return { models: [], error: '请先填写服务地址（baseUrl）' };
  if (!apiKey.trim()) return { models: [], error: '请先填写 API Key' };
  try {
    const res = await (fetchFn ?? fetch)(`${root}/models`, {
      headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { models: [], error: `接口返回 ${res.status}${text ? `：${text.slice(0, 120)}` : ''}` };
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (json.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id : ''))
      .filter((id) => id.length > 0)
      .sort((a, b) => a.localeCompare(b));
    if (ids.length === 0) return { models: [], error: '服务未返回模型列表（可手填模型名）' };
    return { models: ids };
  } catch (e) {
    return { models: [], error: e instanceof Error ? e.message : String(e) };
  }
}
