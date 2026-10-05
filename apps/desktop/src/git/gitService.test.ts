// @vitest-environment jsdom
/**
 * v5.0.0 内置 git：自动提交防抖合并 / 可用性探测 / 无 git 环境的诚实降级。
 * proc_run 经 platform mock 注入（不起真进程）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// platform 桥 mock：proc_run 可编程应答
const procMock = vi.hoisted(() => vi.fn());
vi.mock('../platform/tauri', () => ({
  tauriProcRun: procMock,
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
}));
vi.mock('../platform/types', () => ({
  getPlatform: () => ({
    fs: {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => undefined),
    },
  }),
}));

import {
  detectGitAvailability,
  getGitAvailability,
  gitCommitAll,
  gitLog,
  scheduleAutoCommit,
  setAutoCommitEnabled,
} from './gitService';
import { useWorkspaceStore } from '../state/workspaceStore';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function enableDesktopWindow() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { invoke: vi.fn() };
}

beforeEach(() => {
  vi.clearAllMocks();
  setAutoCommitEnabled(true);
  useWorkspaceStore.setState({ files: { 'main.tex': '\\documentclass{article}' } });
});

afterEach(() => {
  delete (window as unknown as { __TAURI__?: unknown }).__TAURI__;
  setAutoCommitEnabled(false);
});

describe('git 可用性', () => {
  it('浏览器形态（无 __TAURI__）→ browser', async () => {
    expect(await detectGitAvailability()).toBe('browser');
  });

  it('桌面形态 + git --version 正常 → ok', async () => {
    enableDesktopWindow();
    procMock.mockResolvedValueOnce({ code: 0, stdout: 'git version 2.43.0', stderr: '' });
    expect(await detectGitAvailability()).toBe('ok');
  });

  it('桌面形态但无 git → missing', async () => {
    enableDesktopWindow();
    procMock.mockRejectedValueOnce(new Error('无法启动命令 git'));
    expect(await detectGitAvailability()).toBe('missing');
  });
});

describe('自动提交（防抖合并）', () => {
  it('桌面 + git 可用：连续多次 schedule 合并为一次 commit', async () => {
    enableDesktopWindow();
    procMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
      if (joined.includes('rev-parse')) return { code: 0, stdout: 'true', stderr: '' };
      if (joined.startsWith('commit')) return { code: 0, stdout: '[main abc123] ok', stderr: '' };
      if (joined.startsWith('log')) {
        return { code: 0, stdout: 'abc123def|abc123d|2026-10-05T10:00:00+08:00|AI: 修改稿件 + 添加引用 x', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    await detectGitAvailability();
    expect(getGitAvailability()).toBe('ok');

    scheduleAutoCommit('修改稿件');
    scheduleAutoCommit('添加引用 vaswani2017attention');
    scheduleAutoCommit('修改稿件');
    await sleep(2600); // 防抖 2s

    const commitCalls = procMock.mock.calls.filter(
      ([, a]) => (a as string[]).includes('commit') && (a as string[]).includes('-m'),
    );
    expect(commitCalls).toHaveLength(1);
    const msg = (commitCalls[0]![1] as string[]).join(' ');
    expect(msg).toContain('修改稿件 + 添加引用');
  });

  it('无变更（nothing to commit）→ 返回 null 不抛错', async () => {
    enableDesktopWindow();
    procMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
      if (joined.includes('rev-parse')) return { code: 0, stdout: 'true', stderr: '' };
      if (joined.startsWith('commit')) {
        return { code: 1, stdout: '', stderr: 'nothing to commit, working tree clean' };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    await detectGitAvailability();
    const r = await gitCommitAll();
    expect(r).toBeNull();
  });

  it('gitLog 解析 %H|%h|%ad|%s 行', async () => {
    enableDesktopWindow();
    procMock.mockImplementation(async (_cmd: string, args: string[]) => {
      const joined = args.join(' ');
      if (joined.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
      if (joined.includes('rev-parse')) return { code: 0, stdout: 'true', stderr: '' };
      if (joined.startsWith('log')) {
        return {
          code: 0,
          stdout: 'fullhash1|short1|2026-10-05T10:00:00+08:00|AI: 修改稿件\nfullhash2|short2|2026-10-04T09:00:00+08:00|初始提交',
          stderr: '',
        };
      }
      return { code: 0, stdout: '', stderr: '' };
    });
    await detectGitAvailability();
    const log = await gitLog(10);
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ hash: 'fullhash1', short: 'short1', subject: 'AI: 修改稿件' });
  });
});
