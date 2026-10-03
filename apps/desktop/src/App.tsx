/**
 * ScholarForge 桌面壳：三栏工作区（导航栏 | 大纲/文件/引用/文献侧栏 | 编辑器+PDF+控制台 | Agent 面板）。
 * 六条工作流已集成：WS-A 编辑器、WS-B 编译、WS-C 文献库与阅读、WS-D Agent 中枢、WS-E 知识底座、WS-F 应用设施。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  BookOpen,
  Brain,
  FileText,
  History,
  Library,
  ListTree,
  Home,
  MessageSquare,
  MessagesSquare,
  Quote,
  Send,
  Settings,
  Sparkles,
} from 'lucide-react';
import { CommandPalette } from './commandPalette';
import { buildCommands } from './commands';
import { useT } from './i18n';
import { applyTheme } from './theme';
import { initWorkspace, useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { quickAsk } from './aiActions';
import { initLibrary } from './state/libraryStore';
import { useLibraryStore } from './state/libraryStore';
import { useProposalStore } from './state/proposalStore';
import { initUpdateCheck } from './state/updateStore';
import { useAnnotationStore } from './state/annotationStore';
import { useUiStore } from './state/uiStore';
import { shouldShowTour } from './state/onboardingStore';
import { EditorTabs } from './components/EditorTabs';
import { FileTree } from './components/FileTree';
import { LazyPanel } from './components/LazyPanel';
import { ResizableLayout } from './components/ResizableLayout';
import { SettingsDialog } from './components/SettingsDialog';
import { SnapshotDialog } from './components/SnapshotDialog';
import { EditorArea } from './components/EditorArea';
import { QuickOpen, isQuickOpenTrigger } from './components/QuickOpen';
import { ShortcutsDialog, isShortcutsTrigger } from './components/ShortcutsDialog';
import { TemplateWizard } from './components/TemplateWizard';
import { UpdateBar } from './components/UpdateBar';
import { WelcomeTour } from './components/WelcomeTour';
import { OutlinePanel } from './panels/OutlinePanel';
import { CitationsPanel } from './panels/CitationsPanel';
import { GlossaryPanel } from './panels/GlossaryPanel';
import { LibraryPanel } from './panels/LibraryPanel';
import { AgentPanel } from './panels/AgentPanel';
import { hydrateAgentSessions, attachAgentSessionPersist } from './state/agentSessionPersist';
import { attachAutoCompile } from './compileAction';
import { parseProjectZip } from '@scholarforge/compile';
import { PdfReader } from '@scholarforge/library';
import { jumpPdfToSource, onPdfGoto } from './synctexBridge'; // WS-2 编译同步闭环（App 窄 carve-out）

const TOAST_MS = 2400;

export function App() {
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 欢迎导览（完整新手引导系统）：首屏判定一次，完成/稍后/跳过后经 onClose 卸载
  const [tourOpen, setTourOpen] = useState(false);

  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const knowledgeTab = useUiStore((s) => s.knowledgeTab);
  const setKnowledgeTab = useUiStore((s) => s.setKnowledgeTab);
  const requestPdfPicker = useUiStore((s) => s.requestPdfPicker);
  const pdfPickerTick = useUiStore((s) => s.pdfPickerTick);
  const zipPickerTick = useUiStore((s) => s.zipPickerTick);
  const pdfView = useUiStore((s) => s.pdfView);
  const setPdfView = useUiStore((s) => s.setPdfView);
  const centerView = useUiStore((s) => s.centerView);
  const setCenterView = useUiStore((s) => s.setCenterView);
  const templateWizardOpen = useUiStore((s) => s.templateWizardOpen);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const tableEditorOpen = useUiStore((s) => s.tableEditorOpen);
  const setTableEditorOpen = useUiStore((s) => s.setTableEditorOpen);
  const projectSwitcherOpen = useUiStore((s) => s.projectSwitcherOpen);
  const setProjectSwitcherOpen = useUiStore((s) => s.setProjectSwitcherOpen);
  const searchPanelOpen = useUiStore((s) => s.searchPanelOpen);
  const imageWizardOpen = useUiStore((s) => s.imageWizardOpen);
  const citationPickerOpen = useUiStore((s) => s.citationPickerOpen);
  const reviewsImportOpen = useUiStore((s) => s.reviewsImportOpen);
  const externalDiffOpen = useUiStore((s) => s.externalDiffOpen);
  const usageDialogOpen = useUiStore((s) => s.usageDialogOpen);
  const promptsLibOpen = useUiStore((s) => s.promptsLibOpen);
  const styleReportOpen = useUiStore((s) => s.styleReportOpen);
  const collabDialogOpen = useUiStore((s) => s.collabDialogOpen);
  const citeSuggestOpen = useUiStore((s) => s.citeSuggestOpen);
  const backupDialogOpen = useUiStore((s) => s.backupDialogOpen);
  const focusMode = useUiStore((s) => s.focusMode);
  const statsDialogOpen = useUiStore((s) => s.statsDialogOpen);
  const textDialog = useUiStore((s) => s.textDialog);
  const closeTextDialog = useUiStore((s) => s.closeTextDialog);
  const setHistoryOpen = useUiStore((s) => s.setHistoryOpen);
  const quickOpenOpen = useUiStore((s) => s.quickOpenOpen);
  const setQuickOpenOpen = useUiStore((s) => s.setQuickOpenOpen);
  const shortcutsOpen = useUiStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const requestAgentAction = useUiStore((s) => s.requestAgentAction);

  const projectName = useWorkspaceStore((s) => s.projectName);
  const compileLog = useWorkspaceStore((s) => s.compileLog);
  const compileStatus = useWorkspaceStore((s) => s.compileStatus);
  const clearCompileLog = useWorkspaceStore((s) => s.clearCompileLog);

  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const annotationsByFile = useAnnotationStore((s) => s.byFile);

  const sidebarRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const zipInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initWorkspace();
    void initLibrary();
    initUpdateCheck();
    // Agent 会话：启动恢复 + 变更防抖落盘（IndexedDB，重启不丢对话历史）
    void hydrateAgentSessions();
    const detach = attachAgentSessionPersist();
    // 保存后自动编译（桌面真实引擎；设置 autoCompile 可关）
    const detachAutoCompile = attachAutoCompile();
    return () => {
      detach();
      detachAutoCompile();
    };
  }, []);

  // 新手引导（P0）：首屏判定 shouldShowTour() —— 未完成导览且不在 24h「稍后」窗口内则弹出全屏导览。
  useEffect(() => {
    if (shouldShowTour()) setTourOpen(true);
  }, []);

  useEffect(() => applyTheme(theme), [theme]);

  // 专注模式：根节点打标，由 CSS 隐藏侧栏/导航/Agent 面板/控制台
  useEffect(() => {
    document.documentElement.classList.toggle('sf-focus', focusMode);
    return () => document.documentElement.classList.remove('sf-focus');
  }, [focusMode]);

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
        return;
      }
      if (isQuickOpenTrigger(e)) {
        e.preventDefault();
        setQuickOpenOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        // D4：编辑器内 Ctrl+Shift+Z 是 Redo，不切换专注模式
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el?.closest('input, textarea, .cm-content, [contenteditable="true"]')) return;
        e.preventDefault();
        const ui = useUiStore.getState();
        ui.setFocusMode(!ui.focusMode);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        // D6：宣传了的编译快捷键接线
        e.preventDefault();
        void import('./compileAction').then(({ runCompile }) => runCompile());
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') {
        e.preventDefault();
        useUiStore.getState().setHistoryOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === 'Escape' && useUiStore.getState().focusMode) {
        // D9：Esc 退出专注模式（有任意浮层打开时不抢 Esc）
        if (!document.querySelector('.sf-dialog-overlay, .palette-overlay')) {
          useUiStore.getState().setFocusMode(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        useUiStore.getState().setSearchPanelOpen(true);
        return;
      }
      if (isShortcutsTrigger(e, e.target)) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuickOpenOpen, setShortcutsOpen]);

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
    { id: 'home', label: t('nav.home'), icon: Home },
    { id: 'outline', label: t('nav.outline'), icon: ListTree },
    { id: 'files', label: t('nav.files'), icon: FileText },
    { id: 'citations', label: t('nav.citations'), icon: Quote },
    { id: 'library', label: t('nav.library'), icon: Library },
    { id: 'knowledge', label: t('nav.knowledge'), icon: Brain },
    { id: 'submit', label: t('nav.submit'), icon: Send },
    { id: 'comments', label: t('nav.comments'), icon: MessagesSquare },
  ];

  const commands = useMemo(
    () =>
      buildCommands({
        t,
        openSettings: () => setSettingsOpen(true),
        focusFileTree,
        toast: showToast,
      }),
    // language 变化时重建：buildCommands 的新命令标题来自组件内本地字典（跟随设置语言）
    [t, language, focusFileTree, showToast],
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
        {sidebarTab === 'home' ? (
          <LazyPanel file="Dashboard" labelKey="nav.home" />
        ) : sidebarTab === 'files' ? (
          <FileTree />
        ) : sidebarTab === 'outline' ? (
          <OutlinePanel />
        ) : sidebarTab === 'citations' ? (
          <CitationsPanel />
        ) : sidebarTab === 'knowledge' ? (
          <>
            <div className="sf-subtabs" role="tablist">
              <button
                role="tab"
                aria-selected={knowledgeTab === 'glossary'}
                className={knowledgeTab === 'glossary' ? 'active' : ''}
                onClick={() => setKnowledgeTab('glossary')}
              >
                {t('knowledge.glossary')}
              </button>
              <button
                role="tab"
                aria-selected={knowledgeTab === 'notes'}
                className={knowledgeTab === 'notes' ? 'active' : ''}
                onClick={() => setKnowledgeTab('notes')}
              >
                {t('knowledge.notes')}
              </button>
              <button
                role="tab"
                aria-selected={knowledgeTab === 'memory'}
                className={knowledgeTab === 'memory' ? 'active' : ''}
                onClick={() => setKnowledgeTab('memory')}
              >
                {t('knowledge.memory')}
              </button>
            </div>
            {knowledgeTab === 'glossary' ? (
              <GlossaryPanel />
            ) : knowledgeTab === 'memory' ? (
              <LazyPanel file="MemoryPanel" labelKey="knowledge.memory" />
            ) : (
              <LazyPanel file="NotesPanel" labelKey="knowledge.notes" />
            )}
          </>
        ) : sidebarTab === 'submit' ? (
          <LazyPanel file="SubmitPanel" labelKey="nav.submit" />
        ) : sidebarTab === 'comments' ? (
          <LazyPanel file="CommentsPanel" labelKey="nav.comments" />
        ) : (
          <LibraryPanel />
        )}
      </div>
    </aside>
  );

  // —— WS-2 编译同步闭环（App 窄 carve-out）：订阅 onPdfGoto 并镜像为 PdfReader 的 goto props ——
  const [pdfGotoPage, setPdfGotoPage] = useState<number | undefined>(undefined);
  const [pdfGotoTick, setPdfGotoTick] = useState(0);
  useEffect(
    () =>
      onPdfGoto((g) => {
        setPdfGotoPage(g.page);
        setPdfGotoTick((v) => v + 1);
        setCenterView('pdf');
      }),
    [setCenterView],
  );

  /**
   * PDF 选中文字 → 引述到稿件（v1.8.0 ②）：
   * 选中 → 格式化为 LaTeX 引述块（% 来源注释 + \cite{citekey}）→ diff 审批卡。
   * citekey 经 pdfView.name（`${citekey}.pdf`）反查文献库。
   */
  const insertPdfQuote = (text: string, pdfName: string): void => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) return;
    const citekey = pdfName.replace(/\.pdf$/, '');
    const paper = useLibraryStore.getState().papers.find((p) => p.citekey === citekey);
    const year = paper?.year ? ` (${paper.year})` : '';
    const author = paper?.authors?.[0]?.family ?? '';
    const quote = text.trim().replace(/\s+/g, ' ').slice(0, 500);
    if (!quote) return;
    // 格式：引述段（来源注释 + 内容 + 归属）——内容不加引号（学术引述不直接引号包裹，由上下文衔接）
    const block = [
      `% Quoted from ${citekey}${year ? ` (${year})` : ''}${author ? ` by ${author}` : ''}:`,
      `${quote}~\\cite{${citekey}}`,
    ].join('\n');
    const before = ws.files[file] ?? '';
    const after = before.endsWith('\n') ? before + block + '\n\n' : before + '\n\n' + block + '\n\n';
    useProposalStore.getState().setProposal({
      file,
      before,
      after,
      kind: 'draft-section',
      label: `引述：${citekey}（PDF 选中 → 稿件）`,
      via: 'PDF quote',
    });
    // 切回编辑器让用户看到审批卡（Agent 面板在编辑器视图旁）
    useUiStore.getState().setCenterView(centerView === 'split' ? 'split' : 'editor');
  };

  const editor = (
    <section className="center">
      {pdfView ? (
        <div className="tabbar sf-pdfbar">
          <button
            className={`tab ${centerView === 'editor' ? 'active' : ''}`}
            onClick={() => setCenterView('editor')}
          >
            {t('center.editorTab')}
          </button>
          <button
            className={`tab ${centerView === 'pdf' ? 'active' : ''}`}
            onClick={() => setCenterView('pdf')}
          >
            {t('center.pdfTab')} · {pdfView.name}
          </button>
          <button
            className={`tab sf-split-btn ${centerView === 'split' ? 'active' : ''}`}
            onClick={() => setCenterView(centerView === 'split' ? 'editor' : 'split')}
            title={t('center.splitHint')}
          >
            {t('center.split')}
          </button>
          <button className="sf-link-btn sf-pdfbar-close" onClick={() => setPdfView(null)}>
            {t('center.closePdf')}
          </button>
        </div>
      ) : (
        <EditorTabs
          actions={
            <>
              <button
                className="tab-action"
                title={t('tab.polishTitle')}
                onClick={() => requestAgentAction('polish')}
              >
                <Sparkles size={13} /> {t('tab.polish')}
              </button>
              <button
                className="tab-action"
                title={t('tab.historyTitle')}
                onClick={() => setHistoryOpen(true)}
              >
                <History size={13} /> {t('tab.history')}
              </button>
            </>
          }
        />
      )}
      <div className={`editor-area ${centerView === 'split' && pdfView ? 'sf-split' : ''}`}>
        {pdfView && (centerView === 'pdf' || centerView === 'split') ? (
          <PdfReader
            key={pdfView.name}
            data={pdfView.data}
            language={language}
            annotations={annotationsByFile[useAnnotationStore.getState().resolveKey(pdfView.name)] ?? []}
            onCreateAnnotation={(a) => {
              const key = useAnnotationStore.getState().resolveKey(pdfView.name);
              const paperId = useAnnotationStore.getState().paperIdOf(pdfView.name) ?? '';
              useAnnotationStore.getState().add(key, { ...a, paperId: paperId || a.paperId });
            }}
            onDeleteAnnotation={(id) => {
              const key = useAnnotationStore.getState().resolveKey(pdfView.name);
              useAnnotationStore.getState().remove(key, id);
            }}
            askActions={[
              { label: language === 'en' ? 'Explain' : '解释', run: (text) => quickAsk('explain', text) },
              { label: language === 'en' ? 'Translate' : '翻译', run: (text) => quickAsk('translate', text) },
              { label: language === 'en' ? 'Find refs' : '找文献', run: (text) => quickAsk('find', text) },
              {
                label: language === 'en' ? 'Quote → manuscript' : '引述到稿件',
                run: (text) => insertPdfQuote(text, pdfView.name),
              },
            ]}
            onPagePoint={(p, x, y) => {
              jumpPdfToSource(p, x, y);
            }}
            gotoPage={pdfGotoPage}
            gotoTick={pdfGotoTick || undefined}
          />
        ) : null}
        {(!pdfView || centerView === 'editor' || centerView === 'split') && <EditorArea />}
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
      <UpdateBar />
      <header className="topbar">
        <div className="brand">ScholarForge</div>
        <button
          className="sf-project-name"
          title={t('cmd.manageProjects')}
          onClick={() => useUiStore.getState().setProjectSwitcherOpen(true)}
        >
          {projectName || '未命名项目'}
        </button>
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          {t('palette.trigger')} <kbd>⌘K</kbd>
        </button>
        <div className="topbar-right">
          <span
            className={`status-chip ${compileStatus === 'ok' ? 'ok' : compileStatus === 'fail' ? 'err' : compileStatus === 'running' ? 'run' : ''}`}
          >
            {t(compileLabelKey)}
          </span>
          <span className="status-chip">{t('topbar.gitChip')}</span>
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
              t('toast.zipImported', {
                entry: parsed.entry,
                count: Object.keys(parsed.files).length,
                skipped:
                  parsed.skippedBinary.length > 0
                    ? t('toast.zipSkipped', { count: parsed.skippedBinary.length })
                    : '',
              }),
            );
          } catch (err) {
            showToast(t('toast.zipImportFailed', { reason: err instanceof Error ? err.message : String(err) }));
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

      {quickOpenOpen && <QuickOpen onClose={() => setQuickOpenOpen(false)} />}

      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}

      {templateWizardOpen && <TemplateWizard onDone={showToast} />}

      {historyOpen && <SnapshotDialog onClose={() => setHistoryOpen(false)} />}

      {tableEditorOpen && <LazyFeatureDialog file="TableEditor" onClose={() => setTableEditorOpen(false)} />}

      {projectSwitcherOpen && <LazyFeatureDialog file="ProjectSwitcher" onClose={() => setProjectSwitcherOpen(false)} />}

      {searchPanelOpen && <LazyFeatureDialog file="SearchPanel" onClose={() => useUiStore.getState().setSearchPanelOpen(false)} />}

      {imageWizardOpen && <LazyFeatureDialog file="ImageWizard" onClose={() => useUiStore.getState().setImageWizardOpen(false)} />}

      {citationPickerOpen && <LazyFeatureDialog file="CitationPicker" onClose={() => useUiStore.getState().setCitationPickerOpen(false)} />}

      {backupDialogOpen && <LazyFeatureDialog file="BackupDialog" onClose={() => useUiStore.getState().setBackupDialogOpen(false)} />}

      {statsDialogOpen && <LazyFeatureDialog file="StatsDialog" onClose={() => useUiStore.getState().setStatsDialogOpen(false)} />}

      {reviewsImportOpen && <LazyFeatureDialog file="ReviewsImportDialog" onClose={() => useUiStore.getState().setReviewsImportOpen(false)} />}

      {externalDiffOpen && <LazyFeatureDialog file="ExternalDiffDialog" onClose={() => useUiStore.getState().setExternalDiffOpen(false)} />}

      {usageDialogOpen && <LazyFeatureDialog file="UsagePanel" onClose={() => useUiStore.getState().setUsageDialogOpen(false)} />}
      {promptsLibOpen && <LazyFeatureDialog file="PromptLibraryDialog" onClose={() => useUiStore.getState().setPromptsLibOpen(false)} />}
      {styleReportOpen && <LazyFeatureDialog file="StyleReportDialog" onClose={() => useUiStore.getState().setStyleReportOpen(false)} />}
      {collabDialogOpen && <LazyFeatureDialog file="CollabMergeDialog" onClose={() => useUiStore.getState().setCollabDialogOpen(false)} />}
      {citeSuggestOpen && <LazyFeatureDialog file="CitationSuggest" onClose={() => useUiStore.getState().setCiteSuggestOpen(false)} />}

      {textDialog && <LazyFeatureDialog file="TextDialog" onClose={closeTextDialog} />}

      {tourOpen && <WelcomeTour onClose={() => setTourOpen(false)} />}

      {toast && <div className="sf-toast">{toast}</div>}
    </div>
  );
}

/**
 * 并行功能对话框的懒加载挂载点：模块由并行工作流提供（components/TableEditor.tsx、
 * components/ProjectSwitcher.tsx），约定导出与文件名同名、props 为 { onClose: () => void }。
 * glob 容忍文件暂缺（构建不报错），加载失败显示占位卡。
 */
function LazyFeatureDialog({
  file,
  onClose,
}: {
  file:
    | 'TableEditor'
    | 'ProjectSwitcher'
    | 'SearchPanel'
    | 'ImageWizard'
    | 'TextDialog'
    | 'CitationPicker'
    | 'BackupDialog'
    | 'StatsDialog'
    | 'ReviewsImportDialog'
    | 'ExternalDiffDialog'
    | 'UsagePanel'
    | 'PromptLibraryDialog'
    | 'StyleReportDialog'
    | 'CollabMergeDialog'
    | 'CitationSuggest';
  onClose: () => void;
}) {
  const modules = import.meta.glob<Record<string, unknown>>(
    './components/{TableEditor,ProjectSwitcher,SearchPanel,ImageWizard,TextDialog,CitationPicker,BackupDialog,StatsDialog,ReviewsImportDialog,ExternalDiffDialog,UsagePanel,PromptLibraryDialog,StyleReportDialog,CollabMergeDialog,CitationSuggest}.tsx',
  );
  const [Comp, setComp] = useState<ComponentType<{ onClose: () => void }> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const loader = modules[`./components/${file}.tsx`];
    if (!loader) {
      setFailed(true);
      return;
    }
    loader()
      .then((mod) => {
        const exported = mod[file];
        // 注意：setState 传函数会被 React 当作 updater 调用，必须再包一层函数式更新
        if (alive && typeof exported === 'function') setComp(() => exported as ComponentType<{ onClose: () => void }>);
        else if (alive) setFailed(true);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  if (failed) {
    return (
      <div className="sf-dialog-overlay" onMouseDown={onClose}>
        <div className="sf-dialog" onMouseDown={(e) => e.stopPropagation()}>
          <div className="sf-dialog-body">
            <p className="placeholder">组件加载失败（{file}）—— 请确认对应工作流已合入。</p>
          </div>
        </div>
      </div>
    );
  }
  if (!Comp) return <p className="placeholder" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 200 }}>加载中…</p>;
  return <Comp onClose={onClose} />;
}
