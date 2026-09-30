import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

function reset() {
  useWorkspaceStore.setState({
    projectName: '',
    entry: '',
    files: {},
    openTabs: [],
    activeTab: null,
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
}

describe('workspaceStore 快照', () => {
  beforeEach(reset);

  it('快照 → 修改 → 恢复', () => {
    const ws = useWorkspaceStore.getState();
    ws.createFile('main.tex', 'v1');
    ws.snapshotFile('main.tex', 'AI 润色前的快照');
    ws.updateFile('main.tex', 'v2');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('v2');

    useWorkspaceStore.getState().restoreSnapshot('main.tex', 0);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('v1');
    // 快照列表保留（可再次恢复/查看）
    expect(useWorkspaceStore.getState().snapshots['main.tex']).toHaveLength(1);
  });

  it('每文件最多保留 20 份，最新在前', () => {
    const ws = useWorkspaceStore.getState();
    ws.createFile('a.tex', '0');
    for (let i = 1; i <= 25; i++) {
      useWorkspaceStore.getState().snapshotFile('a.tex', `snap-${i}`);
    }
    const list = useWorkspaceStore.getState().snapshots['a.tex']!;
    expect(list).toHaveLength(20);
    expect(list[0]!.label).toBe('snap-25');
    expect(list[19]!.label).toBe('snap-6');
  });

  it('不存在的文件不能快照；不存在的快照不能恢复', () => {
    useWorkspaceStore.getState().snapshotFile('missing.tex', 'x');
    expect(useWorkspaceStore.getState().snapshots['missing.tex']).toBeUndefined();

    const ws = useWorkspaceStore.getState();
    ws.createFile('b.tex', 'content');
    useWorkspaceStore.getState().restoreSnapshot('b.tex', 99);
    expect(useWorkspaceStore.getState().files['b.tex']).toBe('content');
  });

  it('删除文件时清理其快照；重命名时迁移快照', () => {
    const ws = useWorkspaceStore.getState();
    ws.createFile('old.tex', 'x');
    useWorkspaceStore.getState().snapshotFile('old.tex', 's1');

    useWorkspaceStore.getState().renameFile('old.tex', 'new.tex');
    expect(useWorkspaceStore.getState().snapshots['new.tex']).toHaveLength(1);
    expect(useWorkspaceStore.getState().snapshots['old.tex']).toBeUndefined();

    useWorkspaceStore.getState().deleteFile('new.tex');
    expect(useWorkspaceStore.getState().snapshots['new.tex']).toBeUndefined();
  });
});
