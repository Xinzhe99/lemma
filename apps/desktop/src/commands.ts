/**
 * 命令面板命令注册表：面向真实 store 动作；UI 侧回调（打开设置、聚焦文件树、toast）经 ctx 注入。
 * compile.run 已接入 WS-B 编译流水线（浏览器形态使用 MockEngine，真实引擎待 Tauri CommandRunner 桥）。
 * WF-5：全部标题/提示入 i18n；补投稿（打包/venue）、知识（笔记/术语）入口与 W7/W11 工作流命令。
 */

import type { Command } from './commandPalette';
import { applyTheme } from './theme';
import { useAgentHubStore } from '@scholarforge/agent-hub';
import { runCompile, resolveCompileEntry } from './compileAction';
import { requestToolApproval } from './approval';
import { rulePolish } from './polish';
import { useSettingsStore } from './state/settingsStore';
import { useUiStore } from './state/uiStore';
import { useWorkspaceStore } from './state/workspaceStore';

export interface CommandContext {
  /** 翻译函数（通常来自 useT()，支持 {name} 插值） */
  t: (key: string, vars?: Record<string, string | number>) => string;
  openSettings: () => void;
  focusFileTree: () => void;
  toast: (message: string) => void;
}

/** 新增命令的本地字典（跟随设置语言；新字符串不进 i18n.ts） */
const COMMAND_STRINGS = {
  quickOpen: { zh: '快速打开文件', en: 'Quick open file' },
  shortcuts: { zh: '快捷键帮助', en: 'Keyboard shortcuts' },
} as const;

function localTitle(key: keyof typeof COMMAND_STRINGS): string {
  const lang = useSettingsStore.getState().language;
  return COMMAND_STRINGS[key][lang];
}

export function buildCommands(ctx: CommandContext): Command[] {
  const raw: Command[] = [
    {
      id: 'project.new',
      title: ctx.t('cmd.newProject'),
      hint: ctx.t('hint.project'),
      run: () => {
        useWorkspaceStore.getState().loadDemoProject();
        ctx.toast(ctx.t('toast.projectReset'));
      },
    },
    {
      id: 'project.template',
      title: ctx.t('cmd.template'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().setTemplateWizardOpen(true),
    },
    {
      id: 'project.importZip',
      title: ctx.t('cmd.importZip'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().requestZipPicker(),
    },
    {
      id: 'project.switch',
      title: '切换 / 管理项目',
      hint: '项目',
      run: () => useUiStore.getState().setProjectSwitcherOpen(true),
    },
    {
      id: 'table.insert',
      title: '插入表格（可视化编辑器）',
      hint: '编辑',
      run: () => useUiStore.getState().setTableEditorOpen(true),
    },
    {
      id: 'search.global',
      title: ctx.t('cmd.globalSearch'),
      hint: ctx.t('hint.edit'),
      kbd: 'Ctrl+Shift+F',
      run: () => useUiStore.getState().setSearchPanelOpen(true),
    },
    {
      id: 'insert.image',
      title: ctx.t('cmd.insertImage'),
      hint: '编辑',
      run: () => useUiStore.getState().setImageWizardOpen(true),
    },
    {
      id: 'app.backup',
      title: ctx.t('cmd.backup'),
      hint: ctx.t('hint.app'),
      run: () => useUiStore.getState().setBackupDialogOpen(true),
    },
    {
      id: 'insert.citation',
      title: ctx.t('cmd.insertCitation'),
      hint: '编辑',
      run: () => useUiStore.getState().setCitationPickerOpen(true),
    },
    {
      id: 'file.new',
      title: ctx.t('cmd.newFile'),
      hint: ctx.t('hint.file'),
      run: async () => {
        // 新建文件经应用内文本对话框收集路径（原生对话框在 Tauri WKWebView 不可用）；toast 保留
        const path = await new Promise<string | null>((resolve) => {
          useUiStore.getState().openTextDialog({
            title: ctx.t('prompt.newFilePath'),
            initial: 'sections/notes.tex',
            mode: 'prompt',
            resolve,
          });
        });
        const trimmed = path?.trim();
        if (!trimmed) return;
        useWorkspaceStore.getState().createFile(trimmed, '');
        ctx.toast(`${ctx.t('toast.fileCreated')}: ${trimmed}`);
      },
    },
    {
      id: 'file.quickOpen',
      title: localTitle('quickOpen'),
      hint: ctx.t('hint.file'),
      kbd: 'Ctrl+P',
      run: () => useUiStore.getState().setQuickOpenOpen(true),
    },
    {
      id: 'file.save',
      title: ctx.t('cmd.save'),
      hint: ctx.t('hint.file'),
      kbd: 'Ctrl+S',
      run: () => ctx.toast(ctx.t('toast.saved')),
    },
    {
      id: 'app.shortcuts',
      title: localTitle('shortcuts'),
      hint: ctx.t('hint.app'),
      kbd: 'Ctrl+/',
      run: () => useUiStore.getState().setShortcutsOpen(true),
    },
    {
      id: 'theme.toggle',
      title: ctx.t('cmd.toggleTheme'),
      hint: ctx.t('hint.view'),
      run: () => {
        const s = useSettingsStore.getState();
        const next = s.theme === 'dark' ? 'light' : 'dark';
        s.setTheme(next);
        applyTheme(next);
      },
    },
    {
      id: 'app.settings',
      title: ctx.t('cmd.settings'),
      hint: ctx.t('hint.app'),
      kbd: 'Ctrl+,',
      run: () => ctx.openSettings(),
    },
    {
      id: 'view.focusTree',
      title: ctx.t('cmd.focusTree'),
      hint: ctx.t('hint.view'),
      run: () => ctx.focusFileTree(),
    },
    {
      id: 'compile.clearLog',
      title: ctx.t('cmd.clearLog'),
      hint: ctx.t('hint.compile'),
      run: () => useWorkspaceStore.getState().clearCompileLog(),
    },
    {
      id: 'compile.run',
      title: ctx.t('cmd.compile'),
      hint: ctx.t('hint.compile'),
      kbd: 'Ctrl+Enter',
      run: async () => {
        const result = await runCompile();
        if (!result.ok && !result.entry) ctx.toast(ctx.t('toast.noTexEntry'));
      },
    },
    {
      id: 'library.importBibtex',
      title: ctx.t('cmd.importBibtex'),
      hint: ctx.t('hint.library'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryDialog('bibtex');
      },
    },
    {
      id: 'library.fetchMetadata',
      title: ctx.t('cmd.fetchMetadata'),
      hint: ctx.t('hint.library'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryDialog('fetch');
      },
    },
    {
      id: 'reader.openPdf',
      title: ctx.t('cmd.openPdf'),
      hint: ctx.t('hint.reading'),
      run: () => useUiStore.getState().requestPdfPicker(),
    },
    {
      id: 'library.discover',
      title: ctx.t('cmd.discover'),
      hint: ctx.t('hint.library'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryMode('discover');
      },
    },
    {
      id: 'agent.polish',
      title: ctx.t('cmd.agentPolish'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().requestAgentAction('polish'),
    },
    {
      id: 'agent.draft',
      title: ctx.t('cmd.agentDraft'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().requestAgentAction('draft'),
    },
    {
      id: 'view.history',
      title: ctx.t('cmd.history'),
      hint: ctx.t('hint.version'),
      kbd: 'Ctrl+H',
      run: () => useUiStore.getState().setHistoryOpen(true),
    },
    {
      id: 'agent.newSession',
      title: ctx.t('cmd.newSession'),
      hint: ctx.t('hint.agent'),
      run: () => useAgentHubStore.getState().newSession('host'),
    },
    {
      id: 'agent.simulateToolEdit',
      title: ctx.t('cmd.simulateToolEdit'),
      hint: ctx.t('hint.agent'),
      run: async () => {
        const ws = useWorkspaceStore.getState();
        const file =
          ws.activeTab && ws.files[ws.activeTab] !== undefined && ws.activeTab.endsWith('.tex')
            ? ws.activeTab
            : resolveCompileEntry();
        if (!file) {
          ctx.toast(ctx.t('toast.needTexFile'));
          return;
        }
        const before = ws.files[file]!;
        const after = rulePolish(before);
        if (after === before) {
          ctx.toast(ctx.t('toast.noDemoChange'));
          return;
        }
        const decision = await requestToolApproval({
          file,
          before,
          after,
          kind: 'tool-edit',
          label: ctx.t('approval.demoEditLabel'),
          via: ctx.t('approval.demoEditVia'),
        });
        ctx.toast(ctx.t('toast.verdict', { note: decision.note }));
      },
    },
    {
      id: 'agent.workflowReviewers',
      title: ctx.t('cmd.wfReviewers'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w6-reviewer-sim'),
    },
    {
      id: 'agent.workflowPolish',
      title: ctx.t('cmd.wfPolish'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w3-polish'),
    },
    {
      id: 'agent.workflowChecklist',
      title: ctx.t('cmd.wfChecklist'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w10-pre-submission'),
    },
    {
      id: 'agent.workflowRebuttal',
      title: ctx.t('cmd.wfRebuttal'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w7-rebuttal'),
    },
    {
      id: 'agent.workflowCoverLetter',
      title: ctx.t('cmd.wfCoverLetter'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w11-cover-letter', { journal: '', highlights: '' }),
    },
    {
      id: 'submit.open',
      title: ctx.t('cmd.submitPackage'),
      hint: ctx.t('hint.submit'),
      run: () => useUiStore.getState().setSidebarTab('submit'),
    },
    {
      id: 'submit.venue',
      title: ctx.t('cmd.submitVenue'),
      hint: ctx.t('hint.submit'),
      run: () => useUiStore.getState().setSidebarTab('submit'),
    },
    {
      id: 'knowledge.notes',
      title: ctx.t('cmd.openNotes'),
      hint: ctx.t('hint.knowledge'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('knowledge');
        ui.setKnowledgeTab('notes');
      },
    },
    {
      id: 'knowledge.glossary',
      title: ctx.t('cmd.openGlossary'),
      hint: ctx.t('hint.knowledge'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('knowledge');
        ui.setKnowledgeTab('glossary');
      },
    },
  ];

  // 防御性去重：同 id 只保留首个
  const seen = new Set<string>();
  return raw.filter((c) => {
    if (!c.id || !c.title || seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}
