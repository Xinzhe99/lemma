/**
 * 模型服务预设（激活器 WS-Act）：把"从空白表单手填"变成"选预设 → 贴 Key → 测试 → 保存"。
 * 纯数据模块，无副作用：设置对话框的快速预设下拉与 Agent 面板激活引导卡共用。
 *
 * 约定：
 *  - baseUrl 为 OpenAI 兼容根地址（不带尾部斜杠，通常以 /v1 结尾）；
 *  - models[0] 为选中预设时填入表单的默认模型，其余为可切换的建议模型；
 *  - 模型名随厂商迭代会变化，note/noteEn 中已注明"以控制台为准"。
 */

export interface ProviderPreset {
  id: string;
  /** 展示名（品牌名，不做双语） */
  label: string;
  /** OpenAI 兼容根地址；自建模板为空串（由用户填写） */
  baseUrl: string;
  /** 建议模型（非空；[0] 为默认） */
  models: string[];
  /** 中文备注（一句话说明定位/注意事项） */
  note: string;
  /** 英文备注（界面语言为 en 时展示） */
  noteEn?: string;
  /** 控制台/获取 API Key 的网址，用于「去获取 Key ↗」链接 */
  keyUrl?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    note: '性价比高，工作流默认档位够用',
    noteEn: 'Great value; enough for the default workflow tier',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'zhipu-glm',
    label: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.7', 'glm-4.7-flash'],
    note: '模型名以智谱控制台为准',
    noteEn: 'Model names: see the Zhipu console for the latest',
    keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    // v7.6.0：Coding Plan 订阅端点（OpenAI 兼容透传，订阅套餐计费而非按量）
    id: 'zhipu-coding',
    label: '智谱 GLM Coding Plan',
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    models: ['glm-4.7', 'glm-4.6'],
    note: 'GLM Coding Plan 订阅专用端点（套餐计费）；Key 与开放平台相同，模型名以控制台为准',
    noteEn: 'GLM Coding Plan subscription endpoint (plan-based billing); same key as the open platform',
    keyUrl: 'https://open.bigmodel.cn/usercenter/proxykey',
  },
  {
    id: 'kimi-coding',
    label: 'Kimi For Coding',
    baseUrl: 'https://api.kimi.com/coding/v1',
    models: ['kimi-for-coding'],
    note: 'Kimi 会员编程端点（套餐计费）；需开通 Kimi For Coding',
    noteEn: 'Kimi membership coding endpoint (plan-based billing)',
    keyUrl: 'https://www.kimi.com/coding/',
  },
  {
    id: 'moonshot',
    label: 'Kimi / Moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-128k', 'moonshot-v1-8k'],
    note: '长上下文（128k）适合整篇论文的工作流；模型名以控制台为准',
    noteEn: 'Long context (128k) fits whole-paper workflows; see console for model names',
    keyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
    note: '聚合多家开源模型，一个 Key 通吃；模型名以控制台为准',
    noteEn: 'Aggregates open-source models under one key; see console for model names',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'qwen',
    label: '通义千问 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-plus', 'qwen-max'],
    note: '阿里云百炼的 OpenAI 兼容端点；模型名以控制台为准',
    noteEn: 'OpenAI-compatible endpoint on Aliyun Bailian; see console for model names',
    keyUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
    note: '官方端点，对网络环境要求较高',
    noteEn: 'Official endpoint; needs reliable international network access',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'custom-openai-compat',
    label: 'OpenAI 兼容·自建',
    baseUrl: '',
    models: ['qwen3-8b', 'llama-3.1-8b-instruct'],
    note: 'vLLM / Ollama / LM Studio 等本地或自建兼容端点（地址通常以 /v1 结尾），模型名以服务端实际部署为准',
    noteEn: 'vLLM / Ollama / LM Studio or any self-hosted compatible endpoint (URL usually ends with /v1); model names follow your server',
  },
];

/** 按 id 查预设；找不到（含空串）返回 undefined。 */
export function findPreset(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((p) => p.id === id);
}

/** 按 baseUrl 精确匹配预设（编辑既有服务时反查，用于回显预设与「去获取 Key」链接）。 */
export function matchPresetByBaseUrl(baseUrl: string): ProviderPreset | undefined {
  const target = baseUrl.trim().replace(/\/+$/, '');
  if (!target) return undefined;
  return PROVIDER_PRESETS.find((p) => p.baseUrl === target);
}
