// @vitest-environment jsdom
/**
 * SubmitPanel 增量测试：「导出 Word (.docx)」按钮（pandoc 导出）。
 * 测试环境说明同 libraryRis.test.tsx：mock zustand 为仅依赖本包 react@18 的
 * 等价实现；mock ../pandoc 的 exportDocx（不触发真实桥/下载）。
 * 覆盖验收路径：
 *  - 按钮渲染于打包导出区（zip 按钮旁），不受自检清单阻断（docx 非投稿包）；
 *  - 点击 → exportDocx 被调用一次；在途时按钮显示「导出中…」并禁用；
 *  - 成功 → 恢复初始文案，无错误提示；
 *  - 失败 → 自检卡片下方显示中文错误（pandoc 不可用等）；
 *  - en 语言字典。
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

const exportDocxMock = vi.fn();
vi.mock('../pandoc', () => ({
  exportDocx: (...args: unknown[]) => exportDocxMock(...(args as [])),
}));

import { SubmitPanel } from './SubmitPanel';
import { exportDocx } from '../pandoc';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSubmitStore } from '../state/submitStore';

vi.mocked(exportDocx);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SubmitPanel />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function seedWorkspace() {
  useWorkspaceStore.setState({
    projectName: 'my-paper',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\n\\begin{document}hi\\end{document}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    compileLog: [],
    compileStatus: 'idle',
  });
  useSubmitStore.setState({ venueId: null, lastExportAt: null, deadline: null });
}

describe('SubmitPanel「导出 Word (.docx)」', () => {
  beforeEach(() => {
    exportDocxMock.mockReset();
    useSettingsStore.setState({ language: 'zh' });
    seedWorkspace();
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
  });

  it('按钮渲染在打包导出区（zip 按钮旁），且不受自检清单阻断', () => {
    renderPanel();
    const docx = btn('导出 Word');
    const zip = btn('打包导出 zip');
    // 同一导出行
    expect(docx.closest('.sf-submit-export-row')).toBe(zip.closest('.sf-submit-export-row'));
    // 无 refs.bib 等 → 自检未全过、zip 禁用；docx 导出不受阻断
    expect(zip.disabled).toBe(true);
    expect(docx.disabled).toBe(false);
  });

  it('点击调用 exportDocx 一次；在途时显示「导出中…」并禁用，成功后恢复', async () => {
    let resolve!: (v: { ok: true; entry: string; docxPath: string; bytes: number }) => void;
    exportDocxMock.mockReturnValue(
      new Promise((res) => {
        resolve = res;
      }),
    );
    renderPanel();
    click(btn('导出 Word'));
    expect(exportDocxMock).toHaveBeenCalledTimes(1);
    expect(exportDocxMock).toHaveBeenCalledWith();

    const busy = btn('导出中');
    expect(busy.disabled).toBe(true);

    await act(async () => {
      resolve({ ok: true, entry: 'main.tex', docxPath: 'main.docx', bytes: 42 });
    });
    const restored = btn('导出 Word');
    expect(restored.disabled).toBe(false);
    expect(container!.textContent).not.toContain('pandoc');
  });

  it('失败时在自检卡片下方显示中文错误', async () => {
    exportDocxMock.mockResolvedValue({
      ok: false,
      error: 'pandoc 不可用：当前平台暂不支持内置 pandoc 自动下载（macOS：brew install pandoc）',
    });
    renderPanel();
    click(btn('导出 Word'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('brew install pandoc');
    // 按钮恢复可用（可重试）
    expect(btn('导出 Word').disabled).toBe(false);
  });

  it('en 语言显示英文文案', async () => {
    useSettingsStore.setState({ language: 'en' });
    exportDocxMock.mockResolvedValue({ ok: false, error: 'pandoc is unavailable: network' });
    renderPanel();
    expect(btn('Export Word').disabled).toBe(false);
    click(btn('Export Word'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('pandoc is unavailable');
  });
});
