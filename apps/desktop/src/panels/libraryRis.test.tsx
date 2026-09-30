// @vitest-environment jsdom
/**
 * LibraryPanel「RIS 导入入口」测试。测试环境说明同 ProjectSwitcher.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现。覆盖验收路径：
 *  - 条目模式工具栏出现「RIS」按钮（BibTeX 旁），点击打开粘贴对话框；
 *  - 粘贴合法 RIS → 导入 → 入库（空 citekey 补 key：generateCitekey 消歧）并显示「导入 N 条 / 错误 M 条」；
 *  - RIS 内 ID 标签提供的 citekey 原样保留；与库内重复的条目计为错误；
 *  - 坏 RIS（缺 TY / 缺 TI）→ 导入 0 条并显示错误计数；关闭对话框不回归。
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

const RIS_VALID = `TY  - JOUR
TI  - Attention Is All You Need
AU  - Vaswani, Ashish
AU  - Shazeer, Noam
PY  - 2017
JO  - Advances in Neural Information Processing Systems
DO  - 10.5555/3294771.3295107
ER  - 

TY  - CONF
ID  - brown2020language
TI  - Language Models are Few-Shot Learners
AU  - Brown, Tom B.
PY  - 2020
T2  - NeurIPS
ER  - 
`;

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

/** 受控 textarea 的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openRisDialog(): HTMLTextAreaElement {
  click(btn('RIS'));
  const textarea = container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea');
  if (!textarea) throw new Error('RIS textarea not found');
  return textarea;
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

describe('LibraryPanel · RIS 导入入口', () => {
  it('条目模式工具栏在 BibTeX 旁渲染「RIS」按钮，点击打开与 BibTeX 同款粘贴对话框', () => {
    const buttons = [...container!.querySelectorAll<HTMLButtonElement>('.sf-lib-toolbar button')].map(
      (b) => b.textContent?.trim(),
    );
    expect(buttons).toContain('BibTeX');
    expect(buttons!.indexOf('RIS')).toBeGreaterThan(0);
    expect(buttons!.indexOf('RIS')).toBeLessThan(buttons!.indexOf('DOI/arXiv'));

    click(btn('RIS'));
    expect(container!.querySelector('.sf-lib-dialog')).toBeTruthy();
    expect(container!.querySelector('header strong')!.textContent).toBe('导入 RIS');
    expect(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')).toBeTruthy();
  });

  it('粘贴合法 RIS → 导入：2 条入库（空 citekey 补 key、ID 提供 key 保留），显示「导入 2 条 / 错误 0 条」', () => {
    const textarea = openRisDialog();
    typeInto(textarea, RIS_VALID);
    click(btn('导入'));

    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(2);
    // 无 ID 的条目按 importBibtex 同款流程补 key（auth:year:shorttitle 模式）
    expect(papers.some((p) => p.citekey.startsWith('vaswani:2017:'))).toBe(true);
    expect(papers.every((p) => p.citekey.length > 0)).toBe(true);
    // RIS 的 ID 标签 citekey 原样保留（importBibtex 消歧可能追加 -a 后缀，属既有行为）
    expect(papers.some((p) => /^brown2020language(-a)?$/.test(p.citekey))).toBe(true);
    expect(papers.map((p) => p.title)).toContain('Attention Is All You Need');
    expect(papers.map((p) => p.year)).toContain(2017);

    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('导入 2 条 / 错误 0 条');
    // 导入成功后清空粘贴区
    expect(container!.querySelector<HTMLTextAreaElement>('.sf-lib-textarea')!.value).toBe('');
  });

  it('与库内重复（citekey 冲突）的条目被跳过并计入错误', () => {
    useLibraryStore.setState({
      papers: [
        {
          id: 'dup',
          citekey: 'brown2020language',
          title: '已有条目',
          authors: [],
          tags: [],
          collections: [],
          readStatus: 'to-read',
          addedAt: 1,
        },
      ],
    });
    const textarea = openRisDialog();
    typeInto(textarea, RIS_VALID);
    click(btn('导入'));

    const papers = useLibraryStore.getState().papers;
    expect(papers).toHaveLength(2); // 既有 1 条 + 新增 1 条（重复的 brown2020language 跳过）
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('导入 1 条 / 错误 1 条');
  });

  it('坏 RIS（缺 TI 标题）不入库，显示「导入 0 条 / 错误 1 条」', () => {
    const textarea = openRisDialog();
    typeInto(textarea, 'TY  - JOUR\nAU  - Someone\nER  - \n');
    click(btn('导入'));

    expect(useLibraryStore.getState().papers).toHaveLength(0);
    expect(container!.querySelector('.sf-cites-msg')!.textContent).toBe('导入 0 条 / 错误 1 条');
  });

  it('「关闭」按钮与遮罩关闭对话框，不触发导入', () => {
    openRisDialog();
    click(btn('关闭'));
    expect(container!.querySelector('.sf-lib-dialog')).toBeNull();
    expect(useLibraryStore.getState().papers).toHaveLength(0);
  });

  it('RIS 对话框不占用 uiStore.libraryDialog（归集成者所有的类型不动）', () => {
    openRisDialog();
    expect(useUiStore.getState().libraryDialog).toBeNull();
  });
});
