// @vitest-environment jsdom
/**
 * v5.7.0 新能力测试：
 *  - gitService：gitShowCommit / gitSetRemote 校验 / gitPush 首推 -u
 *  - annotationStore：setResolved 勾销
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const procMock = vi.hoisted(() => vi.fn());
vi.mock('./platform/tauri', () => ({
  createTauriPlatform: () => null,
  tauriProcRun: procMock,
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
}));
vi.mock('./platform/types', () => ({
  getPlatform: () => ({
    kind: 'tauri',
    fs: {
      readFile: vi.fn(async () => ''),
      writeFile: vi.fn(async () => undefined),
      deleteFile: vi.fn(async () => undefined),
    },
  }),
}));

import {
  detectGitAvailability,
  gitShowCommit,
  gitSetRemote,
  gitPush,
  setAutoCommitEnabled,
} from './git/gitService';
import { useAnnotationStore } from './state/annotationStore';
import type { Annotation } from '@lemma/shared';

function enableDesktop() {
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { invoke: vi.fn() };
}

function ok(out = '') {
  return { code: 0, stdout: out, stderr: '' };
}

function makeAnnotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    paperId: 'p1',
    page: 2,
    kind: 'highlight',
    quotedText: '原文',
    text: '这里要改',
    createdAt: 1,
    ...over,
  };
}

beforeEach(async () => {
  vi.clearAllMocks();
  setAutoCommitEnabled(false);
  enableDesktop();
  // 可用性探测：默认 mock 的任意调用都成功 → git 可用
  procMock.mockImplementation(async (_c: string, args: string[]) => {
    if (args.join(' ').includes('--version')) return ok('git version 2.43.0');
    return ok();
  });
  await detectGitAvailability();
});

describe('gitShowCommit（提交差异）', () => {
  it('聚合 --stat 与 patch，超长截断', async () => {
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      if (args.includes('--stat')) return ok('h1s 2026-10-06 AI: 修改稿件\n main.tex | 2 +-');
      return ok('diff --git a/main.tex b/main.tex\n' + 'x'.repeat(9000));
    });
    // 可用性直改（避免探测链）
    const r = await gitShowCommit('h1s');
    expect(r.stat).toContain('main.tex');
    expect(r.diff).toContain('已截断');
  });

  it('git show 失败 → 抛错', async () => {
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      if (args.includes('--stat')) return { code: 128, stdout: '', stderr: 'bad object' };
      return ok('');
    });
    await expect(gitShowCommit('zzz')).rejects.toThrow('git show');
  });
});

describe('gitSetRemote / gitPush（GitHub 同步）', () => {
  it('非法 URL 拒绝', async () => {
    await expect(gitSetRemote('ftp://x')).rejects.toThrow('https');
  });

  it('已有 origin → set-url', async () => {
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      if (args.join(' ').includes('get-url')) return ok('https://old');
      if (args.join(' ').includes('set-url')) {
        expect(args[args.length - 1]).toBe('https://github.com/u/r.git');
        return ok();
      }
      return ok();
    });
    expect(await gitSetRemote('https://github.com/u/r.git')).toBe(true);
  });

  it('push：无上游 → push -u origin HEAD', async () => {
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      const j = args.join(' ');
      if (j.includes('--version')) return ok('git version 2.43');
      if (j.includes('rev-parse') && j.includes('@{u}')) return { code: 128, stdout: '', stderr: 'no upstream' };
      if (args[0] === 'push') {
        expect(args).toEqual(['push', '-u', 'origin', 'HEAD']);
        return ok('branch created');
      }
      return ok();
    });
    const out = await gitPush();
    expect(out).toContain('branch created');
  });
});

describe('annotationStore.setResolved（审阅勾销）', () => {
  it('勾销与恢复（幂等）', () => {
    const store = useAnnotationStore.getState();
    useAnnotationStore.setState({ byFile: { 'paper:p1': [makeAnnotation()] } });
    store.setResolved('paper:p1', 'a1', true);
    expect(useAnnotationStore.getState().byFile['paper:p1']![0]!.resolved).toBe(true);
    store.setResolved('paper:p1', 'a1', true);
    expect(useAnnotationStore.getState().byFile['paper:p1']![0]!.resolved).toBe(true);
    store.setResolved('paper:p1', 'a1', false);
    expect(useAnnotationStore.getState().byFile['paper:p1']![0]!.resolved).toBe(false);
  });

  it('键不存在 → 不抛错不变更', () => {
    expect(() => useAnnotationStore.getState().setResolved('nope', 'x', true)).not.toThrow();
  });
});
