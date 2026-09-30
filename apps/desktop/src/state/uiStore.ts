/**
 * 瞬时 UI 状态：侧栏页签、对话框、PDF 阅读视图、待启动工作流、AI 改稿动作。
 * 命令面板与各面板经由本 store 解耦（避免回调层层透传）。
 */

import { create } from 'zustand';

export type SidebarTab = 'outline' | 'files' | 'citations' | 'library' | 'knowledge' | 'submit';
/** knowledge 页签内的子页签：术语（静态）/ 笔记（动态加载） */
export type KnowledgeTab = 'glossary' | 'notes';
export type LibraryDialog = null | 'bibtex' | 'fetch';
export type LibraryMode = 'list' | 'search' | 'discover';
export type AgentAction = 'polish' | 'draft' | null;

export interface PdfView {
  name: string;
  data: ArrayBuffer;
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
  centerView: 'editor' | 'pdf';
  /** 命令面板请求启动的内置工作流 id（AgentPanel 消费后清空） */
  workflowLaunch: string | null;
  /** 工作流启动的预填变量（与 workflowLaunch 同生命周期；如 W11 的 journal） */
  workflowLaunchVars: Record<string, string> | null;
  /** 命令面板请求的 AI 改稿动作（AgentPanel 消费后清空） */
  agentAction: AgentAction;
  historyOpen: boolean;
  /** 快速打开文件浮层（Ctrl+P）：命令面板命令与全局快捷键经此解耦 */
  quickOpenOpen: boolean;
  /** 快捷键速查模态（Ctrl+/ 或 ?）：同上 */
  shortcutsOpen: boolean;
  /** 编辑器当前选中文本（选中即问工具条数据源；空串表示无选区） */
  selectionText: string;

  setSidebarTab(tab: SidebarTab): void;
  setKnowledgeTab(tab: KnowledgeTab): void;
  setTemplateWizardOpen(open: boolean): void;
  setLibraryDialog(dialog: LibraryDialog): void;
  setLibraryMode(mode: LibraryMode): void;
  requestPdfPicker(): void;
  requestZipPicker(): void;
  setPdfView(view: PdfView | null): void;
  setCenterView(view: 'editor' | 'pdf'): void;
  setWorkflowLaunch(id: string | null): void;
  /** 启动工作流并可附带预填变量（缺省变量的步骤才会在启动器中询问） */
  launchWorkflow(id: string, vars?: Record<string, string>): void;
  requestAgentAction(action: Exclude<AgentAction, null>): void;
  setHistoryOpen(open: boolean): void;
  setQuickOpenOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setSelectionText(text: string): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'files',
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
}));
