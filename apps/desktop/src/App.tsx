/**
 * Lemma 桌面壳：三栏工作区（导航栏 | 大纲/文件/引用/文献侧栏 | 编辑器+PDF+控制台 | Agent 面板）。
 * 六条工作流已集成：WS-A 编辑器、WS-B 编译、WS-C 文献库与阅读、WS-D Agent 中枢、WS-E 知识底座、WS-F 应用设施。
 */

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import {
  FileText,
  GitBranch,
  History,
  Library,
  MessageSquare,
  MessagesSquare,
  Settings,
  Sparkles,
} from 'lucide-react';
import { CommandPalette } from './commandPalette';
import { buildCommands } from './commands';
import { isModalOverlayOpen } from './dialogs';
import { useT } from './i18n';
import { applyTheme } from './theme';
import { initWorkspace, useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { quickAsk, sendChatMessage } from './aiActions';
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
import { Columns2 } from 'lucide-react';
import { QuickOpen, isQuickOpenTrigger } from './components/QuickOpen';
import { ShortcutsDialog, isShortcutsTrigger } from './components/ShortcutsDialog';
import { TemplateWizard } from './components/TemplateWizard';
import { UpdateBar } from './components/UpdateBar';
import { WelcomeTour } from './components/WelcomeTour';
import { AgentPanel } from './panels/AgentPanel';
import { SessionsPanel } from './panels/SessionsPanel';
import { GitPanel } from './panels/GitPanel';
import { detectGitAvailability } from './git/gitService';
import { isMacOSPlatform } from './updater/relaunch';
import { hydrateAgentSessions, attachAgentSessionPersist } from './state/agentSessionPersist';
import { attachAutoCompile } from './compileAction';
import { parseProjectZip } from '@lemma/compile';

// PDF 阅读器分包（v4.2.0）：pdfjs-dist 体积大且非启动必需——默认不加载，
// 打开 PDF 时才拉取 reader 子入口；主线程空闲后在后台预热分包，首次打开近乎即时。
const LazyPdfReader = lazy(async () => {
  const mod = await import('@lemma/library/reader');
  return { default: mod.PdfReader };
});

function warmPdfChunk(): void {
  const load = () => {
    void import('@lemma/library/reader');
    // editor 包已在主 bundle（AgentPanel 等），此处只触发 katex 子 chunk 预热
    void import('@lemma/editor').then(({ warmMathPreview }) => warmMathPreview());
    // v5.1.0 开箱即用：闲时预下载内置 Tectonic 引擎 + 预热宏包缓存（幂等、静默）
    void import('./texSetup').then(({ warmCompileEngineDefault }) =>
      warmCompileEngineDefault().catch(() => undefined),
    );
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(load, { timeout: 8000 });
  else setTimeout(load, 3000);
}
import { jumpPdfToSource, onPdfGoto } from './synctexBridge'; // WS-2 编译同步闭环（App 窄 carve-out）

export function App() {
  const t = useT();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 轻提示：跨面板消息（项目创建/磁盘合并等）经 uiStore.showToast 解耦（原 App 本地 state 迁入 store）
  const toast = useUiStore((s) => s.toast);
  // 欢迎导览（完整新手引导系统）：首屏判定一次，完成/稍后/跳过后经 onClose 卸载
  const [tourOpen, setTourOpen] = useState(false);

  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const setSidebarTab = useUiStore((s) => s.setSidebarTab);
  const knowledgeTab = useUiStore((s) => s.knowledgeTab);
  const setKnowledgeTab = useUiStore((s) => s.setKnowledgeTab);
  const pdfPickerTick = useUiStore((s) => s.pdfPickerTick);
  const zipPickerTick = useUiStore((s) => s.zipPickerTick);
  const pdfView = useUiStore((s) => s.pdfView);
  const setPdfView = useUiStore((s) => s.setPdfView);
  const templateWizardOpen = useUiStore((s) => s.templateWizardOpen);
  const historyOpen = useUiStore((s) => s.historyOpen);
  const tableEditorOpen = useUiStore((s) => s.tableEditorOpen);
  const setTableEditorOpen = useUiStore((s) => s.setTableEditorOpen);
  const projectSwitcherOpen = useUiStore((s) => s.projectSwitcherOpen);
  const setProjectSwitcherOpen = useUiStore((s) => s.setProjectSwitcherOpen);
  const newProjectDialogOpen = useUiStore((s) => s.newProjectDialogOpen);
  const searchPanelOpen = useUiStore((s) => s.searchPanelOpen);
  const imageWizardOpen = useUiStore((s) => s.imageWizardOpen);
  const citationPickerOpen = useUiStore((s) => s.citationPickerOpen);
  const reviewsImportOpen = useUiStore((s) => s.reviewsImportOpen);
  const externalDiffOpen = useUiStore((s) => s.externalDiffOpen);
  const usageDialogOpen = useUiStore((s) => s.usageDialogOpen);
  const promptsLibOpen = useUiStore((s) => s.promptsLibOpen);
  const collabDialogOpen = useUiStore((s) => s.collabDialogOpen);
  const citeSuggestOpen = useUiStore((s) => s.citeSuggestOpen);
  const quickCiteOpen = useUiStore((s) => s.quickCiteOpen);
  const helpPanelOpen = useUiStore((s) => s.helpPanelOpen);
  const imageToLatexOpen = useUiStore((s) => s.imageToLatexOpen);
  const tikzFigureOpen = useUiStore((s) => s.tikzFigureOpen);
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
    // 空闲预热：PDF 阅读器 + KaTeX 公式引擎分包（见 warmPdfChunk）
    warmPdfChunk();
    // v5.0.0 内置 git：启动即探测可用性
    void detectGitAvailability().then((avail) => {
      // v7.6.1：预热——后台确保仓库就绪（物化+init），首次打开 Git 面板不再等待
      if (avail === 'ok') {
        void import('./git/gitService').then(({ ensureGitRepo }) => ensureGitRepo());
      }
    });
    // v7.6.0：禁用 WebView2/WKWebView 原生右键菜单（其中的「刷新」会整页重载，
    // 用户误触后以为数据全丢）——输入框/文本域内保留系统菜单以便复制粘贴
    const suppressContext = (e: MouseEvent): void => {
      const el = e.target as HTMLElement | null;
      const editable =
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.isContentEditable === true ||
        el?.closest('input, textarea, [contenteditable="true"]') != null;
      if (!editable) e.preventDefault();
    };
    window.addEventListener('contextmenu', suppressContext);
    const detachContext = () => window.removeEventListener('contextmenu', suppressContext);
    return () => {
      detach();
      detachAutoCompile();
      detachContext();
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
      // v7.8.0：已有模态浮层时不再叠加打开新浮层——命令面板/快速打开 z-index（100/150）
      // 低于对话框（200），叠开会被对话框遮住却仍抢走键盘输入。判定见 dialogs.isModalOverlayOpen。
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        if (isModalOverlayOpen(false)) return;
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (isQuickOpenTrigger(e)) {
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        setQuickOpenOpen(true);
        return;
      }
      // v6.3.0：Ctrl+S = 立即编译（拦截浏览器保存对话框；与 Ctrl+Enter 等价）
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void import('./compileAction').then(({ runCompile }) => runCompile());
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
      // Ctrl+W：关闭当前编辑器标签（v2.5.0）
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'w') {
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el?.closest('.cm-content, input, textarea')) return; // 输入区内不拦截
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        if (ws.activeTab) ws.closeTab(ws.activeTab);
        return;
      }
      // Ctrl+Tab / Ctrl+Shift+Tab：切换编辑器标签（v2.5.0）
      if ((e.metaKey || e.ctrlKey) && e.key === 'Tab') {
        e.preventDefault();
        const ws = useWorkspaceStore.getState();
        const tabs = ws.openTabs;
        if (tabs.length < 2) return;
        const idx = tabs.indexOf(ws.activeTab ?? '');
        const next = e.shiftKey
          ? tabs[(idx - 1 + tabs.length) % tabs.length]!
          : tabs[(idx + 1) % tabs.length]!;
        ws.openFile(next);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'h') {
        // v7.8.0：编辑器/输入区内不拦截——macOS 下 Ctrl+H 是 CodeMirror 的
        // deleteCharBackward（退格删字符），全局抢键会让 Mac 用户在编辑器里删不掉字
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el?.closest('.cm-content, input, textarea, [contenteditable="true"]')) return;
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        useUiStore.getState().setHistoryOpen(true);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        setSettingsOpen(true);
        return;
      }
      if (e.key === 'Escape' && useUiStore.getState().focusMode) {
        // D9：Esc 退出专注模式（有任意浮层打开时不抢 Esc：对话框/命令面板/快速打开/快捷键）
        if (!document.querySelector('.sf-dialog-overlay, .palette-overlay, .sf-quickopen-overlay, .sf-shortcuts-overlay')) {
          useUiStore.getState().setFocusMode(false);
        }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        useUiStore.getState().setSearchPanelOpen(true);
        return;
      }
      // v7.2.0 F1：Ctrl+Shift+H = 搜索替换（打开搜索面板并进入替换模式）
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'h') {
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        useUiStore.getState().setSearchPanelOpen(true);
        // SearchPanel 挂载后自动切到替换模式（经 URL hash 传递标记）
        window.location.hash = '#replace';
        return;
      }
      if (isShortcutsTrigger(e, e.target)) {
        if (isModalOverlayOpen()) return;
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setQuickOpenOpen, setShortcutsOpen]);

  const showToast = useCallback((message: string) => {
    useUiStore.getState().showToast(message);
  }, []);

  const focusFileTree = useCallback(() => {
    setSidebarTab('files');
    sidebarRef.current?.focus();
  }, [setSidebarTab]);

  // v5.0.0 Codex 式导航：会话 / 文件 / 版本 / 文献（其余面板经命令面板可达）
  const sidebarTabs: { id: typeof sidebarTab; label: string; icon: typeof FileText }[] = [
    { id: 'sessions', label: t('nav.sessions'), icon: MessagesSquare },
    { id: 'files', label: t('nav.files'), icon: FileText },
    { id: 'git', label: t('nav.git'), icon: GitBranch },
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
    </nav>
  );

  const sidebar = (
    <aside className="sidebar">
      <div className="sidebar-title">{sidebarTitle}</div>
      <div className="sidebar-body" ref={sidebarRef} tabIndex={-1}>
        {sidebarTab === 'sessions' ? (
          <SessionsPanel />
        ) : sidebarTab === 'files' ? (
          <FileTree />
        ) : sidebarTab === 'git' ? (
          <GitPanel />
        ) : sidebarTab === 'library' ? (
          <LazyPanel file="LibraryPanel" labelKey="nav.library" />
        ) : sidebarTab === 'home' ? (
          <LazyPanel file="Dashboard" labelKey="nav.home" />
        ) : sidebarTab === 'outline' ? (
          <LazyPanel file="OutlinePanel" labelKey="nav.outline" />
        ) : sidebarTab === 'citations' ? (
          <LazyPanel file="CitationsPanel" labelKey="nav.citations" />
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
              <LazyPanel file="GlossaryPanel" labelKey="knowledge.glossary" />
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
          <LazyPanel file="Dashboard" labelKey="nav.home" />
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
      }),
    [],
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
      label: t('pdf.quoteLabel', { citekey }),
      via: 'PDF quote',
    });
    // 审批卡渲染在中央 AI 会话区（v5.0.0 布局），无需切换视图
  };

  // —— v5.5.0 经典论文 IDE 布局：中心 = 编辑器 + PDF 预览同步并排（不再切换） ——
  const splitEditorTab = useUiStore((s) => s.splitEditorTab);
  const setSplitEditorTab = useUiStore((s) => s.setSplitEditorTab);
  const wsFiles = useWorkspaceStore((s) => s.files);
  const wsActiveTab = useWorkspaceStore((s) => s.activeTab);
  // 分屏可用文件：已打开的标签页中，非当前活跃的那个
  const splitCandidates = useWorkspaceStore((s: { openTabs: string[] }) => s.openTabs).filter(
    (f) => f !== wsActiveTab && wsFiles[f] !== undefined,
  );

  const editorPane = (
    <section className="center sf-pane-editor">
      <EditorTabs
        onAddToConversation={(path) => useUiStore.getState().requestAddToChat(path)}
        addToConversationLabel={t('tabs.addToChat')}
        closeTabLabel={t('tabs.close')}
        actions={
          <>
            {/* v7.2.1 F2：编辑器分屏开关 */}
            {splitCandidates.length > 0 ? (
              <button
                className="tab-action"
                title={
                  splitEditorTab
                    ? t('editor.splitClose')
                    : t('editor.splitOpen')
                }
                onClick={() => {
                  if (splitEditorTab) setSplitEditorTab(null);
                  else setSplitEditorTab(splitCandidates[0] ?? null);
                }}
              >
                <Columns2 size={13} />
              </button>
            ) : null}
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
      {/* v7.2.1 F2：双窗格竖切——左主编辑 + 右分屏文件选择器 */}
      {splitEditorTab && wsFiles[splitEditorTab] !== undefined ? (
        <div className="sf-editor-split">
          <div className="sf-editor-split-left">
            <EditorArea />
          </div>
          <div className="sf-editor-split-right">
            <div className="sf-editor-split-header">
              <select
                value={splitEditorTab}
                onChange={(e) => setSplitEditorTab(e.target.value)}
                aria-label={t('editor.splitFile')}
                style={{ fontSize: 11, padding: '2px 6px', flex: 1, border: '1px solid var(--border)', borderRadius: 4 }}
              >
                {splitCandidates.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <button
                className="sf-link-btn"
                title={t('editor.splitClose')}
                onClick={() => setSplitEditorTab(null)}
              >
                ×
              </button>
            </div>
            <EditorArea lockedFile={splitEditorTab} />
          </div>
        </div>
      ) : (
        <EditorArea />
      )}
    </section>
  );

  const previewPane = (
    <section className="center sf-pane-preview">
      {pdfView ? (
        <Suspense fallback={<div className="placeholder sf-panel-loading">{t('panel.loading')}</div>}>
          <LazyPdfReader
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
            onToggleResolved={(id, resolved) => {
              const key = useAnnotationStore.getState().resolveKey(pdfView.name);
              useAnnotationStore.getState().setResolved(key, id, resolved);
            }}
            onLookPage={(page, dataUrl) => {
              // v6.7.0：走贴图通道发给多模态模型做视觉排版检查
              void sendChatMessage(
                `请视觉检查这页论文排版（第 ${page} 页截图），逐项指出：文本/公式是否溢出边界、图表位置与引用是否合理、行距栏宽是否有异常、明显的排版错误；只报告问题并给具体修改建议（改稿走 diff 审批）。`,
                [dataUrl],
              );
            }}
            onDraftResponse={() => {
              // v5.7.0：收集全部未处理批注 → 逐条起草回复（AI 可顺带改稿，走审批）
              const store = useAnnotationStore.getState();
              const all: Array<{ file: string; annotation: (typeof store.byFile)[string][number] }> = [];
              for (const [file, list] of Object.entries(store.byFile)) {
                for (const a of list) {
                  if (!a.resolved) all.push({ file, annotation: a });
                }
              }
              if (all.length === 0) {
                showToast(t('toast.noAnnotations'));
                return;
              }
              const items = all
                .sort((x, y) => x.annotation.page - y.annotation.page)
                .map(
                  (x, i) =>
                    `${i + 1}. 第 ${x.annotation.page} 页：${(x.annotation.quotedText ?? '').slice(0, 120)}\n   批注：${(x.annotation.text ?? '（无文字说明）').slice(0, 300)}`,
                )
                .join('\n');
              void sendChatMessage(
                `以下是审稿/导师批注（未处理）。请逐条起草回复（direct-fix / clarify / cite / argue 策略），需要改稿的直接修改（走 diff 审批），最后生成 response-letter.tex（含逐条 回复+修改说明 两个文件可拆分）。\n\n${items}`,
              );
            }}
            askActions={[
              { label: language === 'en' ? 'Explain' : '解释', run: (text) => quickAsk('explain', text) },
              { label: language === 'en' ? 'Translate' : '翻译', run: (text) => quickAsk('translate', text) },
              { label: language === 'en' ? 'Find refs' : '找文献', run: (text) => quickAsk('find', text) },
              {
                label: language === 'en' ? 'Quote → manuscript' : '引述到稿件',
                run: (text) => insertPdfQuote(text, pdfView.name),
              },
              {
                // v7.9.3：选中文字以引用块加入 AI 会话（不自动发送，可继续补问题）
                label: language === 'en' ? 'Add to chat' : '添加到会话',
                run: (text) => useUiStore.getState().requestQuoteToChat(text),
              },
            ]}
            onPagePoint={(p, x, y) => {
              jumpPdfToSource(p, x, y);
            }}
            gotoPage={pdfGotoPage}
            gotoTick={pdfGotoTick || undefined}
          />
        </Suspense>
      ) : (
        <div className="sf-viewer-empty">
          <FileText size={36} strokeWidth={1.5} />
          <p className="placeholder" style={{ margin: 0, maxWidth: 340 }}>
            {t('viewer.noPdf')}
          </p>
        </div>
      )}
    </section>
  );

  // v6.0.0：编译台自动跟随——新日志到达滚到底（最新错误/进度始终可见）
  const consoleBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = consoleBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [compileLog]);

  const consolePane = (
    <section className="console">
      <div className="console-title">
        <span>{t('console.title')}</span>
        {/* v4.4.0：编译失败一键 AI 修复——错误日志经意图检测自动注入上下文 */}
        {compileStatus === 'fail' && compileLog.length > 0 ? (
          <button
            className="sf-link-btn"
            style={{ color: 'var(--accent)', fontWeight: 600 }}
            onClick={() =>
              void sendChatMessage(
                '请分析最近一次编译的错误日志：逐个定位原因，修改源文件修复（走 diff 审批），完成后重新编译验证。',
              )
            }
          >
            {t('console.aiFix')}
          </button>
        ) : null}
        <button className="sf-link-btn" onClick={clearCompileLog}>
          {t('console.clear')}
        </button>
      </div>
      <div className="console-body" ref={consoleBodyRef}>
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
        <div className="brand">Lemma</div>
        <button
          className="sf-project-name"
          title={t('cmd.manageProjects')}
          onClick={() => useUiStore.getState().setProjectSwitcherOpen(true)}
        >
          {projectName || t('tree.untitledProject')}
        </button>
        <button className="palette-trigger" onClick={() => setPaletteOpen(true)}>
          {t('palette.trigger')} <kbd>{isMacOSPlatform() ? '⌘K' : 'Ctrl+K'}</kbd>
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
        editor={editorPane}
        preview={previewPane}
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

      {newProjectDialogOpen && (
        <LazyFeatureDialog file="NewProjectDialog" onClose={() => useUiStore.getState().setNewProjectDialogOpen(false)} />
      )}

      {searchPanelOpen && <LazyFeatureDialog file="SearchPanel" onClose={() => useUiStore.getState().setSearchPanelOpen(false)} />}

      {imageWizardOpen && <LazyFeatureDialog file="ImageWizard" onClose={() => useUiStore.getState().setImageWizardOpen(false)} />}

      {citationPickerOpen && <LazyFeatureDialog file="CitationPicker" onClose={() => useUiStore.getState().setCitationPickerOpen(false)} />}

      {backupDialogOpen && <LazyFeatureDialog file="BackupDialog" onClose={() => useUiStore.getState().setBackupDialogOpen(false)} />}

      {statsDialogOpen && <LazyFeatureDialog file="StatsDialog" onClose={() => useUiStore.getState().setStatsDialogOpen(false)} />}

      {reviewsImportOpen && <LazyFeatureDialog file="ReviewsImportDialog" onClose={() => useUiStore.getState().setReviewsImportOpen(false)} />}

      {externalDiffOpen && <LazyFeatureDialog file="ExternalDiffDialog" onClose={() => useUiStore.getState().setExternalDiffOpen(false)} />}

      {usageDialogOpen && <LazyFeatureDialog file="UsagePanel" onClose={() => useUiStore.getState().setUsageDialogOpen(false)} />}
      {promptsLibOpen && <LazyFeatureDialog file="PromptLibraryDialog" onClose={() => useUiStore.getState().setPromptsLibOpen(false)} />}
      {collabDialogOpen && <LazyFeatureDialog file="CollabMergeDialog" onClose={() => useUiStore.getState().setCollabDialogOpen(false)} />}
      {citeSuggestOpen && <LazyFeatureDialog file="CitationSuggest" onClose={() => useUiStore.getState().setCiteSuggestOpen(false)} />}
      {quickCiteOpen && <LazyFeatureDialog file="QuickCiteDialog" onClose={() => useUiStore.getState().setQuickCiteOpen(false)} />}
      {helpPanelOpen && <LazyFeatureDialog file="HelpPanelDialog" onClose={() => useUiStore.getState().setHelpPanelOpen(false)} />}
      {imageToLatexOpen && <LazyFeatureDialog file="ImageToLatexDialog" onClose={() => useUiStore.getState().setImageToLatexOpen(false)} />}
      {tikzFigureOpen && <LazyFeatureDialog file="TikzFigureDialog" onClose={() => useUiStore.getState().setTikzFigureOpen(false)} />}

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
    | 'NewProjectDialog'
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
    | 'CollabMergeDialog'
    | 'CitationSuggest'
    | 'QuickCiteDialog'
    | 'HelpPanelDialog'
    | 'ImageToLatexDialog'
    | 'TikzFigureDialog';
  onClose: () => void;
}) {
  const t = useT();
  const modules = import.meta.glob<Record<string, unknown>>(
    './components/{TableEditor,ProjectSwitcher,NewProjectDialog,SearchPanel,ImageWizard,TextDialog,CitationPicker,BackupDialog,StatsDialog,ReviewsImportDialog,ExternalDiffDialog,UsagePanel,PromptLibraryDialog,CollabMergeDialog,CitationSuggest,QuickCiteDialog,HelpPanelDialog,ImageToLatexDialog,TikzFigureDialog}.tsx',
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
            <p className="placeholder">{t('dlg.loadFailed', { file })}</p>
          </div>
        </div>
      </div>
    );
  }
  if (!Comp) return <p className="placeholder" style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 200 }}>{t('dlg.loading')}</p>;
  return <Comp onClose={onClose} />;
}
