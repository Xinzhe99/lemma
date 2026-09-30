/**
 * ScholarForge 桌面壳：三栏工作区（导航栏 | 大纲/文件/引用/文献侧栏 | 编辑器+PDF+控制台 | Agent 面板）。
 * 六条工作流已集成：WS-A 编辑器、WS-B 编译、WS-C 文献库与阅读、WS-D Agent 中枢、WS-E 知识底座、WS-F 应用设施。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, FileText, History, Library, ListTree, MessageSquare, Quote, Settings, Sparkles } from 'lucide-react';
import { CommandPalette } from './commandPalette';
import { buildCommands } from './commands';
import { useT } from './i18n';
import { applyTheme } from './theme';
import { initWorkspace, useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { initLibrary } from './state/libraryStore';
import { useAnnotationStore } from './state/annotationStore';
import { useUiStore } from './state/uiStore';
import { EditorTabs } from './components/EditorTabs';
import { FileTree } from './components/FileTree';
import { ResizableLayout } from './components/ResizableLayout';
import { SettingsDialog } from './components/SettingsDialog';
import { SnapshotDialog } from './components/SnapshotDialog';
import { EditorArea } from './components/EditorArea';
import { TemplateWizard } from './components/TemplateWizard';
import { OutlinePanel } from './panels/OutlinePanel';
import { CitationsPanel } from './panels/CitationsPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { AgentPanel } from './panels/AgentPanel';
import { parseProjectZip } from '@scholarforge/compile';
import { PdfReader } from '@scholarforge/library';

const TOAST_MS = 2400;

export function App() {
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const requestPdfPicker = useUiStore((s) => s.requestPdfPicker);
  const pdfPickerTick = useUiStore((s) => s.pdfPickerTick);
  const zipPickerTick = useUiStore((s) => s.zipPickerTick);
  const pdfView = useUiStore((s) => s.pdfView);
  const setPdfView = useUiStore((s) => s.setPdfView);
  const centerView = useUiStore((s) => s.centerView);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const templateWizardOpen = useUiStore((s) => s.templateWizardOpen);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
  const requestAgentAction = useUiStore((s) => s.requestAgentAction);

  const projectName = useWorkspaceStore((s) => s.projectName);
  const compileLog = useWorkspaceStore((s) => s.compileLog);
  const compileStatus = useWorkspaceStore((s) => s.compileStatus);
  const clearCompileLog = useWorkspaceStore((s) => s.clearCompileLog);

  const theme = useSettingsStore((s) => s.theme);
  const annotationsByFile = useAnnotationStore((s) => s.byFile);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initWorkspace();
    void initLibrary();
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // 命令面板 / 阅读入口触发 PDF 文件选择
  useEffect(() => {
    if (pdfPickerTick > 0) pdfInputRef.current?.click();
  }, [pdfPickerTick]);

  // 命令面板触发项目 zip 导入（Overleaf: Menu → Source → Download Source）
  useEffect(() => {
    if (zipPickerTick > 0) zipInputRef.current?.click();
  }, [zipPickerTick]);

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
  }, [setSidebarTab]);

  const sidebarTabs: { id: typeof sidebarTab; label: string; icon: typeof ListTree }[] = [
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
      <button className="nav-btn" title={t('nav.reading')} onClick={requestPdfPicker}>
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
        ) : sidebarTab === 'outline' ? (
          <OutlinePanel />
        ) : sidebarTab === 'citations' ? (
          <CitationsPanel />
        ) : (
          <LibraryPanel />
        )}
      </div>
    </aside>
  );

  const editor = (
    <section className="center">
      {pdfView ? (
        <div className="tabbar sf-pdfbar">
          <button
            className={`tab ${centerView === 'editor' ? 'active' : ''}`}
            onClick={() => setCenterView('editor')}
          >
            编辑器
          </button>
          <button
            className={`tab ${centerView === 'pdf' ? 'active' : ''}`}
            onClick={() => setCenterView('pdf')}
          >
            PDF · {pdfView.name}
          </button>
          <button className="sf-link-btn sf-pdfbar-close" onClick={() => setPdfView(null)}>
            关闭
          </button>
        </div>
      ) : (
        <EditorTabs
          actions={
            <>
              <button
                className="tab-action"
                title="AI 润色当前文件（diff 审批后落盘）"
                onClick={() => requestAgentAction('polish')}
              >
                <Sparkles size={13} /> 润色
              </button>
              <button
                className="tab-action"
                title="快照历史（AI 修改自动创建，可恢复）"
                onClick={() => setHistoryOpen(true)}
              >
                <History size={13} /> 历史
              </button>
            </>
          }
        />
      )}
      <div className="editor-area">
        {pdfView && centerView === 'pdf' ? (
          <PdfReader
            key={pdfView.name}
            data={pdfView.data}
            annotations={annotationsByFile[pdfFileKey(pdfView.name)] ?? []}
            onCreateAnnotation={(a) => {
              const key = pdfFileKey(pdfView.name);
              useAnnotationStore.getState().add(key, { ...a, paperId: key });
            }}
          />
        ) : (
          <EditorArea />
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
      <AgentPanel />
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
          <span
            className={`status-chip ${compileStatus === 'ok' ? 'ok' : compileStatus === 'fail' ? 'err' : compileStatus === 'running' ? 'run' : ''}`}
          >
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

      <input
        ref={pdfInputRef}
        type="file"
        accept="application/pdf"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          const data = await file.arrayBuffer();
          setPdfView({ name: file.name, data });
        }}
      />

      <input
        ref={zipInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          try {
            const parsed = parseProjectZip(new Uint8Array(await file.arrayBuffer()));
            useWorkspaceStore
              .getState()
              .loadProject(file.name.replace(/\.zip$/i, '') || 'imported-project', parsed.entry, parsed.files);
            showToast(
              `已导入项目（入口 ${parsed.entry}，${Object.keys(parsed.files).length} 个文本文件` +
                (parsed.skippedBinary.length > 0 ? `，跳过 ${parsed.skippedBinary.length} 个二进制文件）` : '）'),
            );
          } catch (err) {
            showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
          }
        }}
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

      {templateWizardOpen && <TemplateWizard onDone={showToast} />}

      {historyOpen && <SnapshotDialog onClose={() => setHistoryOpen(false)} />}

      {toast && <div className="sf-toast">{toast}</div>}
    </div>
  );
}

/** PDF 标注的持久化键：按文件名记忆（同名文件重开时恢复标注） */
function pdfFileKey(name: string): string {
  return `pdf:${name}`;
}
