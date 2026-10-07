// @vitest-environment jsdom
/**
 * v6.9.0 review 修复回归：gitPull 工作树回读（数据丢失）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const procMock = vi.hoisted(() => vi.fn());
const diskFiles = vi.hoisted(() => new Map<string, string>());
vi.mock('./platform/tauri', () => ({
  createTauriPlatform: () => null,
  tauriProcRun: procMock,
  tauriReadBase64: vi.fn(),
  tauriWrite: vi.fn(),
  tauriWriteFileBase64: vi.fn(),
}));
vi.mock('./platform/types', () => ({
  getPlatform: () => ({
    kind: 'tauri',
    fs: {
      readFile: vi.fn(async (p: string) => diskFiles.get(p) ?? ''),
      writeFile: vi.fn(async (p: string, c: string) => void diskFiles.set(p, c)),
      deleteFile: vi.fn(async () => undefined),
    },
  }),
}));

import { detectGitAvailability, gitPull } from './git/gitService';
import { useWorkspaceStore } from './state/workspaceStore';

beforeEach(async () => {
  vi.clearAllMocks();
  diskFiles.clear();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = { invoke: vi.fn() };
  procMock.mockImplementation(async (_c: string, args: string[]) => {
    const j = args.join(' ');
    if (j.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
    if (j.includes('ls-tree')) return { code: 0, stdout: 'main.tex', stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  });
  await detectGitAvailability();
  diskFiles.set('main.tex', 'REMOTE+LOCAL merged content');
});

describe('gitPull 工作树回读（v6.9.0 数据丢失修复）', () => {
  it('回读磁盘工作树内容（含未提交本地改动），而非 HEAD 提交内容', async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'LOCAL uncommitted edit' }, projectName: 'p' });
    // 模拟 pull 的合并效果：物化（store→盘）后，远端改动合入工作树
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      const j = args.join(' ');
      if (j.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
      if (args.includes('pull')) {
        diskFiles.set('main.tex', (diskFiles.get('main.tex') ?? '') + '+REMOTE');
        return { code: 0, stdout: 'Fast-forward', stderr: '' };
      }
      if (j.includes('ls-tree')) return { code: 0, stdout: 'main.tex', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    await gitPull();
    // 工作树 = 物化的本地编辑 + 远端合并 → 本地编辑不丢
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('LOCAL uncommitted edit+REMOTE');
  });

  it('pull 被拒（冲突）→ 抛错且 store 不被触碰', async () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'KEEP ME' }, projectName: 'p' });
    procMock.mockImplementation(async (_c: string, args: string[]) => {
      const j = args.join(' ');
      if (j.includes('--version')) return { code: 0, stdout: 'git version 2.43', stderr: '' };
      if (args.includes('pull')) return { code: 1, stdout: '', stderr: 'Your local changes would be overwritten' };
      if (args[0] === 'merge') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    });
    await expect(gitPull()).rejects.toThrow('pull 失败');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('KEEP ME');
  });

  it('新文件（store 没有的）从工作树创建', async () => {
    useWorkspaceStore.setState({ files: {}, projectName: 'p' });
    diskFiles.set('main.tex', 'new from remote');
    await gitPull();
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('new from remote');
  });
});
