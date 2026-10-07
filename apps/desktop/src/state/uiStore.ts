/**
 * 瞬时 UI 状态：侧栏页签、对话框、PDF 阅读视图、待启动工作流、AI 改稿动作。
 * 命令面板与各面板经由本 store 解耦（避免回调层层透传）。
 */

import { create } from 'zustand';

export type SidebarTab =
  | 'sessions'
  | 'files'
  | 'git'
  | 'library'
  | 'home'
  | 'outline'
  | 'citations'
  | 'knowledge'
  | 'submit'
  | 'comments';
/** knowledge 页签内的子页签：术语（静态）/ 笔记（动态加载） */
export type KnowledgeTab = 'glossary' | 'notes' | 'memory';
export type LibraryDialog = null | 'bibtex' | 'fetch';
export type LibraryMode = 'list' | 'search' | 'discover';
export type AgentAction = 'polish' | 'draft' | null;

export interface PdfView {
  name: string;
  data: ArrayBuffer;
}

/** 应用内文本对话框请求（Promise 风格：resolve 由 TextDialog 在用户确认/取消后调用） */
export interface TextDialogRequest {
  title: string;
  initial?: string;
  placeholder?: string;
  confirmText?: string;
  mode: 'prompt' | 'confirm';
  resolve: (value: string | null) => void;
}

interface UiState {
  sidebarTab: SidebarTab;
  /** knowledge 页签内的子页签（术语/笔记） */
  knowledgeTab: KnowledgeTab;
  templateWizardOpen: boolean;
  libraryDialog: LibraryDialog;
  libraryMode: LibraryMode;
  /** 自增计数：App 监听后触发隐藏的 file input（PDF 选择器） */
  pdfPickerTick: number;
  /** 自增计数：App 监听后触发隐藏的 file input（项目 zip 导入） */
  zipPickerTick: number;
  pdfView: PdfView | null;
  centerView: 'editor' | 'pdf' | 'split';
  /** 命令面板请求启动的内置工作流 id（AgentPanel 消费后清空） */
  workflowLaunch: string | null;
  /** 工作流启动的预填变量（与 workflowLaunch 同生命周期；如 W11 的 journal） */
  workflowLaunchVars: Record<string, string> | null;
  /** 命令面板请求的 AI 改稿动作（AgentPanel 消费后清空） */
  agentAction: AgentAction;
  /** v7.9.1 标签右键「添加到对话」：EditorTabs 发起，AgentPanel 消费后清空（tick 变化触发） */
  addToChatPath: string | null;
  addToChatTick: number;
  requestAddToChat(path: string): void;
  clearAddToChat(): void;
  /** v7.9.3 PDF 选中文字「添加到会话」：PdfReader 浮条发起，AgentPanel 以引用块插入输入框 */
  quoteToChatText: string | null;
  quoteToChatTick: number;
  requestQuoteToChat(text: string): void;
  clearQuoteToChat(): void;
  historyOpen: boolean;
  /** 快速打开文件浮层（Ctrl+P）：命令面板命令与全局快捷键经此解耦 */
  quickOpenOpen: boolean;
  /** 快捷键速查模态（Ctrl+/ 或 ?）：同上 */
  shortcutsOpen: boolean;
  /** 编辑器当前选中文本（选中即问工具条数据源；空串表示无选区） */
  selectionText: string;
  /** 可视化表格编辑器（命令面板触发，App 懒加载挂载） */
  tableEditorOpen: boolean;
  /** 多项目管理器（顶栏项目名 / 命令面板触发） */
  projectSwitcherOpen: boolean;
  /** 全项目搜索面板（Ctrl+Shift+F） */
  searchPanelOpen: boolean;
  /** 插图向导 */
  imageWizardOpen: boolean;
  /** 引用插入向导（从文献库搜索/智能推荐 → 插入 \cite） */
  citationPickerOpen: boolean;
  /** 真实审稿意见导入（多格式 → 拆条 → W7） */
  reviewsImportOpen: boolean;
  /** 外部版本对比（导师改稿 vs 当前稿） */
  externalDiffOpen: boolean;
  /** Agent 用量与成本面板 */
  usageDialogOpen: boolean;
  /** 风格分析报告（v1.3.0） */
  styleReportOpen: boolean;
  /** 协作补丁对话框（v1.5.0） */
  collabDialogOpen: boolean;
  /** 智能引用推荐（v1.7.0） */
  citeSuggestOpen: boolean;
  mathPaletteOpen: boolean;
  quickCiteOpen: boolean;
  helpPanelOpen: boolean;
  /** v5.2.0：图像转 LaTeX 对话框（Prism 图像转代码） */
  imageToLatexOpen: boolean;
  /** v7.2.1 F2：编辑器分屏——右窗格文件路径；null = 不分屏 */
  splitEditorTab: string | null;
  /** v5.7.0：AI 画图（TikZ） */
  tikzFigureOpen: boolean;
  /** 全量备份/恢复对话框 */
  backupDialogOpen: boolean;
  /** 专注模式（隐藏侧栏/Agent 面板，沉浸写作） */
  focusMode: boolean;
  /** 写作统计面板 */
  statsDialogOpen: boolean;
  /** 拼写/用词检查（编辑器波浪线标注） */
  spellcheckEnabled: boolean;
  /** 应用内 prompt/confirm 对话框（替代 window.prompt/confirm，Tauri WKWebView 下原生对话框不可用） */
  textDialog: TextDialogRequest | null;
  /** 新建项目对话框（名称 + 本地文件夹选择；SessionsPanel / 编辑器空态引导卡共用入口） */
  newProjectDialogOpen: boolean;
  /** 全局轻提示（自动消失；App 渲染为 sf-toast。项目创建/磁盘合并等跨面板消息走这里） */
  toast: string | null;

  setSidebarTab(tab: SidebarTab): void;
  setKnowledgeTab(tab: KnowledgeTab): void;
  setTemplateWizardOpen(open: boolean): void;
  setLibraryDialog(dialog: LibraryDialog): void;
  setLibraryMode(mode: LibraryMode): void;
  requestPdfPicker(): void;
  requestZipPicker(): void;
  requestAddToChat(path: string): void;
  clearAddToChat(): void;
  requestQuoteToChat(text: string): void;
  clearQuoteToChat(): void;
  setPdfView(view: PdfView | null): void;
  setCenterView(view: 'editor' | 'pdf' | 'split'): void;
  setWorkflowLaunch(id: string | null): void;
  /** 启动工作流并可附带预填变量（缺省变量的步骤才会在启动器中询问） */
  launchWorkflow(id: string, vars?: Record<string, string>): void;
  requestAgentAction(action: Exclude<AgentAction, null>): void;
  setHistoryOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setSelectionText(text: string): void;
  setTableEditorOpen(open: boolean): void;
  setProjectSwitcherOpen(open: boolean): void;
  setSearchPanelOpen(open: boolean): void;
  setImageWizardOpen(open: boolean): void;
  setCitationPickerOpen(open: boolean): void;
  setReviewsImportOpen(open: boolean): void;
  setExternalDiffOpen(open: boolean): void;
  setUsageDialogOpen(open: boolean): void;
  setStyleReportOpen(open: boolean): void;
  setCollabDialogOpen(open: boolean): void;
  setCiteSuggestOpen(open: boolean): void;
  setMathPaletteOpen(open: boolean): void;
  setQuickCiteOpen(open: boolean): void;
  setHelpPanelOpen(open: boolean): void;
  setImageToLatexOpen(open: boolean): void;
  setSplitEditorTab(file: string | null): void;
  setTikzFigureOpen(open: boolean): void;
  setBackupDialogOpen(open: boolean): void;
  setFocusMode(on: boolean): void;
  setStatsDialogOpen(open: boolean): void;
  setSpellcheckEnabled(on: boolean): void;
  openTextDialog(req: TextDialogRequest): void;
  closeTextDialog(): void;
  setNewProjectDialogOpen(open: boolean): void;
  /** 显示轻提示并自动消失（与 App 内 sf-toast 的展示时长一致） */
  showToast(message: string): void;
}

/** toast 自动消失时长（与 App 既有 TOAST_MS 一致） */
const TOAST_MS = 2400;
let toastTimer: ReturnType<typeof setTimeout> | null = null;

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'sessions',
  knowledgeTab: 'glossary',
  templateWizardOpen: false,
  libraryDialog: null,
  libraryMode: 'list',
  pdfPickerTick: 0,
  zipPickerTick: 0,
  pdfView: null,
  centerView: 'editor',
  workflowLaunch: null,
  workflowLaunchVars: null,
  agentAction: null,
  historyOpen: false,
  quickOpenOpen: false,
  shortcutsOpen: false,
  selectionText: '',
  tableEditorOpen: false,
  projectSwitcherOpen: false,
  searchPanelOpen: false,
  imageWizardOpen: false,
  citationPickerOpen: false,
  reviewsImportOpen: false,
  externalDiffOpen: false,
  usageDialogOpen: false,
  styleReportOpen: false,
  collabDialogOpen: false,
  citeSuggestOpen: false,
  mathPaletteOpen: false,
  quickCiteOpen: false,
  helpPanelOpen: false,
  imageToLatexOpen: false,
  splitEditorTab: null,
  tikzFigureOpen: false,
  backupDialogOpen: false,
  focusMode: false,
  statsDialogOpen: false,
  spellcheckEnabled: true,
  textDialog: null,
  newProjectDialogOpen: false,
  toast: null,
  addToChatPath: null,
  addToChatTick: 0,
  quoteToChatText: null,
  quoteToChatTick: 0,

  requestAddToChat: (path) => set((s) => ({ addToChatPath: path, addToChatTick: s.addToChatTick + 1 })),
  clearAddToChat: () => set({ addToChatPath: null }),
  requestQuoteToChat: (text) => set((s) => ({ quoteToChatText: text, quoteToChatTick: s.quoteToChatTick + 1 })),
  clearQuoteToChat: () => set({ quoteToChatText: null }),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setKnowledgeTab: (tab) => set({ knowledgeTab: tab }),
  setTemplateWizardOpen: (open) => set({ templateWizardOpen: open }),
  setLibraryDialog: (dialog) => set({ libraryDialog: dialog }),
  setLibraryMode: (mode) => set({ libraryMode: mode }),
  requestPdfPicker: () => set((s) => ({ pdfPickerTick: s.pdfPickerTick + 1 })),
  requestZipPicker: () => set((s) => ({ zipPickerTick: s.zipPickerTick + 1 })),
  setPdfView: (view) => set({ pdfView: view, centerView: view ? 'pdf' : 'editor' }),
  setCenterView: (view) => set({ centerView: view }),
  setWorkflowLaunch: (id) => set({ workflowLaunch: id, workflowLaunchVars: null }),
  launchWorkflow: (id, vars) => set({ workflowLaunch: id, workflowLaunchVars: vars ?? null }),
  requestAgentAction: (action) => set({ agentAction: action }),
  setHistoryOpen: (open) => set({ historyOpen: open }),
  setQuickOpenOpen: (open) => set({ quickOpenOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setSelectionText: (text) => set({ selectionText: text }),
  setTableEditorOpen: (open) => set({ tableEditorOpen: open }),
  setProjectSwitcherOpen: (open) => set({ projectSwitcherOpen: open }),
  setSearchPanelOpen: (open) => set({ searchPanelOpen: open }),
  setImageWizardOpen: (open) => set({ imageWizardOpen: open }),
  setCitationPickerOpen: (open) => set({ citationPickerOpen: open }),
  setReviewsImportOpen: (open) => set({ reviewsImportOpen: open }),
  setExternalDiffOpen: (open) => set({ externalDiffOpen: open }),
  setUsageDialogOpen: (open) => set({ usageDialogOpen: open }),
  setStyleReportOpen: (open) => set({ styleReportOpen: open }),
  setCollabDialogOpen: (open) => set({ collabDialogOpen: open }),
  setCiteSuggestOpen: (open) => set({ citeSuggestOpen: open }),
  setMathPaletteOpen: (open) => set({ mathPaletteOpen: open }),
  setQuickCiteOpen: (open) => set({ quickCiteOpen: open }),
  setHelpPanelOpen: (open) => set({ helpPanelOpen: open }),
  setImageToLatexOpen: (open) => set({ imageToLatexOpen: open }),
  setSplitEditorTab: (file) => set({ splitEditorTab: file }),
  setTikzFigureOpen: (open) => set({ tikzFigureOpen: open }),
  setBackupDialogOpen: (open) => set({ backupDialogOpen: open }),
  setFocusMode: (on) => set({ focusMode: on }),
  setStatsDialogOpen: (open) => set({ statsDialogOpen: open }),
  setSpellcheckEnabled: (on) => set({ spellcheckEnabled: on }),
  openTextDialog: (req) => set({ textDialog: req }),
  closeTextDialog: () => set({ textDialog: null }),
  setNewProjectDialogOpen: (open) => set({ newProjectDialogOpen: open }),
  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => {
      toastTimer = null;
      useUiStore.setState({ toast: null });
    }, TOAST_MS);
  },
}));
