/**
 * 瞬时 UI 状态：侧栏页签、对话框、PDF 阅读视图、待启动工作流。
 * 命令面板与各面板经由本 store 解耦（避免回调层层透传）。
 */

import { create } from 'zustand';

export type SidebarTab = 'outline' | 'files' | 'citations' | 'library';
export type LibraryDialog = null | 'bibtex' | 'fetch';

export interface PdfView {
  name: string;
  data: ArrayBuffer;
}

interface UiState {
  sidebarTab: SidebarTab;
  templateWizardOpen: boolean;
  libraryDialog: LibraryDialog;
  /** 自增计数：App 监听后触发隐藏的 file input（PDF 选择器） */
  pdfPickerTick: number;
  pdfView: PdfView | null;
  centerView: 'editor' | 'pdf';
  /** 命令面板请求启动的内置工作流 id（AgentPanel 消费后清空） */
  workflowLaunch: string | null;

  setSidebarTab(tab: SidebarTab): void;
  setTemplateWizardOpen(open: boolean): void;
  setLibraryDialog(dialog: LibraryDialog): void;
  requestPdfPicker(): void;
  setPdfView(view: PdfView | null): void;
  setCenterView(view: 'editor' | 'pdf'): void;
  setWorkflowLaunch(id: string | null): void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarTab: 'files',
  templateWizardOpen: false,
  libraryDialog: null,
  pdfPickerTick: 0,
  pdfView: null,
  centerView: 'editor',
  workflowLaunch: null,

  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setTemplateWizardOpen: (open) => set({ templateWizardOpen: open }),
  setLibraryDialog: (dialog) => set({ libraryDialog: dialog }),
  requestPdfPicker: () => set((s) => ({ pdfPickerTick: s.pdfPickerTick + 1 })),
  setPdfView: (view) => set({ pdfView: view, centerView: view ? 'pdf' : 'editor' }),
  setCenterView: (view) => set({ centerView: view }),
  setWorkflowLaunch: (id) => set({ workflowLaunch: id }),
}));
