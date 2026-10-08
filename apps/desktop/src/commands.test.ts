import { describe, expect, it, vi } from 'vitest';
import { buildCommands, type CommandContext } from './commands';
import { PALETTE_GROUP_ORDER } from './commandPalette';
import { t } from './i18n';
import { useSettingsStore } from './state/settingsStore';
import { useUiStore } from './state/uiStore';
import { useWorkspaceStore } from './state/workspaceStore';

/** TTS 桥替身：朗读文本可直接断言（latexToSpeakable 取原文，便于检查小节边界） */
const tts = vi.hoisted(() => ({
  speak: vi.fn((_text: string, _lang?: 'zh' | 'en') => true),
  stop: vi.fn(),
}));
vi.mock('./tts', () => ({
  ttsSupported: () => true,
  speak: tts.speak,
  stopTts: tts.stop,
  latexToSpeakable: (s: string) => s,
}));

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
      // WF-5 新增：投稿、知识入口（工作流命令已移除——工作流统一从 Agent 面板启动）
      'submit.open',
      'submit.venue',
      'knowledge.notes',
      'knowledge.glossary',
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

  it('工作流命令不再进入命令面板（统一从 Agent 面板启动）', () => {
    const ids = buildCommands(ctx).map((c) => c.id);
    for (const id of ids) {
      expect(id.startsWith('wf.') || id.startsWith('agent.workflow')).toBe(false);
    }
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

  it('bib.healthCheck 的报告 toast 跟随界面语言（v7.8.0：此前整段写死中文）', async () => {
    const prevLang = useSettingsStore.getState().language;
    const prevFiles = useWorkspaceStore.getState().files;
    useSettingsStore.setState({ language: 'en' });
    useWorkspaceStore.setState({
      files: {
        'main.tex': 'We cite \\cite{ghost2024}.',
        'refs.bib': '@misc{real, title={T}, author={A}, year={2020}}',
      },
    });
    try {
      const toasts: string[] = [];
      const cmd = buildCommands({ ...ctx, toast: (m) => toasts.push(m) }).find(
        (c) => c.id === 'bib.healthCheck',
      )!;
      cmd.run?.();
      await vi.waitFor(() => expect(toasts).toHaveLength(1));
      expect(toasts[0]).toContain('Dangling citations');
      expect(toasts[0]).toContain('ghost2024');
      expect(toasts[0]).not.toMatch(/[\u4e00-\u9fff]/); // 英文界面下无中文残留
    } finally {
      useSettingsStore.setState({ language: prevLang });
      useWorkspaceStore.setState({ files: prevFiles });
    }
  });

  it('edit.readAloud 的小节边界含星号标题（v7.8.0：\\section* 曾不被当作边界，越过小节朗读）', async () => {
    const prevLang = useSettingsStore.getState().language;
    const prevState = useWorkspaceStore.getState();
    useSettingsStore.setState({ language: 'zh' });
    useWorkspaceStore.setState({
      files: {
        'main.tex': [
          '\\section{Alpha}', // 1（光标默认在第 1 行 → 起始小节）
          'alpha text', // 2
          '\\section*{Notes}', // 3 ← 边界（不编号小节）
          'notes text', // 4
          '\\section{Beta}', // 5
          'beta text', // 6
        ].join('\n'),
      },
      activeTab: 'main.tex',
      openTabs: ['main.tex'],
    });
    tts.speak.mockClear();
    try {
      const toasts: string[] = [];
      const cmd = buildCommands({ ...ctx, toast: (m) => toasts.push(m) }).find(
        (c) => c.id === 'edit.readAloud',
      )!;
      cmd.run?.();
      await vi.waitFor(() => expect(toasts).toHaveLength(1));
      expect(toasts[0]).toContain('第 1-2 行'); // 读到 \section*{Notes} 之前
      const spoken = String(tts.speak.mock.calls[0]?.[0] ?? '');
      expect(spoken).toContain('alpha text');
      expect(spoken).not.toContain('notes text');
      expect(spoken).not.toContain('beta text');
    } finally {
      useSettingsStore.setState({ language: prevLang });
      useWorkspaceStore.setState({ files: prevState.files, activeTab: prevState.activeTab });
    }
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
        // 文献与阅读
        'library.discover',
        'library.quickCite',
        // 视图
        'focus.toggle',
        'theme.toggle',
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
    // 每组精选 2-3 个；所有分组都有精选项（v7.9.6：工作流分组已随功能下线移除）
    const perGroup = new Map<string, number>();
    for (const c of featured) perGroup.set(c.group!, (perGroup.get(c.group!) ?? 0) + 1);
    expect(perGroup.size).toBe(PALETTE_GROUP_ORDER.length);
    for (const n of perGroup.values()) {
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(3);
    }
  });
});
