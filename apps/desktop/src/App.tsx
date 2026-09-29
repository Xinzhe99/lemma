/**
 * ScholarForge 桌面壳：三栏工作区（导航栏 | 文件/大纲侧栏 | 编辑器+控制台 | Agent 面板）。
 * WS-F 里程碑：平台抽象、状态持久化、命令面板、设置、主题与 i18n；编辑器/编译/Agent 为后续工作流占位。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, Library, ListTree, MessageSquare, Quote, Settings } from 'lucide-react';
import { CommandPalette } from './commandPalette';
import { buildCommands } from './commands';
import { useT } from './i18n';
import { applyTheme } from './theme';
import { initWorkspace, useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { EditorTabs } from './components/EditorTabs';
import { FileTree } from './components/FileTree';
import { ResizableLayout } from './components/ResizableLayout';
import { SettingsDialog } from './components/SettingsDialog';

type SidebarTab = 'outline' | 'files' | 'citations' | 'library';

const TOAST_MS = 2400;

export function App() {
  const t = useT();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const projectName = useWorkspaceStore((s) => s.projectName);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const compileLog = useWorkspaceStore((s) => s.compileLog);
  const compileStatus = useWorkspaceStore((s) => s.compileStatus);
  const clearCompileLog = useWorkspaceStore((s) => s.clearCompileLog);

  const theme = useSettingsStore((s) => s.theme);
  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void initWorkspace();
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const focusFileTree = useCallback(() => {
    setSidebarTab('files');
    sidebarRef.current?.focus();
  }, []);

  const sidebarTabs: { id: SidebarTab; label: string; icon: typeof ListTree }[] = [
    { id: 'outline', label: t('nav.outline'), icon: ListTree },
    { id: 'files', label: t('nav.files'), icon: FileText },
    { id: 'citations', label: t('nav.citations'), icon: Quote },
    { id: 'library', label: t('nav.library'), icon: Library },
  ];

  const commands = useMemo(
    () =>
      buildCommands({
        t,
        openSettings: () => setSettingsOpen(true),
        focusFileTree,
        toast: showToast,
      }),
    [t, focusFileTree, showToast],
  );

  const activeProvider = providers.find((p) => p.id === activeProviderId) ?? null;
  const compileLabelKey =
    compileStatus === 'running'
      ? 'compile.running'
      : compileStatus === 'ok'
        ? 'compile.ok'
        : compileStatus === 'fail'
          ? 'compile.fail'
          : 'compile.idle';

  const sidebarTitle = sidebarTabs.find((tb) => tb.id === sidebarTab)?.label ?? '';

  const navRail = (
    <nav className="nav-rail">
      {sidebarTabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`nav-btn ${sidebarTab === id ? 'active' : ''}`}
          title={label}
          onClick={() => setSidebarTab(id)}
        >
          <Icon size={18} />
        </button>
      ))}
      <div className="nav-spacer" />
      <button className="nav-btn" title={t('nav.reading')}>
        <BookOpen size={18} />
      </button>
    </nav>
  );

  const sidebar = (
    <aside className="sidebar">
      <div className="sidebar-title">{sidebarTitle}</div>
      <div className="sidebar-body" ref={sidebarRef} tabIndex={-1}>
        {sidebarTab === 'files' ? (
          <FileTree />
        ) : (
          <p className="placeholder">{t('placeholder.wsac')}</p>
        )}
      </div>
    </aside>
  );

  const editor = (
    <section className="center">
      <EditorTabs />
      <div className="editor-area">
        {activeTab ? (
          <div className="sf-editor-placeholder">
            <div className="sf-editor-file">{activeTab}</div>
            <p className="placeholder">{t('editor.pending')}</p>
          </div>
        ) : (
          <p className="placeholder">{t('editor.noOpen')}</p>
        )}
      </div>
    </section>
  );

  const consolePane = (
    <section className="console">
      <div className="console-title">
        <span>{t('console.title')}</span>
        <button className="sf-link-btn" onClick={clearCompileLog}>
          {t('console.clear')}
        </button>
      </div>
      <div className="console-body">
        {compileLog.length === 0 ? (
          <p className="placeholder">{t('console.pending')}</p>
        ) : (
          compileLog.map((line, i) => (
            <div key={i} className="console-line">
              {line}
            </div>
          ))
        )}
      </div>
    </section>
  );

  const agent = (
    <aside className="agent-panel">
      <div className="panel-title">
        <MessageSquare size={14} /> {t('agent.title')}
      </div>
      <div className="panel-body">
        <p className="placeholder">{t('agent.pending')}</p>
        <div className="sf-provider-chip">
          {t('agent.provider')}：{activeProvider ? activeProvider.label : t('agent.noProvider')}
        </div>
      </div>
    </aside>
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">ScholarForge</div>
        <span className="sf-project-name">{projectName}</span>
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          {t('palette.trigger')} <kbd>⌘K</kbd>
        </button>
        <div className="topbar-right">
          <span className={`status-chip ${compileStatus === 'ok' ? 'ok' : compileStatus === 'fail' ? 'err' : compileStatus === 'running' ? 'run' : ''}`}>
            {t(compileLabelKey)}
          </span>
          <span className="status-chip">Git ◐</span>
          <button className="icon-btn" title={t('cmd.settings')} onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <ResizableLayout
        navRail={navRail}
        sidebar={sidebar}
        editor={editor}
        console={consolePane}
        agent={agent}
      />

      {paletteOpen && (
        <CommandPalette
          commands={commands}
          onClose={() => setPaletteOpen(false)}
          placeholder={t('palette.placeholder')}
          emptyText={t('palette.empty')}
        />
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {toast && <div className="sf-toast">{toast}</div>}
    </div>
  );
}
