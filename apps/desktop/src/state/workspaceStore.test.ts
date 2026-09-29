import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

function reset() {
  useWorkspaceStore.setState({
    projectName: '',
    entry: '',
    files: {},
    openTabs: [],
    activeTab: null,
    compileLog: [],
    compileStatus: 'idle',
  });
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
