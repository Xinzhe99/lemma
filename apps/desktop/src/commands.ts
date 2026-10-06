/**
 * 命令面板命令注册表：面向真实 store 动作；UI 侧回调（打开设置、聚焦文件树、toast）经 ctx 注入。
 * compile.run 已接入 WS-B 编译流水线（浏览器形态使用 MockEngine，真实引擎待 Tauri CommandRunner 桥）。
 * WF-5：全部标题/提示入 i18n；补投稿（打包/venue）、知识（笔记/术语）入口与 W7/W11 工作流命令。
 */

import type { Command } from './commandPalette';
import { applyTheme } from './theme';
import { useAgentHubStore } from '@lemma/agent-hub';
import { runCompile, resolveCompileEntry } from './compileAction';
import { requestToolApproval } from './approval';
import { rulePolish } from './polish';
import { lastCursor } from './editorJump';
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
      id: 'library.exportBib',
      title: ctx.t('cmd.exportBib'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportBib').then(({ exportLibraryBib }) => exportLibraryBib(false));
      },
    },
    {
      id: 'library.exportBibCited',
      title: ctx.t('cmd.exportBibCited'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportBib').then(({ exportLibraryBib }) => exportLibraryBib(true));
      },
    },
    {
      id: 'project.exportZip',
      title: ctx.t('cmd.exportZip'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportZip').then(({ exportProjectZip }) => exportProjectZip());
      },
    },
    {
      id: 'project.importZip',
      title: ctx.t('cmd.importZip'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().requestZipPicker(),
    },
    {
      id: 'project.switch',
      title: ctx.t('cmd.manageProjects'),
      hint: '项目',
      run: () => useUiStore.getState().setProjectSwitcherOpen(true),
    },
    {
      id: 'table.insert',
      title: ctx.t('cmd.insertTable'),
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
      id: 'comments.open',
      title: ctx.t('cmd.openComments'),
      hint: '批注',
      run: () => useUiStore.getState().setSidebarTab('comments'),
    },
    {
      id: 'focus.toggle',
      title: ctx.t('cmd.focusMode'),
      hint: ctx.t('hint.view'),
      kbd: 'Ctrl+Shift+Z',
      run: () => {
        const ui = useUiStore.getState();
        ui.setFocusMode(!ui.focusMode);
      },
    },
    {
      id: 'stats.open',
      title: ctx.t('cmd.writingStats'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setStatsDialogOpen(true),
    },
    {
      id: 'edit.spellcheck',
      title: ctx.t('cmd.spellcheck'),
      hint: '编辑',
      run: () => {
        const ui = useUiStore.getState();
        ui.setSpellcheckEnabled(!ui.spellcheckEnabled);
      },
    },
    {
      id: 'app.checkUpdate',
      title: ctx.t('cmd.checkUpdate'),
      hint: ctx.t('hint.app'),
      run: () => void import('./state/updateStore').then(({ useUpdateStore }) => useUpdateStore.getState().checkNow()),
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
      id: 'agent.research',
      title: ctx.t('cmd.agentResearch'),
      hint: ctx.t('hint.agent'),
      run: () => {
        void import('./dialogs').then(async ({ promptDialog }) => {
          const task = await promptDialog(ctx.t('research.taskPrompt'));
          if (task && task.trim()) void import('./researchAgents').then(({ runResearchAgents }) => runResearchAgents(task.trim()));
        });
      },
    },
    {
      id: 'agent.usage',
      title: ctx.t('cmd.agentUsage'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setUsageDialogOpen(true),
    },
    {
      id: 'agent.prompts',
      title: ctx.t('cmd.agentPrompts'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setPromptsLibOpen(true),
    },
    {
      id: 'cite.suggest',
      title: ctx.t('cmd.citeSuggest'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setCiteSuggestOpen(true),
    },
    {
      id: 'collab.merge',
      title: ctx.t('cmd.collabMerge'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setCollabDialogOpen(true),
    },
    {
      id: 'library.quickCite',
      title: ctx.t('cmd.quickCite'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setQuickCiteOpen(true),
    },
    {
      id: 'help.panel',
      title: ctx.t('cmd.helpPanel'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setHelpPanelOpen(true),
    },
    {
      id: 'insert.tikzFigure',
      title: ctx.t('cmd.tikzFigure'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setTikzFigureOpen(true),
    },
    {
      id: 'insert.imageToLatex',
      title: ctx.t('cmd.imageToLatex'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setImageToLatexOpen(true),
    },
    {
      id: 'edit.readAloud',
      title: ctx.t('cmd.readAloud'),
      hint: ctx.t('hint.edit'),
      kbd: undefined,
      run: () => {
        void import('./tts').then(({ ttsSupported, speak, stopTts, latexToSpeakable }) => {
          if (!ttsSupported()) {
            ctx.toast('当前环境不支持语音合成');
            return;
          }
          const ws = useWorkspaceStore.getState();
          const file = ws.activeTab;
          if (!file || !file.endsWith('.tex')) {
            ctx.toast('先打开一个 .tex 文件');
            return;
          }
          const content = ws.files[file] ?? '';
          const cursorLine = lastCursor().line ?? 1;
          const lines = content.split('\n');
          // 光标向前找最近的 section/subsection 头，朗读到下一个同级或更高级头
          let start = 0;
          for (let i = Math.min(cursorLine - 1, lines.length - 1); i >= 0; i--) {
            if (/\\(sub)*section\{|\\chapter\{/.test(lines[i]!)) {
              start = i;
              break;
            }
          }
          // v6.8.0 修复：\end{document} 视为 level 0（此前 fallback 9 会让 section 朗读越过文末继续读参考文献）
          const level = (l: string) =>
            /\\end\{document\}/.test(l) ? 0 : (l.match(/\\sub*section/)?.[0]?.length ?? 9);
          const startLevel = level(lines[start] ?? '');
          let end = lines.length;
          for (let i = start + 1; i < lines.length; i++) {
            const m = /\\(sub)*section\{|\\chapter\{|\\end\{document\}/.exec(lines[i]!);
            if (m && level(m[0]) <= startLevel) {
              end = i;
              break;
            }
          }
          const section = latexToSpeakable(lines.slice(start, end).join('\n'));
          if (!section) {
            ctx.toast('这一节没有可朗读的文本');
            return;
          }
          const ok = speak(section, /[一-鿿]/.test(section) ? 'zh' : 'en');
          ctx.toast(ok ? `朗读中（第 ${start + 1}-${end} 行）——命令面板「停止朗读」可中断` : '朗读启动失败');
        });
      },
    },
    {
      id: 'edit.stopReadAloud',
      title: ctx.t('cmd.stopReadAloud'),
      hint: ctx.t('hint.edit'),
      run: () => {
        void import('./tts').then(({ stopTts }) => {
          stopTts();
          ctx.toast('已停止朗读');
        });
      },
    },
    {
      id: 'edit.normalizeDoc',
      title: ctx.t('cmd.normalizeDoc'),
      hint: ctx.t('hint.edit'),
      run: () => {
        const ws = useWorkspaceStore.getState();
        const file = ws.activeTab;
        if (!file || !file.endsWith('.tex')) return;
        void import('@lemma/editor').then(({ normalizeDocument }) => {
          const { result, changes } = normalizeDocument(ws.files[file] ?? '');
          if (changes > 0) ws.updateFile(file, result);
        });
      },
    },
    {
      id: 'agent.plan',
      title: ctx.t('cmd.agentPlan'),
      hint: ctx.t('hint.agent'),
      run: () => {
        void import('./dialogs').then(async ({ promptDialog }) => {
          const task = await promptDialog(ctx.t('plan.taskPrompt'));
          if (task && task.trim()) void import('./aiActions').then(({ runPlannedTask }) => runPlannedTask(task.trim()));
        });
      },
    },
    {
      id: 'agent.newSession',
      title: ctx.t('cmd.newSession'),
      hint: ctx.t('hint.agent'),
      run: () => useAgentHubStore.getState().newSession('host', useWorkspaceStore.getState().projectName || undefined),
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
      id: 'pdf.reopenLast',
      title: ctx.t('cmd.reopenPdf'),
      hint: ctx.t('hint.compile'),
      run: () => {
        void import('./compileAction').then(({ reopenLastPdf }) => {
          if (!reopenLastPdf()) ctx.toast(ctx.t('toast.noLastPdf'));
        });
      },
    },
    {
      id: 'external.diff',
      title: ctx.t('cmd.externalDiff'),
      hint: ctx.t('hint.file'),
      run: () => useUiStore.getState().setExternalDiffOpen(true),
    },
    {
      id: 'wf.compress',
      title: ctx.t('cmd.wfCompress'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w14-compress'),
    },
    {
      id: 'wf.beamer',
      title: ctx.t('cmd.wfBeamer'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w13-beamer'),
    },
    {
      id: 'wf.promo',
      title: ctx.t('cmd.wfPromo'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w16-promo'),
    },
    {
      id: 'compile.aiFix',
      title: ctx.t('cmd.aiFix'),
      hint: ctx.t('hint.compile'),
      run: () => void import('./aiActions').then(({ fixCompileErrors }) => fixCompileErrors()),
    },
    {
      id: 'export.docx',
      title: ctx.t('cmd.exportDocx'),
      hint: ctx.t('hint.project'),
      run: () =>
        void import('./pandoc').then(async ({ exportDocx }) => {
          const r = await exportDocx();
          if (!r.ok) ctx.toast(r.error);
        }),
    },
    {
      id: 'reviews.import',
      title: ctx.t('cmd.importReviews'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setReviewsImportOpen(true),
    },
    {
      id: 'agent.workflowRelatedWork',
      title: ctx.t('cmd.wfRelatedWork'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w12-related-work'),
    },
    {
      id: 'agent.workflowSectionDraft',
      title: ctx.t('cmd.wfSectionDraft'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w2-section-draft'),
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
