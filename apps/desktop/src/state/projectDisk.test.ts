// @vitest-environment jsdom
/**
 * projectDisk 单测（项目 ↔ 本地磁盘目录的桥）：
 * - materializeProjectToDisk：逐文件写入（fs_write_absolute 桥）；figures/ 空串占位与
 *   非字符串跳过（真实图片不落盘覆盖）；
 * - probeDirWritable：写探针 + 删除；写失败抛错；清理失败不判死；
 * - syncProjectFromDisk：磁盘有而记录无 → 并入；磁盘 mtime 比记录新 → 以磁盘为准；
 *   非文本扩展名 / 无 dir / 浏览器形态 / 扫描失败 → 不动工作区；
 * - openProjectWithDiskSync：openProject + 目录同步的组合；未知 id 返回 opened:false。
 * platform/tauri 桥整体 mock；platform/types 按用例切换 tauri/browser 形态。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformKind = vi.hoisted(() => ({ kind: 'tauri' as 'tauri' | 'browser' }));
const bridges = vi.hoisted(() => ({
  write: vi.fn(async (_dir: string, _rel: string, _content: string) => {}),
  read: vi.fn(async (_dir: string, _rel: string) => ''),
  scan: vi.fn(async (_dir: string) => [] as Array<{ path: string; mtimeMs: number }>),
  del: vi.fn(async (_dir: string, _rel: string) => {}),
}));

vi.mock('../platform/tauri', () => ({
  tauriWriteProjectFile: bridges.write,
  tauriReadProjectFile: bridges.read,
  tauriScanProjectDir: bridges.scan,
  tauriDeleteProjectFile: bridges.del,
  tauriPickDirectory: vi.fn(),
  tauriProcRun: vi.fn(),
  tauriReadBase64: vi.fn(),
  tauriWriteFileBase64: vi.fn(),
  base64ToBytes: vi.fn(),
  createTauriPlatform: () => null,
}));

vi.mock('../platform/types', () => ({
  getPlatform: () =>
    platformKind.kind === 'tauri'
      ? { kind: 'tauri' as const, fs: {}, secrets: { get: async () => undefined, set: async () => {} } }
      : {
          kind: 'browser' as const,
          fs: { readFile: async () => '', writeFile: async () => {}, deleteFile: async () => {}, list: async () => [] },
          secrets: { get: async () => undefined, set: async () => {} },
        },
}));

import {
  materializeProjectToDisk,
  openProjectWithDiskSync,
  probeDirWritable,
  syncProjectFromDisk,
} from './projectDisk';
import { useProjectsStore } from './projectsStore';
import { useWorkspaceStore } from './workspaceStore';

beforeEach(() => {
  platformKind.kind = 'tauri';
  bridges.write.mockClear();
  bridges.read.mockClear();
  bridges.scan.mockClear();
  bridges.del.mockClear();
  useWorkspaceStore.setState({
    projectName: 'p',
    entry: 'main.tex',
    files: { 'main.tex': 'v1' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    projectDir: null,
  });
  useProjectsStore.setState({ projects: [] });
});

describe('materializeProjectToDisk 物化', () => {
  it('逐文件写入文本；figures/ 空串占位与非字符串跳过；返回写入数', async () => {
    const count = await materializeProjectToDisk('D:\\p', {
      'main.tex': 'a',
      'sections/intro.tex': 'b',
      'figures/x.png': '', // initWorkspace 的二进制占位：不写（避免覆盖真实图片）
      'figures/y.png': undefined as unknown as string, // 非字符串：防御性跳过
      'empty.tex': '', // 用户真实空文件：照写
    });
    expect(count).toBe(3);
    expect(bridges.write).toHaveBeenCalledWith('D:\\p', 'main.tex', 'a');
    expect(bridges.write).toHaveBeenCalledWith('D:\\p', 'sections/intro.tex', 'b');
    expect(bridges.write).toHaveBeenCalledWith('D:\\p', 'empty.tex', '');
    expect(bridges.write).not.toHaveBeenCalledWith('D:\\p', 'figures/x.png', '');
  });
});

describe('probeDirWritable 写探针', () => {
  it('写入成功并清理探针；清理失败不判死；写入失败向上抛错', async () => {
    await probeDirWritable('D:\\p');
    expect(bridges.write).toHaveBeenCalledWith('D:\\p', '.lemma-write-probe.tmp', 'probe');
    expect(bridges.del).toHaveBeenCalledWith('D:\\p', '.lemma-write-probe.tmp');

    bridges.del.mockRejectedValueOnce(new Error('删除失败'));
    await expect(probeDirWritable('D:\\p')).resolves.toBeUndefined(); // 目录可写即通过

    bridges.write.mockRejectedValueOnce(new Error('不可写'));
    await expect(probeDirWritable('D:\\p')).rejects.toThrow('不可写');
  });
});

describe('syncProjectFromDisk 磁盘同步', () => {
  it('磁盘有而记录无 → 并入；磁盘更新（mtime > savedAt）→ 以磁盘为准', async () => {
    bridges.scan.mockResolvedValue([
      { path: 'main.tex', mtimeMs: 2000 }, // 比记录新
      { path: 'refs.bib', mtimeMs: 2000 }, // 磁盘有而记录无
      { path: 'main.tex.bak', mtimeMs: 3000 }, // 非文本扩展名：忽略
      { path: 'old.tex', mtimeMs: 500 }, // 比记录旧且记录里没有：仍并入（简单策略）
    ]);
    bridges.read.mockImplementation(async (_dir: string, rel: string) => `disk(${rel})`);

    const res = await syncProjectFromDisk('D:\\p', 1000);
    expect(res).toEqual({ merged: ['refs.bib', 'old.tex'], updated: ['main.tex'] });
    const files = useWorkspaceStore.getState().files;
    expect(files['main.tex']).toBe('disk(main.tex)');
    expect(files['refs.bib']).toBe('disk(refs.bib)');
    expect(files['old.tex']).toBe('disk(old.tex)');
    expect(files['main.tex.bak']).toBeUndefined();
  });

  it('记录比磁盘新 / 磁盘无变化：不读不改', async () => {
    bridges.scan.mockResolvedValue([{ path: 'main.tex', mtimeMs: 500 }]);
    const res = await syncProjectFromDisk('D:\\p', 1000);
    expect(res).toEqual({ merged: [], updated: [] });
    expect(bridges.read).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('v1');
  });

  it('无 dir / 浏览器形态 / 扫描失败 → 返回 null 且不动工作区', async () => {
    expect(await syncProjectFromDisk(null, 1)).toBeNull();
    expect(await syncProjectFromDisk(undefined, 1)).toBeNull();

    platformKind.kind = 'browser';
    expect(await syncProjectFromDisk('D:\\p', 1)).toBeNull();

    platformKind.kind = 'tauri';
    bridges.scan.mockRejectedValueOnce(new Error('目录不存在'));
    expect(await syncProjectFromDisk('D:\\p', 1)).toBeNull();
    expect(useWorkspaceStore.getState().files).toEqual({ 'main.tex': 'v1' });
  });
});

describe('openProjectWithDiskSync 组合', () => {
  it('打开记录（恢复目录绑定）后与磁盘同步合并；未知 id 返回 opened:false', async () => {
    useProjectsStore.setState({
      projects: [
        {
          id: 'p1',
          name: '论文A',
          savedAt: 1000,
          dir: 'D:\\p',
          snapshot: {
            projectName: '论文A',
            entry: 'main.tex',
            files: { 'main.tex': 'rec' },
            openTabs: ['main.tex'],
            activeTab: 'main.tex',
            snapshots: {},
          },
        },
      ],
    });
    bridges.scan.mockResolvedValue([{ path: 'extra.tex', mtimeMs: 999 }]);
    bridges.read.mockResolvedValue('disk content');

    const res = await openProjectWithDiskSync('p1');
    expect(res).toEqual({ opened: true, sync: { merged: ['extra.tex'], updated: [] } });
    const ws = useWorkspaceStore.getState();
    expect(ws.projectName).toBe('论文A');
    expect(ws.projectDir).toBe('D:\\p');
    expect(ws.files['extra.tex']).toBe('disk content');

    expect(await openProjectWithDiskSync('missing')).toEqual({ opened: false });
  });
});
