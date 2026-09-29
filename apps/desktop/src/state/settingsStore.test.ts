// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { SETTINGS_STORAGE_KEY, readPersistedSettings, useSettingsStore } from './settingsStore';

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({
    providers: [],
    activeProviderId: null,
    theme: 'dark',
    language: 'zh',
  });
});

describe('settingsStore Provider CRUD', () => {
  it('addProvider 生成 id 并默认激活首个服务', () => {
    useSettingsStore.getState().addProvider({
      label: 'GLM',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-1',
      model: 'glm-4.6',
      tier: 'flagship',
    });
    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(1);
    expect(s.providers[0]!.id).toBeTruthy();
    expect(s.activeProviderId).toBe(s.providers[0]!.id);
  });

  it('updateProvider 只改目标服务', () => {
    useSettingsStore.getState().addProvider({ label: 'A', baseUrl: 'u1', apiKey: 'k1', model: 'm1', tier: 'cheap' });
    useSettingsStore.getState().addProvider({ label: 'B', baseUrl: 'u2', apiKey: 'k2', model: 'm2', tier: 'flagship' });
    const idA = useSettingsStore.getState().providers[0]!.id;
    useSettingsStore.getState().updateProvider(idA, { model: 'm1-new', tier: 'flagship' });
    const s = useSettingsStore.getState();
    expect(s.providers[0]!.model).toBe('m1-new');
    expect(s.providers[0]!.tier).toBe('flagship');
    expect(s.providers[1]!.model).toBe('m2');
  });

  it('removeProvider 删除服务；删除激活服务时清空激活', () => {
    useSettingsStore.getState().addProvider({ label: 'A', baseUrl: 'u', apiKey: 'k', model: 'm', tier: 'cheap' });
    const id = useSettingsStore.getState().providers[0]!.id;
    useSettingsStore.getState().removeProvider(id);
    const s = useSettingsStore.getState();
    expect(s.providers).toHaveLength(0);
    expect(s.activeProviderId).toBeNull();
  });

  it('setActive 切换激活', () => {
    useSettingsStore.getState().addProvider({ label: 'A', baseUrl: 'u', apiKey: 'k', model: 'm', tier: 'cheap' });
    useSettingsStore.getState().addProvider({ label: 'B', baseUrl: 'u', apiKey: 'k', model: 'm', tier: 'cheap' });
    const [, b] = useSettingsStore.getState().providers;
    useSettingsStore.getState().setActive(b!.id);
    expect(useSettingsStore.getState().activeProviderId).toBe(b!.id);
  });
});

describe('settingsStore localStorage 持久化', () => {
  it('CRUD 后 round-trip 恢复一致', () => {
    useSettingsStore.getState().addProvider({ label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-x', model: 'deepseek-chat', tier: 'cheap' });
    useSettingsStore.getState().setTheme('light');
    useSettingsStore.getState().setLanguage('en');

    const persisted = readPersistedSettings();
    expect(persisted).not.toBeNull();
    expect(persisted!.providers).toEqual(useSettingsStore.getState().providers);
    expect(persisted!.theme).toBe('light');
    expect(persisted!.language).toBe('en');

    // localStorage 原始内容亦为合法 JSON 快照
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!);
    expect(raw.providers).toHaveLength(1);
    expect(raw.providers[0].apiKey).toBe('sk-x');
  });
});
