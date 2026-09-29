/**
 * 应用设置：模型服务 Provider、主题、语言。
 * 持久化到 localStorage（key: sf-settings）。
 *
 * 安全边界（简化决策）：API Key 随设置明文存于 localStorage——浏览器形态下仅本机可读、
 * 且随浏览器配置漫游；正式桌面形态应改走 platform.secrets（Tauri 下为 OS keychain），
 * store 内只保留引用标记。当前为 WS-F 里程碑的简化实现。
 */

import { create } from 'zustand';
import { createId } from '@scholarforge/shared';
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

export interface SettingsState {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  theme: Theme;
  language: Language;
  addProvider(input: ProviderInput): void;
  updateProvider(id: string, patch: Partial<Omit<ProviderConfig, 'id'>>): void;
  removeProvider(id: string): void;
  setActive(id: string | null): void;
  setTheme(theme: Theme): void;
  setLanguage(language: Language): void;
}

export const SETTINGS_STORAGE_KEY = 'sf-settings';

interface PersistedSettings {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  theme: Theme;
  language: Language;
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
      theme: v.theme === 'light' ? 'light' : 'dark',
      language: v.language === 'en' ? 'en' : 'zh',
    };
  } catch {
    return null;
  }
}

const initial = readPersisted();

export const useSettingsStore = create<SettingsState>()((set) => ({
  providers: initial?.providers ?? [],
  activeProviderId: initial?.activeProviderId ?? null,
  theme: initial?.theme ?? 'dark',
  language: initial?.language ?? 'zh',

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
        theme: s.theme,
        language: s.language,
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
