// @vitest-environment jsdom
/**
 * SnapshotDialog 组件测试（快照 diff 对比增强）。测试环境说明同 TableEditor.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；DiffView 使用真实实现（diff 包）。
 * 覆盖验收路径：快照分组渲染、「对比当前」展开/收起、同时只展开一条、
 * 内容一致显示「与当前版本一致」、有差异时渲染 .sf-diff（含增删行）、恢复与 Esc 关闭不回归。
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

import { SnapshotDialog } from './SnapshotDialog';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OLD_MAIN = '\\section{旧标题}\n旧内容\n';
const NEW_MAIN = '\\section{新标题}\n旧内容\n新行\n';

const SNAPSHOTS = {
  'main.tex': [
    { content: OLD_MAIN, ts: 1700000100000, label: 'AI 修改前' },
    { content: NEW_MAIN, ts: 1700000000000, label: '初始导入' }, // 与当前一致
  ],
  'sections/intro.tex': [{ content: '\\section{引言}\n旧稿段落\n', ts: 1699990000000, label: 'AI 润色前' }],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function rows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-snap-row')];
}

function compareButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('.sf-snap-compare')];
}

function diffHosts(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-snap-diff')];
}

beforeEach(() => {
  onClose = vi.fn();
  useWorkspaceStore.setState({
    files: { 'main.tex': NEW_MAIN, 'sections/intro.tex': '\\section{引言}\n' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: SNAPSHOTS,
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<SnapshotDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('SnapshotDialog · 快照 diff 对比', () => {
  it('快照按文件分组渲染，每行带「对比当前」按钮（默认收起）', () => {
    expect(rows()).toHaveLength(3);
    expect(compareButtons()).toHaveLength(3);
    expect(compareButtons().every((b) => b.textContent === '对比当前')).toBe(true);
    expect(diffHosts()).toHaveLength(0);
  });

  it('点击「对比当前」展开 DiffView（before=快照 / after=当前），再点收起', () => {
    const btn = compareButtons()[0]!; // main.tex 第一条（与当前有差异）
    click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toBe('收起对比');
    const hosts = diffHosts();
    expect(hosts).toHaveLength(1);
    // 展开容器位于行下（同一 li 内）
    expect(rows()[0]!.contains(hosts[0]!)).toBe(true);
    // DiffView 渲染：文件名 + 统计 + 增删行
    const diff = hosts[0]!.querySelector('.sf-diff')!;
    expect(diff.querySelector('.sf-diff-filename')!.textContent).toBe('main.tex');
    expect(diff.querySelector('.sf-diff-adds')!.textContent).toBe('+2');
    expect(diff.querySelector('.sf-diff-dels')!.textContent).toBe('-1');
    expect([...diff.querySelectorAll('[data-kind="add"]')].length).toBeGreaterThan(0);
    expect([...diff.querySelectorAll('[data-kind="del"]')].length).toBeGreaterThan(0);

    click(btn); // 收起
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(diffHosts()).toHaveLength(0);
  });

  it('同时只展开一条：展开另一条时前一条自动收起', () => {
    const [b0, , b2] = compareButtons();
    click(b0!);
    expect(diffHosts()).toHaveLength(1);
    click(b2!); // sections/intro.tex 行（与当前也有差异）
    expect(b0!.getAttribute('aria-expanded')).toBe('false');
    expect(b2!.getAttribute('aria-expanded')).toBe('true');
    expect(diffHosts()).toHaveLength(1);
    expect(rows()[2]!.contains(diffHosts()[0]!)).toBe(true);
  });

  it('快照与当前内容一致：显示「与当前版本一致」而不渲染 diff', () => {
    click(compareButtons()[1]!); // main.tex 第二条（内容等于当前文件）
    expect(diffHosts()).toHaveLength(0);
    expect(container!.querySelector('.sf-snap-same')!.textContent).toBe('与当前版本一致');
    expect(container!.querySelector('.sf-diff')).toBeNull();
  });

  it('文件已删除时以空串为「当前」参与对比（有差异即渲染 diff）', () => {
    useWorkspaceStore.setState({ files: {} });
    click(compareButtons()[0]!);
    expect(container!.querySelector('.sf-snap-diff .sf-diff')).toBeTruthy();
  });

  it('恢复与 Esc 关闭行为不回归', () => {
    click(compareButtons()[0]!);
    const restoreBtn = [...rows()[0]!.querySelectorAll<HTMLButtonElement>('.sf-btn')].find(
      (b) => b.textContent === '恢复此版本',
    )!;
    click(restoreBtn);
    expect(useWorkspaceStore.getState().files['main.tex']).toBe(OLD_MAIN);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
