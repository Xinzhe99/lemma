import { describe, expect, it } from 'vitest';
import { buildCommands, type CommandContext } from './commands';
import { fuzzyScore } from './commandPalette';
import { t } from './i18n';
import { useUiStore } from './state/uiStore';

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
});
