/**
 * 瞬时 UI 状态：侧栏页签、对话框、PDF 阅读视图、待启动工作流、AI 改稿动作。
 * 命令面板与各面板经由本 store 解耦（避免回调层层透传）。
 */

import { create } from 'zustand';

export type SidebarTab = 'outline' | 'files' | 'citations' | 'library';
export type LibraryDialog = null | 'bibtex' | 'fetch';
export type LibraryMode = 'list' | 'search' | 'discover';
export type AgentAction = 'polish' | 'draft' | null;

export interface PdfView {
  name: string;
  data: ArrayBuffer;
}

interface UiState {
  sidebarTab: SidebarTab;
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
  /** 命令面板请求的 AI 改稿动作（AgentPanel 消费后清空） */
  agentAction: AgentAction;
  historyOpen: boolean;

  setSidebarTab(tab: SidebarTab): void;
  setTemplateWizardOpen(open: boolean): void;
  setLibraryDialog(dialog: LibraryDialog): void;
  setLibraryMode(mode: LibraryMode): void;
  requestPdfPicker(): void;
  requestZipPicker(): void;
  setPdfView(view: PdfView | null): void;
  setCenterView(view: 'editor' | 'pdf'): void;
  setWorkflowLaunch(id: string | null): void;
  requestAgentAction(action: Exclude<AgentAction, null>): void;
  setHistoryOpen(open: boolean): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'files',
  templateWizardOpen: false,
  libraryDialog: null,
  libraryMode: 'list',
  pdfPickerTick: 0,
  zipPickerTick: 0,
  pdfView: null,
  centerView: 'editor',
  workflowLaunch: null,
  agentAction: null,
  historyOpen: false,

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setTemplateWizardOpen: (open) => set({ templateWizardOpen: open }),
  setLibraryDialog: (dialog) => set({ libraryDialog: dialog }),
  setLibraryMode: (mode) => set({ libraryMode: mode }),
  requestPdfPicker: () => set((s) => ({ pdfPickerTick: s.pdfPickerTick + 1 })),
  requestZipPicker: () => set((s) => ({ zipPickerTick: s.zipPickerTick + 1 })),
  setPdfView: (view) => set({ pdfView: view, centerView: view ? 'pdf' : 'editor' }),
  setCenterView: (view) => set({ centerView: view }),
  setWorkflowLaunch: (id) => set({ workflowLaunch: id }),
  requestAgentAction: (action) => set({ agentAction: action }),
  setHistoryOpen: (open) => set({ historyOpen: open }),
}));
