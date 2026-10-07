// @vitest-environment jsdom
/**
 * LibraryPanel「导入文献」对话框测试（v7.6.0 条目工具栏重构）。测试环境说明同
 * libraryRis.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现。覆盖验收路径：
 *  - 条目模式工具栏只留高频操作：整行搜索框（明确 placeholder）+ [筛选下拉 | 导入文献] 主按钮；
 *    BibTeX / RIS / Zotero JSON / DOI/arXiv / PDF 目录 / Zotero 同步 / 清理 Bib / 导出全库 .bib
 *    不再直接出现在工具栏；
 *  - 「导入文献」对话框（sf-lib-import）分四组：粘贴导入 / 在线获取 / 批量关联 / 导出与维护，
 *    每组标题 + 一句话说明 + 操作按钮；
 *  - Zotero 同步区显示明确的本地状态说明（替代旧「未检测到本地 Zotero」chip）；
 *  - 分组入口只做打开动作：点 BibTeX 关闭本对话框并打开既有粘贴对话框（uiStore.libraryDialog）；
 *  - 文案 zh/en 双语。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('zustand', async () => {
  const { useSyncExternalStore } = await import('react');
  interface Listener {
    (state: unknown, prev: unknown): void;
  }
  function impl<S extends object>(init: (set: unknown, get: unknown) => S) {
    let state: S;
    const listeners = new Set<Listener>();
    const setState = (partial: Partial<S> | ((s: S) => Partial<S>)) => {
      const patch = typeof partial === 'function' ? (partial as (s: S) => Partial<S>)(state) : partial;
      const prev = state;
      state = { ...state, ...patch };
      listeners.forEach((l) => l(state, prev));
    };
    const getState = () => state;
    const subscribe = (l: Listener) => {
      listeners.add(l);
      return () => listeners.delete(l);
    };
    state = init(setState, getState);
    const useStore = <T,>(sSelector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => sSelector(state),
        () => sSelector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

import { LibraryPanel } from './LibraryPanel';
import { useLibraryStore } from '../state/libraryStore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

/** 打开「导入文献」对话框并返回其根元素（en 语言下按钮文案为 Import papers） */
function openImportHub(label = '导入文献'): Element {
  click(btn(label));
  const hub = container!.querySelector('.sf-lib-import');
  if (!hub) throw new Error('import hub (.sf-lib-import) not found');
  return hub;
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  useUiStore.setState({ libraryMode: 'list', libraryDialog: null });
  useLibraryStore.setState({ papers: [], pdfAttachments: {}, indexReady: true });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<LibraryPanel />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('LibraryPanel · 导入文献对话框（v7.6.0 工具栏重构）', () => {
  it('条目模式工具栏只留高频操作：整行搜索框 + [筛选下拉 | 导入文献]，低频入口不再出现', () => {
    const toolbar = container!.querySelector('.sf-lib-toolbar.sf-lib-toolbar--stack');
    expect(toolbar).toBeTruthy();

    const input = toolbar!.querySelector<HTMLInputElement>('input.sf-lib-filter');
    expect(input).toBeTruthy();
    expect(input!.placeholder).toBe('搜索标题/作者/citekey…');

    const selects = toolbar!.querySelectorAll('select');
    expect(selects).toHaveLength(1);

    const labels = [...container!.querySelectorAll<HTMLButtonElement>('.sf-lib-toolbar button')].map(
      (b) => b.textContent?.trim(),
    );
    expect(labels).toEqual(['导入文献']);
    for (const legacy of [
      'BibTeX',
      'RIS',
      'Zotero JSON',
      'Zotero 同步',
      'DOI/arXiv',
      'PDF 目录',
      '清理 Bib',
      '导出全库 .bib',
    ]) {
      expect(labels).not.toContain(legacy);
    }
  });

  it('打开「导入文献」可见四个分区标题（粘贴导入 / 在线获取 / 批量关联 / 导出与维护），各含说明与入口', () => {
    const hub = openImportHub();

    const titles = [...hub.querySelectorAll('.sf-lib-import-sec > h4')].map((h) =>
      h.textContent?.trim(),
    );
    expect(titles).toEqual(['粘贴导入', '在线获取', '批量关联', '导出与维护']);

    // 每组一句话说明
    const text = hub.textContent ?? '';
    expect(text).toContain('粘贴 BibTeX / RIS / Zotero 导出的文本');
    expect(text).toContain('按 DOI / arXiv ID 抓取元数据');
    expect(text).toContain('把本地 PDF 批量关联到条目');
    expect(text).toContain('导出全库 .bib');

    // 全部既有入口原样保留（只是挪进对话框）
    for (const entry of ['BibTeX', 'RIS', 'Zotero JSON', 'DOI / arXiv 抓取', 'PDF 目录', 'Zotero 同步', '清理 Bib']) {
      expect(btn(entry)).toBeTruthy();
    }
    // Zotero 同步区：明确的本地状态说明（替代旧「未检测到本地 Zotero」chip）
    expect(text).toContain('未检测到本机 Zotero（需安装 Zotero 并运行 Better BibTeX）');
    // 库为空时导出按钮禁用
    expect(btn('导出全库 .bib').disabled).toBe(true);
  });

  it('分组入口只做打开动作：点 BibTeX 关闭本对话框并打开既有 uiStore 粘贴对话框', () => {
    openImportHub();
    click(btn('BibTeX'));

    expect(container!.querySelector('.sf-lib-import')).toBeNull();
    expect(useUiStore.getState().libraryDialog).toBe('bibtex');
    expect(container!.querySelector('header strong')!.textContent).toBe('导入 BibTeX');

    // 关闭粘贴对话框后可再次打开导入文献
    click(btn('关闭'));
    expect(useUiStore.getState().libraryDialog).toBeNull();
    openImportHub();
    expect(container!.querySelector('.sf-lib-import')).toBeTruthy();
  });

  it('文案 zh/en 双语：en 下按钮为 Import papers，分区标题与 Zotero 状态说明同步切换', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    const hub = openImportHub('Import papers');
    expect(hub.querySelector('.sf-lib-import-sec > h4')!.textContent).toBe('Paste import');

    const titles = [...hub.querySelectorAll('.sf-lib-import-sec > h4')].map((h) =>
      h.textContent?.trim(),
    );
    expect(titles).toEqual(['Paste import', 'Fetch online', 'Bulk attach', 'Export & maintenance']);
    expect(hub.textContent).toContain('Local Zotero not detected');
    expect(btn('Import papers')).toBeTruthy();
  });
});
