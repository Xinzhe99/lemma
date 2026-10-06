/**
 * 图像转 LaTeX（v5.2.0 C，借鉴 Prism「图像转代码」）：
 * 公式/表格截图 → 视觉模型 → LaTeX 源码。独立于 agent 消息管道（AgentMessage
 * 为纯文本），直接以 OpenAI 兼容 multimodal content parts 调用当前配置的
 * 模型服务——支持视觉的模型（GLM-4V / GPT-4o / Qwen-VL 等）即可用；
 * 不支持时端点返回错误，UI 诚实提示换用视觉模型。
 */

import { useSettingsStore } from './state/settingsStore';
import { useAgentUsageStore } from './state/agentUsage';

export interface VisionLatexResult {
  ok: boolean;
  latex?: string;
  error?: string;
}

/** 把图片（data URL）转成 LaTeX；kind 影响提示词（公式/表格/自动） */
export async function imageToLatex(
  dataUrl: string,
  kind: 'auto' | 'formula' | 'table' = 'auto',
): Promise<VisionLatexResult> {
  const s = useSettingsStore.getState();
  const cfg = s.providers.find((p) => p.id === s.activeProviderId);
  if (!cfg || !cfg.baseUrl.trim() || !cfg.apiKey.trim()) {
    return { ok: false, error: '未配置模型服务（设置 → 模型服务）；图像转 LaTeX 需要支持视觉的模型' };
  }
  const model = cfg.model.trim() || 'default';

  const guidance =
    kind === 'formula'
      ? '这是一段数学公式截图。'
      : kind === 'table'
        ? '这是一个表格截图。'
        : '这是一段论文内容截图（公式、表格或混合）。';
  const t0 = Date.now();
  const system =
    '你是 LaTeX 转换专家。把图片内容精确转换为 LaTeX 源码：公式用 $...$ 或 equation 环境，表格用 tabular（booktabs 三线表），保持原文结构。只输出可直接粘贴进正文的 LaTeX 代码，不要解释、不要 markdown 围栏。';
  const user = `${guidance}请转换为 LaTeX。`;

  try {
    const res = await fetch(`${cfg.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: [
              { type: 'text', text: user },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });
    if (!res.ok) {
      const hint =
        res.status === 400 || res.status === 422
          ? '（当前模型可能不支持视觉输入——请在设置中切换到视觉模型，如 GLM-4V / gpt-4o / Qwen-VL）'
          : '';
      return { ok: false, error: `服务返回 HTTP ${res.status} ${hint}` };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content?.trim() ?? '';
    if (!text) return { ok: false, error: '模型返回为空' };
    // 剥掉模型偶发的 markdown 围栏
    const latex = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
    try {
      useAgentUsageStore.getState().record({
        kind: 'tool',
        model,
        inputTokens: Math.ceil(dataUrl.length / 4), // base64 折算
        outputTokens: Math.ceil(text.length / 2),
        latencyMs: Date.now() - t0,
      });
    } catch {
      /* 用量记录失败不影响转换 */
    }
    return { ok: true, latex };
  } catch (e) {
    return { ok: false, error: `请求失败：${e instanceof Error ? e.message : String(e)}` };
  }
}

/** 本地文件 → data URL（读取为 base64） */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}
