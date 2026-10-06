// @vitest-environment jsdom
/**
 * v7.2.1 F2：编辑器分屏——uiStore 状态切换 + EditorArea lockedFile 语义。
 */
import { describe, expect, it } from 'vitest';
import { useUiStore } from './state/uiStore';
import { useWorkspaceStore } from './state/workspaceStore';

describe('uiStore splitEditorTab（分屏状态）', () => {
  it('初始为 null（不分屏）', () => {
    expect(useUiStore.getState().splitEditorTab).toBeNull();
  });

  it('setSplitEditorTab 设置/清除', () => {
    useUiStore.getState().setSplitEditorTab('sections/method.tex');
    expect(useUiStore.getState().splitEditorTab).toBe('sections/method.tex');
    useUiStore.getState().setSplitEditorTab(null);
    expect(useUiStore.getState().splitEditorTab).toBeNull();
  });

  it('重复设置同一值幂等', () => {
    useUiStore.getState().setSplitEditorTab('a.tex');
    useUiStore.getState().setSplitEditorTab('a.tex');
    expect(useUiStore.getState().splitEditorTab).toBe('a.tex');
    useUiStore.getState().setSplitEditorTab(null);
  });
});

describe('分屏候选文件计算（splitCandidates 语义）', () => {
  it('排除当前活跃 tab、排除不存在的文件', () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': 'content', 'sections/method.tex': 'content', 'refs.bib': 'bib' },
      openTabs: ['main.tex', 'sections/method.tex', 'refs.bib'],
      activeTab: 'main.tex',
    });
    const ws = useWorkspaceStore.getState();
    const candidates = ws.openTabs.filter(
      (f) => f !== ws.activeTab && ws.files[f] !== undefined,
    );
    expect(candidates).toEqual(['sections/method.tex', 'refs.bib']);
  });

  it('只有一个 tab 时候选为空（分屏按钮不显示）', () => {
    useWorkspaceStore.setState({
      files: { 'main.tex': 'content' },
      openTabs: ['main.tex'],
      activeTab: 'main.tex',
    });
    const ws = useWorkspaceStore.getState();
    const candidates = ws.openTabs.filter(
      (f) => f !== ws.activeTab && ws.files[f] !== undefined,
    );
    expect(candidates).toEqual([]);
  });
});

describe('EditorArea lockedFile（分屏右窗格）', () => {
  it('lockedFile 存在时编辑器不切换 activeTab', () => {
    // 纯状态语义测试：分屏窗格的编辑目标是 lockedFile 指定的文件，
    // 用户在其中打字只 updateFile，不 openFile（不改变主窗格 activeTab）
    useWorkspaceStore.setState({
      files: { 'main.tex': 'main', 'sections/method.tex': 'method' },
      openTabs: ['main.tex', 'sections/method.tex'],
      activeTab: 'main.tex',
    });
    const lockedFile = 'sections/method.tex';
    const ws = useWorkspaceStore.getState();
    // 模拟分屏编辑器保存：updateFile 只改内容不改 activeTab
    ws.updateFile(lockedFile, 'method edited');
    expect(useWorkspaceStore.getState().activeTab).toBe('main.tex'); // 主窗格不变
    expect(useWorkspaceStore.getState().files['sections/method.tex']).toBe('method edited');
  });
});
