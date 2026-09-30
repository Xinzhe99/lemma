/**
 * 命令面板命令注册表：面向真实 store 动作；UI 侧回调（打开设置、聚焦文件树、toast）经 ctx 注入。
 * compile.run 已接入 WS-B 编译流水线（浏览器形态使用 MockEngine，真实引擎待 Tauri CommandRunner 桥）。
 */

import type { Command } from './commandPalette';
import { t } from './i18n';
import { applyTheme } from './theme';
import { MockEngine, diagnosticHint, runFullCompile } from '@scholarforge/compile';
import { useAgentHubStore } from '@scholarforge/agent-hub';
import { useSettingsStore } from './state/settingsStore';
import { useUiStore } from './state/uiStore';
import { useWorkspaceStore } from './state/workspaceStore';

export interface CommandContext {
  /** 翻译函数（通常来自 useT()） */
  t: (key: string) => string;
  openSettings: () => void;
  focusFileTree: () => void;
  toast: (message: string) => void;
}

/** 浏览器形态的占位 CommandRunner：MockEngine 不执行命令，仅满足接口 */
const idleRunner = {
  async run(): Promise<{ code: number; stdout: string; stderr: string }> {
    return { code: 0, stdout: '', stderr: '' };
  },
};

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
      title: '从模板新建项目（6 套起步模板，含中文 ctex）',
      hint: '项目',
      run: () => useUiStore.getState().setTemplateWizardOpen(true),
    },
    {
      id: 'project.importZip',
      title: '导入 Overleaf / LaTeX 项目 zip',
      hint: '项目',
      run: () => useUiStore.getState().requestZipPicker(),
    },
    {
      id: 'file.new',
      title: ctx.t('cmd.newFile'),
      hint: ctx.t('hint.file'),
      run: () => {
        const path = window.prompt(ctx.t('prompt.newFilePath'), 'sections/notes.tex');
        const trimmed = path?.trim();
        if (!trimmed) return;
        useWorkspaceStore.getState().createFile(trimmed, '');
        ctx.toast(`${ctx.t('toast.fileCreated')}: ${trimmed}`);
      },
    },
    {
      id: 'file.save',
      title: ctx.t('cmd.save'),
      hint: ctx.t('hint.file'),
      kbd: 'Ctrl+S',
      run: () => ctx.toast(ctx.t('toast.saved')),
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
        const s = useWorkspaceStore.getState();
        const entry = s.files['main.tex'] !== undefined ? 'main.tex' : s.entry;
        if (!entry || !(entry in s.files)) {
          ctx.toast('未找到可编译的 .tex 入口文件');
          return;
        }
        s.setCompileStatus('running');
        s.appendCompileLog(`▶ 开始编译 ${entry}（浏览器形态：MockEngine 模拟；本地 Tectonic 待 Tauri 桥接）`);
        const result = await runFullCompile(
          { files: s.files, entry },
          new MockEngine({ latencyMs: 400 }),
          idleRunner,
        );
        s.appendCompileLog(
          `▣ ${result.engine} · ${result.passes} 趟 · ${result.durationMs}ms · ${result.success ? '成功' : '失败'}`,
        );
        for (const d of result.diagnostics) {
          const loc = `${d.file ?? entry}${d.line ? `:${d.line}` : ''}`;
          s.appendCompileLog(`  [${d.severity}] ${loc} ${d.message}`);
          const hint = diagnosticHint(d);
          if (hint) s.appendCompileLog(`    ↳ 修复提示：${hint}`);
        }
        s.setCompileStatus(result.success ? 'ok' : 'fail');
      },
    },
    {
      id: 'library.importBibtex',
      title: '导入 BibTeX 到文献库',
      hint: '文献',
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryDialog('bibtex');
      },
    },
    {
      id: 'library.fetchMetadata',
      title: '按 DOI / arXiv ID 抓取文献元数据',
      hint: '文献',
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryDialog('fetch');
      },
    },
    {
      id: 'reader.openPdf',
      title: '打开本地 PDF 阅读（标注 + 选中即问）',
      hint: '阅读',
      run: () => useUiStore.getState().requestPdfPicker(),
    },
    {
      id: 'library.discover',
      title: '文献发现：检索 arXiv + Crossref 并一键入库',
      hint: '文献',
      run: () => {
        const ui = useUiStore.getState();
        ui.setSidebarTab('library');
        ui.setLibraryMode('discover');
      },
    },
    {
      id: 'agent.polish',
      title: 'AI 润色当前文件（diff 审批后落盘）',
      hint: 'Agent',
      run: () => useUiStore.getState().requestAgentAction('polish'),
    },
    {
      id: 'agent.draft',
      title: 'AI 起草新章节（diff 审批后落盘）',
      hint: 'Agent',
      run: () => useUiStore.getState().requestAgentAction('draft'),
    },
    {
      id: 'view.history',
      title: '查看当前文件快照历史（可恢复）',
      hint: '版本',
      kbd: 'Ctrl+H',
      run: () => useUiStore.getState().setHistoryOpen(true),
    },
    {
      id: 'agent.newSession',
      title: '新建 Agent 会话',
      hint: 'Agent',
      run: () => useAgentHubStore.getState().newSession('host'),
    },
    {
      id: 'agent.workflowReviewers',
      title: '运行工作流：三审稿人仿真（W6）',
      hint: 'Agent',
      run: () => useUiStore.getState().setWorkflowLaunch('w6-reviewer-sim'),
    },
    {
      id: 'agent.workflowPolish',
      title: '运行工作流：学术润色（W3，含 diff 审批检查点）',
      hint: 'Agent',
      run: () => useUiStore.getState().setWorkflowLaunch('w3-polish'),
    },
    {
      id: 'agent.workflowChecklist',
      title: '运行工作流：预提交自检（W10）',
      hint: 'Agent',
      run: () => useUiStore.getState().setWorkflowLaunch('w10-pre-submission'),
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
