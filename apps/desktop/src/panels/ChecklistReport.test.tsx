// @vitest-environment jsdom
/**
 * ChecklistReport 组件渲染测试（WS-3 联动）。测试环境说明同 QuickOpen.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现。覆盖：
 *  - fail/manual 报告头部渲染「去投稿工作台核对打包自检」，点击 setSidebarTab('submit')；
 *  - pass 报告不显示该按钮；
 *  - fail/manual 条目的「复制建议」→ clipboard.writeText 收到建议原文，按钮短暂变「已复制」；
 *  - 条目文本中的 `main.tex: 42` / `sections/intro.tex:7` 定位引用渲染为可点链接（jumpTo）。
 * 纯函数（parse/classify/extractLocationRefs）测试见 checklistReport.test.ts。
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
    typeof init === 'function'
      ? impl(init as never)
      : (curried: unknown) => impl(curried as never);
  return { create };
});

import { ChecklistReport } from './ChecklistReport';
import { useUiStore } from '../state/uiStore';
import { setJumpHandler } from '../editorJump';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MD_FAIL = `预提交自检报告

总体结论：未通过

❌ 页数超出限制：正文 11 页 > 要求 9 页
   定位：详见 main.tex: 42 与 sections/intro.tex:7 的浮动体设置
→ 建议：压缩插图宽度，双栏并列排版

⚠️ 匿名化：致谢中含基金号，需人工判断
→ 建议：投稿版删除致谢或改为匿名表述`;

const MD_MANUAL = `自检报告

总体结论：修复后可提交

⚠️ 图 3 分辨率 260dpi 低于要求
→ 建议：导出 300dpi 矢量图`;

const MD_PASS = `预提交自检报告

总体结论：通过

✅ 编译通过（0 error）
✅ 引用格式与 bib 字段完整`;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let jumpHandler: ReturnType<typeof vi.fn>;

function renderReport(output: string) {
  act(() => {
    root!.render(<ChecklistReport output={output} />);
  });
}

function queryButton(selector: string): HTMLButtonElement | null {
  return container!.querySelector<HTMLButtonElement>(selector);
}

beforeEach(() => {
  useUiStore.setState({ sidebarTab: 'files' });
  jumpHandler = vi.fn();
  setJumpHandler(jumpHandler);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  setJumpHandler(null);
  Reflect.deleteProperty(navigator, 'clipboard');
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

describe('ChecklistReport 联动（WS-3）', () => {
  it('fail 报告：头部渲染「去投稿工作台」按钮，点击切到 submit 页签', () => {
    renderReport(MD_FAIL);
    const btn = queryButton('.sf-checklist-goto-submit');
    expect(btn).toBeTruthy();
    expect(btn!.textContent).toBe('去投稿工作台核对打包自检');
    expect(useUiStore.getState().sidebarTab).toBe('files');
    act(() => {
      btn!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(useUiStore.getState().sidebarTab).toBe('submit');
  });

  it('manual 报告同样显示联动按钮（verdict !== pass）', () => {
    renderReport(MD_MANUAL);
    expect(queryButton('.sf-checklist-goto-submit')).toBeTruthy();
  });

  it('pass 报告：不显示联动按钮', () => {
    renderReport(MD_PASS);
    expect(queryButton('.sf-checklist-goto-submit')).toBeNull();
  });

  it('未通过条目有「复制建议」，通过条目没有；点击写入剪贴板并短暂变「已复制」', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    vi.useFakeTimers();
    try {
      renderReport(MD_FAIL);
      const copyButtons = [...container!.querySelectorAll<HTMLButtonElement>('.sf-checklist-copy')];
      expect(copyButtons).toHaveLength(2); // fail + manual 条目

      renderReport(MD_PASS);
      expect(container!.querySelectorAll('.sf-checklist-copy')).toHaveLength(0);

      renderReport(MD_FAIL);
      const btn = container!.querySelectorAll<HTMLButtonElement>('.sf-checklist-copy')[0]!;
      expect(btn.textContent).toBe('复制建议');
      await act(async () => {
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(writeText).toHaveBeenCalledWith('压缩插图宽度，双栏并列排版');
      expect(btn.textContent).toBe('已复制'); // 成功后短暂反馈

      act(() => {
        vi.advanceTimersByTime(1600);
      });
      expect(btn.textContent).toBe('复制建议'); // 回弹
    } finally {
      vi.useRealTimers();
    }
  });

  it('条目定位引用渲染为可点链接，点击 jumpTo 到对应 file:line', () => {
    renderReport(MD_FAIL);
    const links = [...container!.querySelectorAll<HTMLButtonElement>('.sf-checklist-loc')];
    expect(links.map((l) => l.textContent)).toEqual(['main.tex: 42', 'sections/intro.tex:7']);

    act(() => {
      links[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(jumpHandler).toHaveBeenCalledWith({ file: 'main.tex', line: 42 });

    act(() => {
      links[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(jumpHandler).toHaveBeenCalledWith({ file: 'sections/intro.tex', line: 7 });
    expect(jumpHandler).toHaveBeenCalledTimes(2);
  });
});
