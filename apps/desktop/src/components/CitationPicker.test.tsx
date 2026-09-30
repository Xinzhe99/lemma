// @vitest-environment jsdom
/**
 * CitationPicker 组件测试。测试环境说明同 TableEditor.test.tsx：mock zustand 为仅依赖
 * 本包 react@18 的等价实现；mock editorInsert 桥与 citationSuggest 模块。
 * 覆盖验收路径：papers 渲染、实时过滤（citekey/标题/作者/年份）、多选切换、
 * 空选择禁用插入、插入成功 onClose、插入失败 role=alert 保持打开、chips 移除、
 * 智能推荐（loading/结果徽章/点击选中/失败提示）、Esc 关闭。
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
    const useStore = <T,>(selector: (s: S) => T): T =>
      useSyncExternalStore(
        subscribe,
        () => selector(state),
        () => selector(state),
      );
    return Object.assign(useStore, { setState, getState, subscribe });
  }
  const create = (init?: unknown) =>
    typeof init === 'function' ? impl(init as never) : (curried: unknown) => impl(curried as never);
  return { create };
});

vi.mock('../editorInsert', () => ({
  setInsertHandler: vi.fn(),
  insertAtCursor: vi.fn<(code: string) => boolean>(),
}));

vi.mock('../citationSuggest', () => ({
  suggestCitations: vi.fn<
    (activeText: string, papers: Paper[], alreadyCited: string[], retrieve: import('../citationSuggest').RetrieveFn) => Promise<{ citekey: string; title: string; reason: string }[]>
  >(),
}));

import { CitationPicker } from './CitationPicker';
import { insertAtCursor } from '../editorInsert';
import { suggestCitations } from '../citationSuggest';
import { useLibraryStore } from '../state/libraryStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import type { Paper } from '@scholarforge/shared';

const insertMock = vi.mocked(insertAtCursor);
const suggestMock = vi.mocked(suggestCitations);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makePaper(overrides: Partial<Paper> & Pick<Paper, 'id' | 'citekey' | 'title'>): Paper {
  return {
    authors: [],
    tags: [],
    collections: [],
    readStatus: 'to-read',
    addedAt: 1,
    ...overrides,
  };
}

const PAPERS: Paper[] = [
  makePaper({ id: 'p1', citekey: 'vaswani2017attention', title: 'Attention Is All You Need', year: 2017, venue: { type: 'conference', name: 'NeurIPS' }, authors: [{ family: 'Vaswani', given: 'Ashish' }] }),
  makePaper({ id: 'p2', citekey: 'brown2020language', title: 'Language Models are Few-Shot Learners', year: 2020, venue: { type: 'conference', name: 'NeurIPS' } }),
  makePaper({ id: 'p3', citekey: 'openai2023gpt4', title: 'GPT-4 Technical Report', year: 2023, venue: { type: 'preprint', name: 'arXiv' } }),
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function rows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-citepicker-list .sf-citepicker-row')];
}

function insertButton(): HTMLButtonElement {
  return container!.querySelector<HTMLButtonElement>('.sf-citepicker-insert')!;
}

/** 渲染后异步 flush（智能推荐 promise 链） */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  insertMock.mockReset().mockReturnValue(true);
  suggestMock.mockReset().mockResolvedValue([]); // 默认空推荐；个别用例再覆写
  onClose = vi.fn();
  useLibraryStore.setState({ papers: PAPERS, searchKnowledge: vi.fn() });
  useWorkspaceStore.setState({
    files: { 'main.tex': '\\section{引言}\n引用些文献 \\cite{brown2020language}。' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CitationPicker onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('CitationPicker', () => {
  it('渲染文献库列表：citekey、标题、年份·venue', () => {
    const all = rows();
    expect(all).toHaveLength(3);
    expect(all[0]!.textContent).toContain('vaswani2017attention');
    expect(all[0]!.textContent).toContain('Attention Is All You Need');
    expect(all[0]!.textContent).toContain('2017 · NeurIPS');
    expect(all[2]!.textContent).toContain('2023 · arXiv');
  });

  it('搜索框实时过滤：citekey / 标题 / 作者 / 年份子串（大小写不敏感）', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-citepicker-input')!;
    type(input, 'Vaswani');
    expect(rows()).toHaveLength(1);
    type(input, 'attention'); // citekey + 标题命中
    expect(rows()).toHaveLength(1);
    type(input, '2020');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('brown2020language');
    type(input, 'FEW-SHOT'); // 大小写不敏感
    expect(rows()).toHaveLength(1);
    type(input, 'zzz-no-hit');
    expect(rows()).toHaveLength(0);
    expect(container!.querySelector('.sf-citepicker-empty')!.textContent).toContain('无匹配文献');
  });

  it('多选切换：点击行选中（aria-selected），再点取消；两行可同时选中', () => {
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('false');
    click(rows()[0]!);
    click(rows()[2]!);
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');
    expect(rows()[1]!.getAttribute('aria-selected')).toBe('false');
    click(rows()[0]!); // 再点取消
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('false');
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true');
  });

  it('空选择禁用「插入」按钮；选中后按钮显示条数', () => {
    expect(insertButton().disabled).toBe(true);
    click(rows()[0]!);
    expect(insertButton().disabled).toBe(false);
    expect(insertButton().textContent).toContain('1');
    click(rows()[2]!);
    expect(insertButton().textContent).toContain('2');
  });

  it('插入成功：insertAtCursor 收到 \\cite{a,b}（按点击顺序）并 onClose', () => {
    click(rows()[0]!);
    click(rows()[2]!);
    click(insertButton());
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith('\\cite{vaswani2017attention,openai2023gpt4}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('插入失败：role=alert 提示并保持打开（onClose 不调用）', () => {
    insertMock.mockReturnValue(false);
    click(rows()[1]!);
    click(insertButton());
    expect(onClose).not.toHaveBeenCalled();
    const alert = container!.querySelector('[role="alert"]')!;
    expect(alert.textContent).toContain('请先打开一个 .tex 文件');
    expect(container!.querySelector('.sf-citepicker')).toBeTruthy(); // 对话框仍在
  });

  it('已选 chips：选中后出现 chip，点击 × 移除并同步按钮条数', () => {
    click(rows()[0]!);
    click(rows()[1]!);
    const chips = () => [...container!.querySelectorAll<HTMLElement>('.sf-citepicker-chip')];
    expect(chips()).toHaveLength(2);
    const removeBtn = chips()[0]!.querySelector<HTMLButtonElement>('button.sf-citepicker-chip-remove')!;
    click(removeBtn);
    expect(chips()).toHaveLength(1);
    expect(chips()[0]!.textContent).toContain('brown2020language');
    expect(insertButton().textContent).toContain('1');
  });

  it('智能推荐：loading 态 → 结果以「推荐」徽章显示在列表顶部，点击行加入已选', async () => {
    suggestMock.mockResolvedValue([
      { citekey: 'openai2023gpt4', title: 'GPT-4 Technical Report', reason: '与当前内容语义相关' },
    ]);
    const btn = container!.querySelector<HTMLButtonElement>('.sf-citepicker-suggest-btn')!;
    click(btn);
    // loading 态：按钮禁用且文案变化
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain('推荐中');
    // 调用参数：当前内容 + papers + alreadyCited（collectCitekeys 结果）
    await flush();
    expect(suggestMock).toHaveBeenCalledTimes(1);
    expect(suggestMock.mock.calls[0]![0]).toContain('引用些文献');
    expect(suggestMock.mock.calls[0]![2]).toEqual(['brown2020language']);
    // 结果渲染在列表顶部区域，带「推荐」徽章
    const list = container!.querySelector('.sf-citepicker-list')!;
    const firstItem = list.querySelector<HTMLElement>('.sf-citepicker-row')!;
    expect(firstItem.className).toContain('sf-citepicker-suggest-row');
    expect(firstItem.querySelector('.sf-citepicker-badge')!.textContent).toBe('推荐');
    expect(btn.disabled).toBe(false);
    // 点击推荐行 → 加入已选
    click(firstItem);
    expect(insertButton().textContent).toContain('1');
    expect(insertButton().disabled).toBe(false);
  });

  it('智能推荐失败：inline 提示且不崩溃', async () => {
    suggestMock.mockRejectedValue(new Error('boom'));
    click(container!.querySelector('.sf-citepicker-suggest-btn')!);
    await flush();
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('智能推荐失败');
    expect(container!.querySelector('.sf-citepicker')).toBeTruthy();
  });

  it('非 .tex 标签：智能推荐给出 inline 提示，不调用 suggestCitations', async () => {
    act(() => {
      useWorkspaceStore.setState({ activeTab: 'refs.bib' });
    });
    click(container!.querySelector('.sf-citepicker-suggest-btn')!);
    await flush();
    expect(suggestMock).not.toHaveBeenCalled();
    expect(container!.querySelector('[role="alert"]')!.textContent).toContain('.tex');
  });

  it('Esc 关闭对话框；遮罩点击关闭', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      container!
        .querySelector('.sf-dialog-overlay')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
