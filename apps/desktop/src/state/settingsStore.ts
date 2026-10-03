/**
 * 应用设置：模型服务 Provider、主题、语言。
 * 持久化到 localStorage（key: sf-settings）。
 *
 * 安全边界（简化决策）：API Key 随设置明文存于 localStorage——浏览器形态下仅本机可读、
 * 且随浏览器配置漫游；正式桌面形态应改走 platform.secrets（Tauri 下为 OS keychain），
 * store 内只保留引用标记。当前为 WS-F 里程碑的简化实现。
 */

import { create } from 'zustand';
import { createId } from '@lemma/shared';
import type { Theme } from '../theme';

export type Language = 'zh' | 'en';
export type ProviderTier = 'cheap' | 'flagship';

export interface ProviderConfig {
  id: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  tier: ProviderTier;
}

export type ProviderInput = Omit<ProviderConfig, 'id'> & { id?: string };

/** Agent 引擎选择：auto = 有 API 配置用 API、否则 CLI；显式指定则锁定 */
export type AgentEngine = 'auto' | 'api' | 'cli';

/** LaTeX 编译引擎偏好（v2.0.0） */
export type LatexEnginePreference = 'auto' | 'tectonic' | 'lualatex' | 'xelatex' | 'pdflatex' | 'latexmk';

/** CLI agent 桥配置（v1.5.0：codex / claude / gemini 等本地 CLI 作为引擎） */
export interface CliAgentConfig {
  enabled: boolean;
  label: string;
  /** 可执行名或绝对路径（codex / claude / C:\Toolsgent.exe） */
  command: string;
  /** 参数模板，{prompt} 为提示词占位（exec "{prompt}" / -p {prompt}） */
  argsTemplate: string;
}

export const DEFAULT_CLI_AGENT: CliAgentConfig = {
  enabled: false,
  label: 'CLI Agent',
  command: 'codex',
  argsTemplate: 'exec {prompt}',
};

function coerceCliAgent(v: unknown): CliAgentConfig {
  if (!v || typeof v !== 'object') return { ...DEFAULT_CLI_AGENT };
  const o = v as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    label: typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : DEFAULT_CLI_AGENT.label,
    command: typeof o.command === 'string' ? o.command.trim().slice(0, 200) : DEFAULT_CLI_AGENT.command,
    argsTemplate:
      typeof o.argsTemplate === 'string' && o.argsTemplate.includes('{prompt}')
        ? o.argsTemplate
        : DEFAULT_CLI_AGENT.argsTemplate,
  };
}

export interface SettingsState {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  /** 语义嵌入模型名（可选，走当前激活服务的 /embeddings 端点；空则用本地哈希嵌入） */
  embeddingModel: string;
  theme: Theme;
  language: Language;
  addProvider(input: ProviderInput): void;
  updateProvider(id: string, patch: Partial<Omit<ProviderConfig, 'id'>>): void;
  removeProvider(id: string): void;
  setActive(id: string | null): void;
  setEmbeddingModel(model: string): void;
  /** Agent 引擎选择（auto/api/cli） */
  agentEngine: AgentEngine;
  setAgentEngine(engine: AgentEngine): void;
  /** CLI agent 桥配置 */
  cliAgent: CliAgentConfig;
  setCliAgent(patch: Partial<CliAgentConfig>): void;
  /** 保存后自动编译（Overleaf 式闭环；仅桌面真实引擎，浏览器模拟不触发） */
  autoCompile: boolean;
  setAutoCompile(on: boolean): void;
  /** LaTeX 引擎偏好 */
  enginePreference: LatexEnginePreference;
  setEnginePreference(pref: LatexEnginePreference): void;
  /** 实时预览（Live 模式：短防抖 + 平滑 PDF 刷新） */
  livePreview: boolean;
  setLivePreview(on: boolean): void;
  setTheme(theme: Theme): void;
  setLanguage(language: Language): void;
}

export const SETTINGS_STORAGE_KEY = 'sf-settings';

interface PersistedSettings {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  embeddingModel: string;
  theme: Theme;
  language: Language;
  agentEngine: AgentEngine;
  cliAgent: CliAgentConfig;
  autoCompile: boolean;
  enginePreference: LatexEnginePreference;
  livePreview: boolean;
}

function readPersisted(): PersistedSettings | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PersistedSettings>;
    if (!v || !Array.isArray(v.providers)) return null;
    return {
      providers: v.providers,
      activeProviderId: typeof v.activeProviderId === 'string' ? v.activeProviderId : null,
      embeddingModel: typeof v.embeddingModel === 'string' ? v.embeddingModel : '',
      // 亮色为默认主题；仅显式持久化过 'dark' 才回落暗色
      theme: v.theme === 'dark' ? 'dark' : 'light',
      language: v.language === 'en' ? 'en' : 'zh',
      agentEngine: v.agentEngine === 'api' || v.agentEngine === 'cli' ? v.agentEngine : 'auto',
      cliAgent: coerceCliAgent(v.cliAgent),
      autoCompile: v.autoCompile !== false, // 默认开
      enginePreference:
        v.enginePreference === 'tectonic' || v.enginePreference === 'lualatex' ||
        v.enginePreference === 'xelatex' || v.enginePreference === 'pdflatex' ||
        v.enginePreference === 'latexmk'
          ? v.enginePreference
          : 'auto',
      livePreview: v.livePreview !== false,
    };
  } catch {
    return null;
  }
}

const initial = readPersisted();

export const useSettingsStore = create<SettingsState>()((set) => ({
  providers: initial?.providers ?? [],
  activeProviderId: initial?.activeProviderId ?? null,
  embeddingModel: initial?.embeddingModel ?? '',
  theme: initial?.theme ?? 'light',
  language: initial?.language ?? 'zh',
  agentEngine: initial?.agentEngine ?? 'auto',
  autoCompile: initial?.autoCompile ?? true,
  enginePreference: initial?.enginePreference ?? 'auto',
  livePreview: initial?.livePreview ?? true,
  cliAgent: initial?.cliAgent ?? { ...DEFAULT_CLI_AGENT },

  addProvider(input) {
    set((s) => {
      const provider: ProviderConfig = { ...input, id: input.id ?? createId() };
      return {
        providers: [...s.providers, provider],
        activeProviderId: s.activeProviderId ?? provider.id,
      };
    });
  },

  updateProvider(id, patch) {
    set((s) => ({
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
    }));
  },

  removeProvider(id) {
    set((s) => ({
      providers: s.providers.filter((p) => p.id !== id),
      activeProviderId: s.activeProviderId === id ? null : s.activeProviderId,
    }));
  },

  setActive(id) {
    set((s) => ({ activeProviderId: id }));
  },

  setEmbeddingModel(model) {
    set({ embeddingModel: model });
  },

  setAgentEngine(agentEngine) {
    set({ agentEngine });
  },

  setCliAgent(patch) {
    set((s) => ({ cliAgent: { ...s.cliAgent, ...patch } }));
  },

  setAutoCompile(autoCompile) {
    set({ autoCompile });
  },

  setEnginePreference(enginePreference) {
    set({ enginePreference });
  },

  setLivePreview(livePreview) {
    set({ livePreview });
  },

  setTheme(theme) {
    set({ theme });
  },

  setLanguage(language) {
    set({ language });
  },
}));

useSettingsStore.subscribe((s) => {
  try {
    if (typeof localStorage !== 'undefined') {
      const snap: PersistedSettings = {
        providers: s.providers,
        activeProviderId: s.activeProviderId,
        embeddingModel: s.embeddingModel,
        theme: s.theme,
        language: s.language,
        agentEngine: s.agentEngine,
        cliAgent: s.cliAgent,
        autoCompile: s.autoCompile,
        enginePreference: s.enginePreference,
        livePreview: s.livePreview,
      };
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(snap));
    }
  } catch {
    /* 持久化失败不打断 UI */
  }
});

/** 读取当前持久化内容（测试与调试用）。 */
export function readPersistedSettings(): PersistedSettings | null {
  return readPersisted();
}
