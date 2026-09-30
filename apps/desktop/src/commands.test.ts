import { describe, expect, it } from 'vitest';
import { buildCommands, type CommandContext } from './commands';
import { fuzzyScore } from './commandPalette';
import { t } from './i18n';
import { useUiStore } from './state/uiStore';
import { useWorkspaceStore } from './state/workspaceStore';

const ctx: CommandContext = {
  t: (key, vars) => t(key, 'en', vars),
  openSettings: () => {},
  focusFileTree: () => {},
  toast: () => {},
};

const byId = (id: string) => {
  const cmd = buildCommands(ctx).find((c) => c.id === id);
  if (!cmd) throw new Error(`command not found: ${id}`);
  return cmd;
};

describe('buildCommands', () => {
  it('注册表非空且覆盖核心动作', () => {
    const cmds = buildCommands(ctx);
    expect(cmds.length).toBeGreaterThanOrEqual(8);
    const ids = cmds.map((c) => c.id);
    const required = [
      'project.new',
      'file.new',
      'file.save',
      'theme.toggle',
      'app.settings',
      'view.focusTree',
      'compile.clearLog',
      'compile.run',
      // WF-5 新增：投稿、知识入口、W7/W11 工作流
      'submit.open',
      'submit.venue',
      'knowledge.notes',
      'knowledge.glossary',
      'agent.workflowRebuttal',
      'agent.workflowCoverLetter',
    ];
    for (const id of required) {
      expect(ids).toContain(id);
    }
    for (const c of cmds) {
      expect(c.title).toBeTruthy();
      expect(c.title).not.toBe(c.id); // 标题来自 i18n 字典而非裸键
    }
  });

  it('命令 id 去重（无重复注册）', () => {
    const cmds = buildCommands(ctx);
    const ids = cmds.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('⌘K 搜 "cover letter" 能命中 W11 命令', () => {
    const w11 = byId('agent.workflowCoverLetter');
    expect(fuzzyScore('cover letter', `${w11.title} ${w11.hint ?? ''}`)).toBeGreaterThan(0);
  });

  it('W11 命令经 launchWorkflow 启动并预填 journal/highlights', () => {
    byId('agent.workflowCoverLetter').run?.();
    const ui = useUiStore.getState();
    expect(ui.workflowLaunch).toBe('w11-cover-letter');
    expect(ui.workflowLaunchVars).toEqual({ journal: '', highlights: '' });
    ui.setWorkflowLaunch(null);
  });

  it('W7 命令设置 workflowLaunch', () => {
    byId('agent.workflowRebuttal').run?.();
    expect(useUiStore.getState().workflowLaunch).toBe('w7-rebuttal');
    useUiStore.getState().setWorkflowLaunch(null);
  });

  it('投稿/知识命令切换侧栏页签（含 knowledge 子页签）', () => {
    byId('submit.open').run?.();
    expect(useUiStore.getState().sidebarTab).toBe('submit');

    byId('knowledge.notes').run?.();
    const ui = useUiStore.getState();
    expect(ui.sidebarTab).toBe('knowledge');
    expect(ui.knowledgeTab).toBe('notes');

    byId('knowledge.glossary').run?.();
    expect(useUiStore.getState().knowledgeTab).toBe('glossary');

    useUiStore.getState().setSidebarTab('files');
  });

  it('快速打开/快捷键帮助命令经 uiStore 开关解耦（新字符串来自本地字典而非 i18n 键）', () => {
    const cmds = buildCommands(ctx);
    const quickOpen = cmds.find((c) => c.id === 'file.quickOpen');
    const shortcuts = cmds.find((c) => c.id === 'app.shortcuts');
    expect(quickOpen).toBeTruthy();
    expect(shortcuts).toBeTruthy();
    expect(quickOpen!.kbd).toBe('Ctrl+P');
    expect(shortcuts!.kbd).toBe('Ctrl+/');

    quickOpen!.run?.();
    expect(useUiStore.getState().quickOpenOpen).toBe(true);
    useUiStore.getState().setQuickOpenOpen(false);

    shortcuts!.run?.();
    expect(useUiStore.getState().shortcutsOpen).toBe(true);
    useUiStore.getState().setShortcutsOpen(false);
  });

  it('file.new 经应用内文本对话框收集路径：确认创建 + toast 保留，取消不创建', async () => {
    const toasts: string[] = [];
    const cmd = buildCommands({ ...ctx, toast: (m) => toasts.push(m) }).find(
      (c) => c.id === 'file.new',
    )!;
    const run = cmd.run as unknown as () => Promise<void>;

    // 取消（resolve null）：不创建、无 toast
    const cancelled = run();
    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('prompt');
    expect(req?.title).toBeTruthy();
    req!.resolve(null);
    await cancelled;
    expect(useWorkspaceStore.getState().files['sections/notes-new.tex']).toBeUndefined();
    expect(toasts).toEqual([]);

    // 输入路径确认：创建空文件 + toast
    const confirmed = run();
    useUiStore.getState().textDialog!.resolve('sections/notes-new.tex');
    await confirmed;
    expect(useWorkspaceStore.getState().files['sections/notes-new.tex']).toBe('');
    expect(toasts.some((m) => m.includes('sections/notes-new.tex'))).toBe(true);
    useUiStore.getState().closeTextDialog();
  });
});
