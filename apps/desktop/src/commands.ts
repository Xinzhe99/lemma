/**
 * 命令面板命令注册表：面向真实 store 动作；UI 侧回调（打开设置、聚焦文件树、toast）经 ctx 注入。
 * compile.run 已接入 WS-B 编译流水线（浏览器形态使用 MockEngine，真实引擎待 Tauri CommandRunner 桥）。
 * WF-5：全部标题/提示入 i18n；补投稿（打包/venue）、知识（笔记/术语）入口与 W7/W11 工作流命令。
 * 命令面板分组（palette.group.*）与精选标记（featured）：每个命令按语义归组，
 * 空查询默认视图只展示每组 2-3 个高频精选项，输入关键词才检索全部命令。
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
      group: 'palette.group.project',
      title: ctx.t('cmd.newProject'),
      hint: ctx.t('hint.project'),
      run: () => {
        useWorkspaceStore.getState().loadDemoProject();
        ctx.toast(ctx.t('toast.projectReset'));
      },
    },
    {
      id: 'project.template',
      group: 'palette.group.project',
      featured: true,
      title: ctx.t('cmd.template'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().setTemplateWizardOpen(true),
    },
    {
      id: 'library.exportBib',
      group: 'palette.group.library',
      title: ctx.t('cmd.exportBib'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportBib').then(({ exportLibraryBib }) => exportLibraryBib(false));
      },
    },
    {
      id: 'library.exportBibCited',
      group: 'palette.group.library',
      title: ctx.t('cmd.exportBibCited'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportBib').then(({ exportLibraryBib }) => exportLibraryBib(true));
      },
    },
    {
      id: 'project.exportZip',
      group: 'palette.group.project',
      title: ctx.t('cmd.exportZip'),
      hint: ctx.t('hint.view'),
      run: () => {
        void import('./exportZip').then(({ exportProjectZip }) => exportProjectZip());
      },
    },
    {
      id: 'project.importZip',
      group: 'palette.group.project',
      title: ctx.t('cmd.importZip'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().requestZipPicker(),
    },
    {
      id: 'project.switch',
      group: 'palette.group.project',
      title: ctx.t('cmd.manageProjects'),
      hint: ctx.t('hint.project'),
      run: () => useUiStore.getState().setProjectSwitcherOpen(true),
    },
    {
      id: 'table.insert',
      group: 'palette.group.edit',
      title: ctx.t('cmd.insertTable'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setTableEditorOpen(true),
    },
    {
      id: 'search.global',
      group: 'palette.group.edit',
      featured: true,
      title: ctx.t('cmd.globalSearch'),
      hint: ctx.t('hint.edit'),
      kbd: 'Ctrl+Shift+F',
      run: () => useUiStore.getState().setSearchPanelOpen(true),
    },
    {
      id: 'project.replace',
      group: 'palette.group.edit',
      title: ctx.t('cmd.searchReplace'),
      hint: ctx.t('hint.edit'),
      kbd: 'Ctrl+Shift+H',
      run: () => useUiStore.getState().setSearchPanelOpen(true),
    },
    {
      id: 'bib.healthCheck',
      group: 'palette.group.library',
      title: ctx.t('cmd.bibHealth'),
      hint: ctx.t('hint.library'),
      run: () => {
        const ws = useWorkspaceStore.getState();
        void import('./bibHealth').then(({ checkBibHealth }) => {
          const report = checkBibHealth(ws.files);
          const err = report.errorCount;
          const warn = report.warningCount;
          const total = report.totalEntries;
          if (err === 0 && warn === 0) {
            ctx.toast(`✓ 参考文献体检通过：${total} 条 · 无问题`);
          } else {
            const dangling = report.issues.filter((i) => i.kind === 'dangling-cite').map((i) => i.citekey);
            const missing = report.issues.filter((i) => i.kind === 'missing-field').map((i) => `${i.citekey}(${i.message})`);
            const dupes = report.issues.filter((i) => i.kind === 'duplicate').map((i) => i.citekey);
            const lines = [
              `参考文献体检：${total} 条 · ${err} 错误 · ${warn} 警告`,
              dangling.length > 0 ? `悬空引用：${dangling.slice(0, 5).join(', ')}${dangling.length > 5 ? '…' : ''}` : '',
              missing.length > 0 ? `缺失字段：${missing.slice(0, 3).join('; ')}${missing.length > 3 ? '…' : ''}` : '',
              dupes.length > 0 ? `疑似重复：${[...new Set(dupes)].slice(0, 5).join(', ')}` : '',
            ].filter(Boolean);
            ctx.toast(lines.join(' · '));
          }
        });
      },
    },
    {
      id: 'insert.image',
      group: 'palette.group.edit',
      title: ctx.t('cmd.insertImage'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setImageWizardOpen(true),
    },
    {
      id: 'comments.open',
      group: 'palette.group.view',
      title: ctx.t('cmd.openComments'),
      hint: ctx.t('hint.comments'),
      run: () => useUiStore.getState().setSidebarTab('comments'),
    },
    {
      id: 'focus.toggle',
      group: 'palette.group.view',
      featured: true,
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
      group: 'palette.group.view',
      title: ctx.t('cmd.writingStats'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setStatsDialogOpen(true),
    },
    {
      id: 'edit.spellcheck',
      group: 'palette.group.edit',
      title: ctx.t('cmd.spellcheck'),
      hint: ctx.t('hint.edit'),
      run: () => {
        const ui = useUiStore.getState();
        ui.setSpellcheckEnabled(!ui.spellcheckEnabled);
      },
    },
    {
      id: 'app.checkUpdate',
      group: 'palette.group.app',
      title: ctx.t('cmd.checkUpdate'),
      hint: ctx.t('hint.app'),
      run: () => void import('./state/updateStore').then(({ useUpdateStore }) => useUpdateStore.getState().checkNow()),
    },
    {
      id: 'app.backup',
      group: 'palette.group.app',
      title: ctx.t('cmd.backup'),
      hint: ctx.t('hint.app'),
      run: () => useUiStore.getState().setBackupDialogOpen(true),
    },
    {
      id: 'insert.citation',
      group: 'palette.group.edit',
      featured: true,
      title: ctx.t('cmd.insertCitation'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setCitationPickerOpen(true),
    },
    {
      id: 'file.new',
      group: 'palette.group.project',
      featured: true,
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
        // v7.0.0 修复：路径校验——.. / 绝对路径 / 反斜杠会让 safe_rel 拒绝物化，
        // 编译静默降级为模拟引擎（假成功）
        if (trimmed.includes('..') || trimmed.startsWith('/') || trimmed.includes('\\')) {
          ctx.toast('文件路径不合法（含 ..、绝对路径或反斜杠）');
          return;
        }
        useWorkspaceStore.getState().createFile(trimmed, '');
        ctx.toast(`${ctx.t('toast.fileCreated')}: ${trimmed}`);
      },
    },
    {
      id: 'file.quickOpen',
      group: 'palette.group.project',
      featured: true,
      title: localTitle('quickOpen'),
      hint: ctx.t('hint.file'),
      kbd: 'Ctrl+P',
      run: () => useUiStore.getState().setQuickOpenOpen(true),
    },
    {
      id: 'file.save',
      group: 'palette.group.project',
      title: ctx.t('cmd.save'),
      hint: ctx.t('hint.file'),
      kbd: 'Ctrl+S',
      run: () => ctx.toast(ctx.t('toast.saved')),
    },
    {
      id: 'app.shortcuts',
      group: 'palette.group.app',
      featured: true,
      title: localTitle('shortcuts'),
      hint: ctx.t('hint.app'),
      kbd: 'Ctrl+/',
      run: () => useUiStore.getState().setShortcutsOpen(true),
    },
    {
      id: 'theme.toggle',
      group: 'palette.group.view',
      featured: true,
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
      group: 'palette.group.app',
      featured: true,
      title: ctx.t('cmd.settings'),
      hint: ctx.t('hint.app'),
      kbd: 'Ctrl+,',
      run: () => ctx.openSettings(),
    },
    {
      id: 'view.focusTree',
      group: 'palette.group.view',
      title: ctx.t('cmd.focusTree'),
      hint: ctx.t('hint.view'),
      run: () => ctx.focusFileTree(),
    },
    {
      id: 'compile.clearLog',
      group: 'palette.group.compile',
      title: ctx.t('cmd.clearLog'),
      hint: ctx.t('hint.compile'),
      run: () => useWorkspaceStore.getState().clearCompileLog(),
    },
    {
      id: 'compile.run',
      group: 'palette.group.compile',
      featured: true,
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
      group: 'palette.group.library',
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
      group: 'palette.group.library',
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
      group: 'palette.group.library',
      title: ctx.t('cmd.openPdf'),
      hint: ctx.t('hint.reading'),
      run: () => useUiStore.getState().requestPdfPicker(),
    },
    {
      id: 'library.discover',
      group: 'palette.group.library',
      featured: true,
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
      group: 'palette.group.ai',
      featured: true,
      title: ctx.t('cmd.agentPolish'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().requestAgentAction('polish'),
    },
    {
      id: 'agent.draft',
      group: 'palette.group.ai',
      title: ctx.t('cmd.agentDraft'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().requestAgentAction('draft'),
    },
    {
      id: 'view.history',
      group: 'palette.group.view',
      title: ctx.t('cmd.history'),
      hint: ctx.t('hint.version'),
      kbd: 'Ctrl+H',
      run: () => useUiStore.getState().setHistoryOpen(true),
    },
    {
      id: 'agent.research',
      group: 'palette.group.ai',
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
      group: 'palette.group.ai',
      title: ctx.t('cmd.agentUsage'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setUsageDialogOpen(true),
    },
    {
      id: 'agent.prompts',
      group: 'palette.group.ai',
      featured: true,
      title: ctx.t('cmd.agentPrompts'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setPromptsLibOpen(true),
    },
    {
      id: 'cite.suggest',
      group: 'palette.group.ai',
      title: ctx.t('cmd.citeSuggest'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setCiteSuggestOpen(true),
    },
    {
      id: 'collab.merge',
      group: 'palette.group.ai',
      title: ctx.t('cmd.collabMerge'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setCollabDialogOpen(true),
    },
    {
      id: 'library.quickCite',
      group: 'palette.group.library',
      featured: true,
      title: ctx.t('cmd.quickCite'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setQuickCiteOpen(true),
    },
    {
      id: 'help.panel',
      group: 'palette.group.view',
      title: ctx.t('cmd.helpPanel'),
      hint: ctx.t('hint.view'),
      run: () => useUiStore.getState().setHelpPanelOpen(true),
    },
    {
      id: 'insert.tikzFigure',
      group: 'palette.group.edit',
      title: ctx.t('cmd.tikzFigure'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setTikzFigureOpen(true),
    },
    {
      id: 'insert.imageToLatex',
      group: 'palette.group.edit',
      title: ctx.t('cmd.imageToLatex'),
      hint: ctx.t('hint.edit'),
      run: () => useUiStore.getState().setImageToLatexOpen(true),
    },
    {
      id: 'edit.readAloud',
      group: 'palette.group.edit',
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
          // v7.0.0 修复：lastCursor 是全局单例——不比对文件时，切文件后行号错位
          const cur = lastCursor();
          const cursorLine = !cur.file || cur.file === file ? cur.line : 1;
          const lines = content.split('\n');
          // 光标向前找最近的 section/subsection 头，朗读到下一个同级或更高级头
          let start = 0;
          for (let i = Math.min(cursorLine - 1, lines.length - 1); i >= 0; i--) {
            if (/\\(sub)*section\*?\{|\\chapter\*?\{/.test(lines[i]!)) {
              start = i;
              break;
            }
          }
          // v7.0.0 修复：chapter(5)/section(8)/subsection(11)/文末(0) 显式层级——
          // 此前 chapter 走 fallback 9，章朗读在第一个 section 处截断；星号版 \section*{ 一并匹配
          const levelOf = (cmd: string): number => {
            if (cmd.includes('end{document}')) return 0;
            if (cmd.includes('chapter')) return 5;
            if (cmd.includes('subsection')) return 11;
            if (cmd.includes('section')) return 8;
            return 99;
          };
          const level = (l: string) => {
            const m = /\\(sub)*section\*?\{|\\chapter\*?\{|\\end\{document\}/.exec(l);
            return m ? levelOf(m[0]) : 99;
          };
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
      group: 'palette.group.edit',
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
      group: 'palette.group.edit',
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
      group: 'palette.group.ai',
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
      group: 'palette.group.ai',
      featured: true,
      title: ctx.t('cmd.newSession'),
      hint: ctx.t('hint.agent'),
      run: () =>
        useAgentHubStore.getState().newSession('host', useWorkspaceStore.getState().projectName || undefined, ctx.t('sessions.newSession')),
    },
    {
      id: 'agent.simulateToolEdit',
      group: 'palette.group.ai',
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
        // v7.0.0 修复：此前点「采纳」只 toast 不落盘——修改静默丢失
        if (decision.approved) {
          const w = useWorkspaceStore.getState();
          if (w.files[file] === before) {
            w.snapshotFile(file, '审批采纳前的快照');
            w.updateFile(file, after);
          } else {
            ctx.toast('文件在审批期间发生了其他修改，本次未应用');
            return;
          }
        }
        ctx.toast(ctx.t('toast.verdict', { note: decision.note }));
      },
    },
    {
      id: 'agent.workflowReviewers',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfReviewers'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w6-reviewer-sim'),
    },
    {
      id: 'agent.workflowPolish',
      group: 'palette.group.workflow',
      featured: true,
      title: ctx.t('cmd.wfPolish'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w3-polish'),
    },
    {
      id: 'pdf.reopenLast',
      group: 'palette.group.compile',
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
      group: 'palette.group.project',
      title: ctx.t('cmd.externalDiff'),
      hint: ctx.t('hint.file'),
      run: () => useUiStore.getState().setExternalDiffOpen(true),
    },
    {
      id: 'wf.compress',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfCompress'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w14-compress'),
    },
    {
      id: 'wf.beamer',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfBeamer'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w13-beamer'),
    },
    {
      id: 'wf.promo',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfPromo'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w16-promo'),
    },
    {
      id: 'compile.aiFix',
      group: 'palette.group.compile',
      featured: true,
      title: ctx.t('cmd.aiFix'),
      hint: ctx.t('hint.compile'),
      run: () => void import('./aiActions').then(({ fixCompileErrors }) => fixCompileErrors()),
    },
    {
      id: 'export.docx',
      group: 'palette.group.project',
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
      group: 'palette.group.ai',
      title: ctx.t('cmd.importReviews'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setReviewsImportOpen(true),
    },
    {
      id: 'agent.workflowRelatedWork',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfRelatedWork'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w12-related-work'),
    },
    {
      id: 'agent.workflowSectionDraft',
      group: 'palette.group.workflow',
      featured: true,
      title: ctx.t('cmd.wfSectionDraft'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w2-section-draft'),
    },
    {
      id: 'agent.workflowChecklist',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfChecklist'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w10-pre-submission'),
    },
    {
      id: 'agent.workflowRebuttal',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfRebuttal'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().setWorkflowLaunch('w7-rebuttal'),
    },
    {
      id: 'agent.workflowCoverLetter',
      group: 'palette.group.workflow',
      title: ctx.t('cmd.wfCoverLetter'),
      hint: ctx.t('hint.agent'),
      run: () => useUiStore.getState().launchWorkflow('w11-cover-letter', { journal: '', highlights: '' }),
    },
    {
      id: 'submit.open',
      group: 'palette.group.submit',
      featured: true,
      title: ctx.t('cmd.submitPackage'),
      hint: ctx.t('hint.submit'),
      run: () => useUiStore.getState().setSidebarTab('submit'),
    },
    {
      id: 'submit.venue',
      group: 'palette.group.submit',
      featured: true,
      title: ctx.t('cmd.submitVenue'),
      hint: ctx.t('hint.submit'),
      run: () => useUiStore.getState().setSidebarTab('submit'),
    },
    {
      id: 'knowledge.notes',
      group: 'palette.group.knowledge',
      featured: true,
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
      group: 'palette.group.knowledge',
      featured: true,
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
