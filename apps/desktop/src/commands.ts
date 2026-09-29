/**
 * 命令面板命令注册表：面向真实 store 动作；UI 侧回调（打开设置、聚焦文件树、toast）经 ctx 注入。
 */

import type { Command } from './commandPalette';
import { t } from './i18n';
import { applyTheme } from './theme';
import { useSettingsStore } from './state/settingsStore';
import { useWorkspaceStore } from './state/workspaceStore';

export interface CommandContext {
  /** 翻译函数（通常来自 useT()） */
  t: (key: string) => string;
  openSettings: () => void;
  focusFileTree: () => void;
  toast: (message: string) => void;
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
      run: () => {
        const s = useWorkspaceStore.getState();
        // 编辑器（WS-A）接入前没有草稿态，用原内容回写即 no-op
        if (s.activeTab) s.updateFile(s.activeTab, s.files[s.activeTab] ?? '');
        ctx.toast(ctx.t('toast.saved'));
      },
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
      run: () => {
        const s = useWorkspaceStore.getState();
        s.setCompileStatus('running');
        window.setTimeout(() => {
          s.appendCompileLog(t('console.pending'));
          s.setCompileStatus('idle');
        }, 400);
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
