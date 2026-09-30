import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// 持久化写盘改为可控挂起：手动放行以确定性验证 dirty 生命周期（成功回调）。
const pendingWrites = vi.hoisted(() => [] as (() => void)[]);
vi.mock('../platform/types', () => ({
  getPlatform: () => ({
    kind: 'browser' as const,
    fs: {
      async readFile() {
        throw new Error('测试环境无快照');
      },
      writeFile() {
        return new Promise<void>((resolve) => {
          pendingWrites.push(resolve);
        });
      },
      async deleteFile() {},
      async list() {
        return [];
      },
    },
    secrets: {
      async get() {
        return undefined;
      },
      async set() {},
    },
  }),
}));

function reset() {
  useWorkspaceStore.setState({
    projectName: '',
    entry: '',
    files: {},
    openTabs: [],
    activeTab: null,
    compileLog: [],
    compileStatus: 'idle',
    dirty: false,
    lastSavedAt: null,
  });
}

/** 等待防抖（300ms）定时器与微任务链：写盘发起 → 成功回调入队执行 */
const afterDebounce = () => new Promise((r) => setTimeout(r, 350));

function flushWrites() {
  pendingWrites.splice(0).forEach((resolve) => resolve());
}

beforeEach(reset);

describe('workspaceStore.loadDemoProject', () => {
  it('内置演示项目文件齐全且结构正确', () => {
    useWorkspaceStore.getState().loadDemoProject();
    const s = useWorkspaceStore.getState();
    expect(Object.keys(s.files).sort()).toEqual(
      ['README.md', 'main.tex', 'refs.bib', 'sections/intro.tex', 'sections/method.tex'].sort(),
    );
    expect(s.entry).toBe('main.tex');
    expect(s.projectName).toBe('demo-paper');
    expect(s.files['main.tex']).toContain('\\input{sections/intro}');
    expect(s.files['main.tex']).toContain('\\input{sections/method}');
    expect(s.files['refs.bib']).toMatch(/@inproceedings\{vaswani2017attention/);
    expect((s.files['refs.bib'].match(/@/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s.openTabs).toEqual(['main.tex']);
    expect(s.activeTab).toBe('main.tex');
  });
});

describe('workspaceStore tabs 一致性', () => {
  beforeEach(() => useWorkspaceStore.getState().loadDemoProject());

  it('openFile 追加标签并置为 active，重复打开不重复追加', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.openFile('sections/method.tex');
    s.openFile('sections/intro.tex');
    const st = useWorkspaceStore.getState();
    expect(st.openTabs).toEqual(['main.tex', 'sections/intro.tex', 'sections/method.tex']);
    expect(st.activeTab).toBe('sections/intro.tex');
  });

  it('closeTab 关闭非活动标签不影响 activeTab；关闭活动标签则切换到邻近标签', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.openFile('sections/method.tex');
    s.closeTab('sections/intro.tex');
    expect(useWorkspaceStore.getState().activeTab).toBe('sections/method.tex');
    expect(useWorkspaceStore.getState().openTabs).toEqual(['main.tex', 'sections/method.tex']);
    s.closeTab('main.tex');
    expect(useWorkspaceStore.getState().activeTab).toBe('sections/method.tex');
  });

  it('关闭最后一个标签后 activeTab 为 null', () => {
    const s = useWorkspaceStore.getState();
    s.closeTab('main.tex');
    const st = useWorkspaceStore.getState();
    expect(st.openTabs).toEqual([]);
    expect(st.activeTab).toBeNull();
  });

  it('renameFile 同步维护 openTabs 与 activeTab', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.renameFile('sections/intro.tex', 'sections/introduction.tex');
    const st = useWorkspaceStore.getState();
    expect(st.files['sections/introduction.tex']).toBeTruthy();
    expect(st.files['sections/intro.tex']).toBeUndefined();
    expect(st.openTabs).toEqual(['main.tex', 'sections/introduction.tex']);
    expect(st.activeTab).toBe('sections/introduction.tex');
  });

  it('deleteFile 移除文件与标签并修正 activeTab', () => {
    const s = useWorkspaceStore.getState();
    s.openFile('sections/intro.tex');
    s.deleteFile('sections/intro.tex');
    const st = useWorkspaceStore.getState();
    expect(st.files['sections/intro.tex']).toBeUndefined();
    expect(st.openTabs).toEqual(['main.tex']);
    expect(st.activeTab).toBe('main.tex');
  });

  it('createFile 创建并打开；对已存在文件不覆盖内容', () => {
    const s = useWorkspaceStore.getState();
    s.createFile('notes.md', '# 新笔记');
    let st = useWorkspaceStore.getState();
    expect(st.files['notes.md']).toBe('# 新笔记');
    expect(st.activeTab).toBe('notes.md');
    s.createFile('notes.md', '# 应被忽略');
    st = useWorkspaceStore.getState();
    expect(st.files['notes.md']).toBe('# 新笔记');
    expect(st.openTabs.filter((p) => p === 'notes.md')).toHaveLength(1);
  });

  it('updateFile 修改内容，未知路径不生效', () => {
    const s = useWorkspaceStore.getState();
    s.updateFile('main.tex', 'new content');
    expect(useWorkspaceStore.getState().files['main.tex']).toBe('new content');
    s.updateFile('ghost.tex', 'x');
    expect(useWorkspaceStore.getState().files['ghost.tex']).toBeUndefined();
  });
});

describe('workspaceStore 编译日志', () => {
  it('appendCompileLog 逐行追加，clearCompileLog 清空，setCompileStatus 更新状态', () => {
    const s = useWorkspaceStore.getState();
    s.appendCompileLog('line 1');
    s.appendCompileLog('line 2');
    expect(useWorkspaceStore.getState().compileLog).toEqual(['line 1', 'line 2']);
    s.setCompileStatus('running');
    expect(useWorkspaceStore.getState().compileStatus).toBe('running');
    s.clearCompileLog();
    expect(useWorkspaceStore.getState().compileLog).toEqual([]);
    s.setCompileStatus('ok');
    expect(useWorkspaceStore.getState().compileStatus).toBe('ok');
  });
});

describe('workspaceStore 保存状态（dirty 生命周期）', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().loadDemoProject();
    useWorkspaceStore.setState({ dirty: false, lastSavedAt: null });
  });

  it('updateFile 置 dirty=true（未知路径不置位）', () => {
    useWorkspaceStore.getState().updateFile('main.tex', 'dirty 生命周期 v1');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    useWorkspaceStore.getState().updateFile('ghost.tex', 'x');
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('持久化写盘成功后 dirty=false 并记录 lastSavedAt', async () => {
    useWorkspaceStore.getState().updateFile('main.tex', 'dirty 生命周期 v1');
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    await afterDebounce(); // 300ms 防抖结束，写盘发起（挂起）
    flushWrites(); // 写盘成功回调
    await afterDebounce(); // 让成功回调的微任务链执行完

    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('写盘在途时的新编辑不会被误标已保存（快照一致性守卫）', async () => {
    useWorkspaceStore.getState().updateFile('main.tex', '在途守卫 v1');
    await afterDebounce(); // W1 发起
    useWorkspaceStore.getState().updateFile('main.tex', '在途守卫 v2'); // W1 在途时再编辑

    flushWrites(); // W1 成功，但当前内容已是 v2
    await afterDebounce();
    expect(useWorkspaceStore.getState().dirty).toBe(true);

    await afterDebounce(); // 新防抖结束，W2 发起
    flushWrites();
    await afterDebounce();
    const s = useWorkspaceStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.lastSavedAt).not.toBeNull();
  });

  it('loadDemoProject / loadProject 重置 dirty 与 lastSavedAt', () => {
    useWorkspaceStore.setState({ dirty: true, lastSavedAt: 123 });
    useWorkspaceStore.getState().loadDemoProject();
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().lastSavedAt).toBeNull();

    useWorkspaceStore.setState({ dirty: true, lastSavedAt: 123 });
    useWorkspaceStore.getState().loadProject('p', 'main.tex', { 'main.tex': 'x' });
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    expect(useWorkspaceStore.getState().lastSavedAt).toBeNull();
  });
});
