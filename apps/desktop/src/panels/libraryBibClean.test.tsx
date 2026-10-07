// @vitest-environment jsdom
/**
 * LibraryPanel「Bib 清理向导」测试。测试环境说明同 libraryRis.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现。覆盖验收路径：
 *  - 「清理 Bib」入口收进「导入文献」对话框（导出与维护区），点击打开向导对话框（sf-dialog）；
 *  - 项目无 .bib → 指引提示、无去重入口；干净 .bib → 无问题提示、去重按钮禁用；
 *  - 有 issue → error / warning 分区展示（keys + message + suggestion）；
 *  - 自动去重 → 预览（删除条目/行数统计 + 前 3 组被删 key）→ 应用内 confirm 确认
 *    → snapshotFile 先建快照 → refs.bib 更新为去重后文本；文献库条目不受影响；
 *  - confirm 取消 → refs.bib 原样保留。
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
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BIB_DIRTY = `@article{thin2017,
  title = {Attention Is All You Need},
  author = {V, A},
  doi = {10.5555/3294771.3295107}
}

@article{full2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish and Shazeer, Noam},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3294771.3295107}
}

@article{noauthor1,
  title = {An Unrelated Study},
  journal = {Journal of Things},
  year = {2021}
}`;

const BIB_CLEAN = `@article{full2017,
  title = {Attention Is All You Need},
  author = {Vaswani, Ashish},
  journal = {NeurIPS},
  year = {2017},
  doi = {10.5555/3294771.3295107}
}

@article{other2019,
  title = {An Unrelated Study},
  author = {Other, Author},
  journal = {Journal of Things},
  year = {2019}
}`;

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

/** 打开清理向导（v7.6.0：「清理 Bib」入口收进「导入文献」对话框的导出与维护区） */
function openCleaner(): void {
  click(btn('导入文献'));
  click(btn('清理 Bib'));
  expect(container!.querySelector('.sf-lib-dialog')).toBeTruthy();
}

/** 解析应用内 confirm 请求（App 未挂载时由测试代为应答） */
async function answerConfirm(value: string | null): Promise<void> {
  await act(async () => {
    useUiStore.getState().textDialog?.resolve(value);
  });
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  useUiStore.setState({ libraryMode: 'list', libraryDialog: null, textDialog: null });
  useLibraryStore.setState({ papers: [], pdfAttachments: {}, indexReady: true });
  useWorkspaceStore.setState({
    files: { 'main.tex': '\\documentclass{article}\n', 'refs.bib': BIB_DIRTY },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  });

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

describe('LibraryPanel · Bib 清理向导', () => {
  it('「清理 Bib」入口收进「导入文献」对话框（导出与维护区），点击打开 sf-dialog 向导', () => {
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('.sf-lib-toolbar button')].map(
      (b) => b.textContent?.trim(),
    );
    // 工具栏只留高频操作：清理 Bib 不再直接出现在工具栏，由「导入文献」进入
    expect(buttons).toContain('导入文献');
    expect(buttons).not.toContain('清理 Bib');
    expect(buttons).not.toContain('PDF 目录');

    click(btn('导入文献'));
    const hub = container!.querySelector('.sf-lib-import');
    expect(hub).toBeTruthy();
    expect(hub!.textContent).toContain('导出与维护');

    openCleaner();
    expect(container!.querySelector('header strong')!.textContent).toBe(
      '清理 Bib：重复 / 缺字段 / 不一致',
    );
    // 不占用 uiStore.libraryDialog（同 RIS/Zotero 约定，归集成者所有）
    expect(useUiStore.getState().libraryDialog).toBeNull();
  });

  it('error / warning 分区：重复条目进 error 区（keys + 合并建议），缺 author 进 warning 区', () => {
    openCleaner();
    const body = container!.querySelector('.sf-lib-dialog')!.textContent ?? '';

    expect(body).toContain('错误（重复条目，1 组）');
    // thin2017 是缺 journal/year 的 @article + noauthor1 缺 author → 3 条 warning
    expect(body).toContain('警告（缺字段 / 不一致，3 条）');
    expect(body).toContain('thin2017');
    expect(body).toContain('full2017');
    expect(body).toContain('疑似重复');
    expect(body).toContain('合并为一条（建议保留字段更全的 key）');
    expect(body).toContain('noauthor1');
    expect(body).toContain('author');
  });

  it('自动去重 → 预览：删除条目/行数统计 + 前 3 组被删 key，确认按钮出现', () => {
    openCleaner();
    click(btn('自动去重（保留更全条目）'));

    const body = container!.querySelector('.sf-lib-dialog')!.textContent ?? '';
    expect(body).toContain('将删除 1 条重复条目');
    expect(body).toContain('约 6 行');
    expect(body).toContain('前 3 组');
    expect(body).toContain('thin2017 / full2017');
    expect(btn('确认写入')).toBeTruthy();
  });

  it('确认写入 → 先快照后更新 refs.bib（去重结果落盘），提示文献库条目不受影响', async () => {
    openCleaner();
    click(btn('自动去重（保留更全条目）'));
    click(btn('确认写入'));
    // 应用内 confirm 请求已登记（openTextDialog），标题含删除条数与快照说明
    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('confirm');
    expect(req?.title).toContain('删除 1 条重复条目');
    await answerConfirm('yes');

    const files = useWorkspaceStore.getState().files;
    expect(files['refs.bib']).not.toContain('thin2017');
    expect(files['refs.bib']).toContain('@article{full2017,');
    expect(files['refs.bib']).toContain('noauthor1');
    // 写入前已创建快照（可回滚），快照内容为去重前的原文
    expect(useWorkspaceStore.getState().snapshots['refs.bib']).toHaveLength(1);
    expect(useWorkspaceStore.getState().snapshots['refs.bib']![0]!.content).toContain('thin2017');
    // 结果提示：文献库条目不受影响
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe(
      '已更新 refs.bib：删除 1 条重复条目（文献库条目不受影响）',
    );
    // 文献库（libraryStore）确实未动
    expect(useLibraryStore.getState().papers).toHaveLength(0);
    // 写入后列表刷新：重复 error 消失，仅剩 warning
    const body = container!.querySelector('.sf-lib-dialog')!.textContent ?? '';
    expect(body).toContain('警告（缺字段 / 不一致，1 条）');
    expect(body).not.toContain('错误（重复条目');
  });

  it('confirm 取消 → refs.bib 原样保留、提示已取消', async () => {
    openCleaner();
    click(btn('自动去重（保留更全条目）'));
    click(btn('确认写入'));
    await answerConfirm(null);

    expect(useWorkspaceStore.getState().files['refs.bib']).toBe(BIB_DIRTY);
    expect(useWorkspaceStore.getState().snapshots['refs.bib']).toBeUndefined();
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('已取消：.bib 未修改');
  });

  it('项目无 .bib → 对话框显示指引提示，无去重按钮', () => {
    useWorkspaceStore.setState({ files: { 'main.tex': 'x' } });
    openCleaner();
    expect(container!.querySelector('.sf-lib-dialog')!.textContent).toContain('没有 .bib 文件');
    expect(() => btn('自动去重（保留更全条目）')).toThrow();
  });

  it('干净的 .bib → 无问题提示、去重按钮禁用', () => {
    useWorkspaceStore.setState({ files: { 'refs.bib': BIB_CLEAN } });
    openCleaner();
    expect(container!.querySelector('.sf-lib-dialog')!.textContent).toContain('未发现问题');
    expect(btn('自动去重（保留更全条目）').disabled).toBe(true);
  });

  it('仅有不一致类 issue（无 duplicate）→ 去重按钮禁用（缺失/不一致仅提示，诚实边界）', () => {
    useWorkspaceStore.setState({
      files: {
        'refs.bib':
          '@article{c1, title = {Title One Long Enough}, author = {A}, journal = {J}, year = {2020}, doi = {10.7/Aa}}\n@article{c2, title = {Title Two Long Enough}, author = {B}, journal = {J}, year = {2020}, doi = {10.7/aa}}',
      },
    });
    openCleaner();
    const body = container!.querySelector('.sf-lib-dialog')!.textContent ?? '';
    expect(body).toContain('大小写混用');
    expect(body).not.toContain('错误（重复条目');
    expect(btn('自动去重（保留更全条目）').disabled).toBe(true);
  });
});
