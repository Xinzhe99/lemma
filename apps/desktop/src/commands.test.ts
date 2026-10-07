import { describe, expect, it } from 'vitest';
import { buildCommands, type CommandContext } from './commands';
import { fuzzyScore, PALETTE_GROUP_ORDER } from './commandPalette';
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

describe('命令面板分组与精选（palette 分区重设计）', () => {
  it('每个命令都已归组：group 为规范键、双语标题在 i18n 字典中', () => {
    const cmds = buildCommands(ctx);
    for (const c of cmds) {
      expect(c.group, c.id).toMatch(/^palette\.group\./);
      expect(PALETTE_GROUP_ORDER, c.id).toContain(c.group!);
      expect(t(c.group!, 'zh'), c.id).not.toBe(c.group!);
      expect(t(c.group!, 'en'), c.id).not.toBe(c.group!);
    }
  });

  it('语义归组：抽查命令落入预期分组', () => {
    const groupOf = (id: string) => buildCommands(ctx).find((c) => c.id === id)!.group;
    expect(groupOf('compile.run')).toBe('palette.group.compile');
    expect(groupOf('agent.newSession')).toBe('palette.group.ai');
    expect(groupOf('library.importBibtex')).toBe('palette.group.library');
    expect(groupOf('theme.toggle')).toBe('palette.group.view');
    expect(groupOf('agent.workflowCoverLetter')).toBe('palette.group.workflow');
    expect(groupOf('submit.venue')).toBe('palette.group.submit');
    expect(groupOf('knowledge.glossary')).toBe('palette.group.knowledge');
    expect(groupOf('app.settings')).toBe('palette.group.app');
    expect(groupOf('file.quickOpen')).toBe('palette.group.project');
    expect(groupOf('search.global')).toBe('palette.group.edit');
  });

  it('精选默认命令：每组 2-3 个高频项，清单锁定', () => {
    const cmds = buildCommands(ctx);
    const featured = cmds.filter((c) => c.featured);
    const ids = featured.map((c) => c.id).sort();
    expect(ids).toEqual(
      [
        // 项目与文件
        'file.new',
        'file.quickOpen',
        'project.template',
        // 编译
        'compile.aiFix',
        'compile.run',
        // 编辑
        'insert.citation',
        'search.global',
        // AI 助手
        'agent.newSession',
        'agent.polish',
        'agent.prompts',
        // 文献与阅读
        'library.discover',
        'library.quickCite',
        // 视图
        'focus.toggle',
        'theme.toggle',
        // 工作流
        'agent.workflowPolish',
        'agent.workflowSectionDraft',
        // 投稿
        'submit.open',
        'submit.venue',
        // 知识库
        'knowledge.glossary',
        'knowledge.notes',
        // 应用
        'app.settings',
        'app.shortcuts',
      ].sort(),
    );
    // 每组精选 2-3 个，且 10 个分组都有精选项
    const perGroup = new Map<string, number>();
    for (const c of featured) perGroup.set(c.group!, (perGroup.get(c.group!) ?? 0) + 1);
    expect(perGroup.size).toBe(PALETTE_GROUP_ORDER.length);
    for (const n of perGroup.values()) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
