// @vitest-environment jsdom
/**
 * v6.3.0 扎实轮：git 工作区卫生（忽略应用产物） + AI 用量记录补全。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const procMock = vi.hoisted(() => vi.fn());
vi.mock('./platform/tauri', () => ({
  tauriProcRun: procMock,
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
}));

import { detectGitAvailability, ensureGitRepo } from './git/gitService';
import { useAgentUsageStore } from './state/agentUsage';
import { useSettingsStore, type ProviderConfig } from './state/settingsStore';
import { imageToLatex } from './visionConvert';
import { tauriProcRun } from './platform/tauri';

function enableDesktop() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { invoke: vi.fn() };
}

const provider: ProviderConfig = {
  id: 'v63',
  label: 'T',
  baseUrl: 'https://v63.test/v1',
  apiKey: 'k',
  model: 'glm-4v',
  tier: 'flagship',
};

beforeEach(() => {
  vi.clearAllMocks();
  enableDesktop();
  procMock.mockImplementation(async (_c: string, args: string[]) => {
    if (args.join(' ').includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  void detectGitAvailability();
  useAgentUsageStore.setState({ events: [] });
});

describe('git 工作区卫生（应用产物不入库）', () => {
  it('.gitignore 包含 changes/sf-tikz-preview/sf-engine-warm', async () => {
    const writes: Array<[string, string]> = [];
    // 直接捕获 fs 写入：mock platform/types 的 getPlatform
    vi.doMock('./platform/types', () => ({
      getPlatform: () => ({
        kind: 'tauri',
        fs: {
          readFile: vi.fn(async () => ''),
          writeFile: async (p: string, c: string) => void writes.push([p, c]),
          deleteFile: vi.fn(async () => undefined),
        },
      }),
    }));
    vi.resetModules();
    const gs = await import('./git/gitService');
    await gs.detectGitAvailability();
    await gs.ensureGitRepo();
    const gi = writes.find(([p]) => p === '.gitignore');
    expect(gi).toBeTruthy();
    expect(gi![1]).toContain('changes.tex');
    expect(gi![1]).toContain('changes.pdf');
    expect(gi![1]).toContain('sf-tikz-preview.*');
    expect(gi![1]).toContain('sf-engine-warm.*');
    vi.doUnmock('./platform/types');
    vi.resetModules();
  });
});

describe('AI 用量记录补全', () => {
  it('imageToLatex 成功 → 记一条 tool 用量（含延迟）', async () => {
    useSettingsStore.setState({ providers: [provider], activeProviderId: 'v63' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({ ok: true, json: async () => ({ choices: [{ message: { content: 'E=mc^2' } }] }) }) as unknown as Response,
      ),
    );
    const r = await imageToLatex('data:image/png;base64,xxxx');
    expect(r.ok).toBe(true);
    const events = useAgentUsageStore.getState().events;
    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('tool');
    expect(events[0]!.model).toBe('glm-4v');
    expect(events[0]!.inputTokens).toBeGreaterThan(0);
    expect(events[0]!.latencyMs).toBeGreaterThanOrEqual(0);
    vi.unstubAllGlobals();
  });

  it('失败路径不记录（不产生脏用量）', async () => {
    useSettingsStore.setState({ providers: [provider], activeProviderId: 'v63' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response));
    await imageToLatex('data:image/png;base64,xxxx');
    expect(useAgentUsageStore.getState().events).toHaveLength(0);
    vi.unstubAllGlobals();
  });

  it('AgentUsageEvent 的 kind 联合含 chat（chat 记录类型合法）', async () => {
    useAgentUsageStore.getState().record({
      kind: 'chat',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 100,
    });
    expect(useAgentUsageStore.getState().events[0]!.kind).toBe('chat');
  });
});

void tauriProcRun;
