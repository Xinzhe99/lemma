// @vitest-environment jsdom
/**
 * v5.2.0（借鉴 Prism）：
 *  - git.log / git.show agent 工具（执行器 + 注册表暴露）
 *  - imageToLatex 视觉转换（multimodal 请求体 / 围栏剥离 / 错误路径）
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Paper } from '@lemma/shared';

vi.mock('./platform/tauri', () => ({
  tauriProcRun: vi.fn(),
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
}));

import { createAppToolExecutor, ENABLED_TOOLS } from './agentTools';
import { imageToLatex } from './visionConvert';
import { useSettingsStore, type ProviderConfig } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';
import { useLibraryStore } from './state/libraryStore';
import { resetLibraryCaches } from './state/libraryStore';
import { tauriProcRun } from './platform/tauri';
import * as gitService from './git/gitService';

const provider: ProviderConfig = {
  id: 'v52',
  label: 'T',
  baseUrl: 'https://v.test/v1',
  apiKey: 'sk-t',
  model: 'glm-4v',
  tier: 'flagship',
};

async function run(tool: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const executor = createAppToolExecutor(vi.fn(async () => ({ approved: true, note: 'ok' })) as never);
  return (await executor.execute({ id: `c-${tool}`, tool, args })) as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetLibraryCaches();
  useWorkspaceStore.setState({ files: {}, compileLog: [] });
  useLibraryStore.setState({ papers: [] as Paper[], pdfAttachments: {} });
  useSettingsStore.setState({ providers: [], activeProviderId: null, embeddingModel: '' });
});

describe('git.log / git.show（AI 感知修订历史）', () => {
  it('已启用暴露给模型', () => {
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('git.log');
    expect(ENABLED_TOOLS.map((t) => t.name)).toContain('git.show');
  });

  it('git 不可用 → 诚实降级 ok:false', async () => {
    vi.spyOn(gitService, 'getGitAvailability').mockReturnValue('browser');
    const out = await run('git.log', {});
    expect(out.ok).toBe(false);
    expect(String(out.reason)).toContain('桌面');
  });

  it('git.log 返回提交列表', async () => {
    vi.spyOn(gitService, 'getGitAvailability').mockReturnValue('ok');
    vi.spyOn(gitService, 'gitLog').mockResolvedValue([
      { hash: 'h1', short: 'h1s', date: '2026-10-05T10:00:00+08:00', subject: 'AI: 修改稿件' },
    ]);
    const out = await run('git.log', { limit: 5 });
    expect(out.ok).toBe(true);
    expect(out.count).toBe(1);
    const commits = out.commits as Array<{ subject: string }>;
    expect(commits[0]!.subject).toBe('AI: 修改稿件');
  });

  it('git.show 聚合 --stat 与 diff（截断保护）', async () => {
    vi.spyOn(gitService, 'getGitAvailability').mockReturnValue('ok');
    vi.spyOn(gitService, 'ensureGitRepo').mockResolvedValue(true);
    (tauriProcRun as ReturnType<typeof vi.fn>).mockImplementation(
      async (_cmd: string, args: string[]) => {
        if (args.includes('--stat')) return { code: 0, stdout: 'h1s 2026-10-05 AI: 修改稿件\n main.tex | 2 +-', stderr: '' };
        return { code: 0, stdout: 'diff --git a/main.tex b/main.tex\n' + 'x'.repeat(7000), stderr: '' };
      },
    );
    const out = await run('git.show', { hash: 'h1s' });
    expect(out.ok).toBe(true);
    expect(String(out.stat)).toContain('main.tex');
    expect(String(out.diff)).toContain('已截断');
    expect(String(out.diff).length).toBeLessThan(6200);
  });

  it('git.show 缺 hash → 参数校验拦截（到不了执行体）', async () => {
    await expect(run('git.show', {})).rejects.toThrow('hash');
  });
});

describe('imageToLatex（Prism 图像转代码）', () => {
  it('未配置模型服务 → 明确错误', async () => {
    const r = await imageToLatex('data:image/png;base64,xxx');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('模型服务');
  });

  it('成功：multimodal 请求体 + 围栏剥离', async () => {
    useSettingsStore.setState({ providers: [provider], activeProviderId: 'v52' });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('https://v.test/v1/chat/completions');
      const body = JSON.parse(String(init?.body)) as {
        model: string;
        messages: Array<{ role: string; content: unknown }>;
      };
      expect(body.model).toBe('glm-4v');
      const user = body.messages[1]!;
      expect(Array.isArray(user.content)).toBe(true);
      const parts = user.content as Array<{ type: string; image_url?: { url: string } }>;
      expect(parts.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/'))).toBe(true);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '```latex\nE=mc^2\n```' } }] }),
      } as unknown as Response;
    });
    vi.stubGlobal('fetch', fetchMock);
    const r = await imageToLatex('data:image/png;base64,xxx', 'formula');
    expect(r.ok).toBe(true);
    expect(r.latex).toBe('E=mc^2');
    vi.unstubAllGlobals();
  });

  it('HTTP 400 → 提示换视觉模型', async () => {
    useSettingsStore.setState({ providers: [provider], activeProviderId: 'v52' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400 }) as unknown as Response),
    );
    const r = await imageToLatex('data:image/png;base64,xxx');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('视觉');
    vi.unstubAllGlobals();
  });
});
