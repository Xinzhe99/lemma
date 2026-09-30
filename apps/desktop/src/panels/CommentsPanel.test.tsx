// @vitest-environment jsdom
/**
 * CommentsPanel 组件测试。测试环境说明同 libraryRis.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；mock editorJump（lastCursor/jumpTo）。
 * 覆盖验收路径：
 *  - 添加按钮可用性（activeTab 为 .tex 且光标在当前文件；否则 disabled + title 说明）；
 *  - 内联添加区（textarea + 作者名，默认「导师」）→ addComment(activeTab, lastCursor().line, …)；
 *  - 列表三态过滤（默认未解决）+ 计数 + 已解决降透明度（opacity）；
 *  - 条目头点击 jumpTo({file, line})；回复 / 标为已解决 / 删除交互；
 *  - 底部导出审阅意见 .md（文件名 review-comments-YYYYMMDD.md、内容分组、空批注禁用）；
 *  - zh/en 组件内字典。
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

// editorJump 假实现：lastCursor 读可变光标；subscribeCursor 为可通知的假订阅
// （__notifyCursor 模拟编辑器侧 notifyCursor：更新 lastCursor 并通知全部订阅者）
vi.mock('../editorJump', () => {
  interface CursorInfo {
    file: string;
    line: number;
    col: number;
  }
  let cursor: CursorInfo = { file: 'main.tex', line: 12, col: 1 };
  const listeners = new Set<(c: CursorInfo) => void>();
  return {
    jumpTo: vi.fn(),
    lastCursor: vi.fn((): CursorInfo => cursor),
    subscribeCursor: (cb: (c: CursorInfo) => void): (() => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    __notifyCursor: (c: CursorInfo): void => {
      cursor = c;
      for (const cb of listeners) cb(cursor);
    },
  };
});

import { CommentsPanel } from './CommentsPanel';
import * as editorJumpModule from '../editorJump';
import { jumpTo } from '../editorJump';
import { useCommentsStore } from '../state/commentsStore';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';

/** 测试内模拟「编辑器 notifyCursor」：写入假 lastCursor 并通知订阅者 */
const notifyCursor = (
  (editorJumpModule as unknown as {
    __notifyCursor: (c: { file: string; line: number; col: number }) => void;
  }).__notifyCursor
);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let capturedBlob: Blob | null = null;
const anchorDownloads: string[] = [];
let anchorClickSpy: ReturnType<typeof vi.spyOn> | null = null;

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<CommentsPanel />);
  });
}

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

function q<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return container!.querySelector<T>(selector);
}

/** 受控 textarea / input 的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function typeInto(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** jsdom Blob 读取（FileReader 路径，稳妥于 Blob#text） */
function blobText(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error ?? new Error('read blob failed'));
    fr.readAsText(b);
  });
}

function seedComment(over: {
  file?: string;
  line?: number;
  text?: string;
  resolved?: boolean;
  replies?: { author: string; text: string; createdAt?: number }[];
}) {
  const c = useCommentsStore
    .getState()
    .addComment(over.file ?? 'main.tex', over.line ?? 5, over.text ?? '批注', '导师')!;
  if (over.resolved) useCommentsStore.getState().toggleResolved(c.id);
  for (const r of over.replies ?? []) {
    useCommentsStore.getState().addReply(c.id, r.text, r.author);
  }
  return c;
}

beforeEach(() => {
  localStorage.clear();
  useCommentsStore.setState({ comments: [] });
  useSettingsStore.setState({ language: 'zh' });
  useWorkspaceStore.setState({
    activeTab: 'main.tex',
    openTabs: ['main.tex'],
    files: { 'main.tex': '\\documentclass{article}' },
  });
  vi.mocked(jumpTo).mockClear();
  notifyCursor({ file: 'main.tex', line: 12, col: 1 });

  capturedBlob = null;
  anchorDownloads.length = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    value: (b: Blob) => {
      capturedBlob = b;
      return 'blob:mock';
    },
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', { value: () => {}, configurable: true });
  anchorClickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    anchorDownloads.push(this.download);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  anchorClickSpy?.mockRestore();
  anchorClickSpy = null;
});

describe('CommentsPanel · 添加入口可用性', () => {
  it('无 activeTab：添加按钮 disabled 且 title 说明，空态占位，导出禁用', () => {
    useWorkspaceStore.setState({ activeTab: null, openTabs: [] });
    renderPanel();

    const add = q('[data-add-comment]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('请先打开一个 .tex 文件');
    expect(container!.textContent).toContain('还没有批注');
    expect((q('[data-export-md]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('activeTab 非 .tex：disabled + title 说明', () => {
    useWorkspaceStore.setState({ activeTab: 'refs.bib', openTabs: ['refs.bib'], files: { 'refs.bib': '' } });
    renderPanel();

    const add = q('[data-add-comment]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('仅支持在 .tex 文件上添加批注');
  });

  it('光标不在 activeTab（lastCursor().file 不一致）：disabled + title 说明；一致时可用', () => {
    notifyCursor({ file: 'sections/intro.tex', line: 3, col: 1 });
    renderPanel();
    const add = q('[data-add-comment]') as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.title).toBe('光标不在当前文件：请先在编辑器中点击定位');

    // 光标回到 activeTab → 可用
    act(() => {
      notifyCursor({ file: 'main.tex', line: 12, col: 3 });
    });
    expect((q('[data-add-comment]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('通知光标到当前文件后按钮从禁用变可用（响应式光标桥，实时跟随光标移动）', () => {
    notifyCursor({ file: 'sections/intro.tex', line: 8, col: 1 }); // 初始：光标不在 activeTab
    renderPanel();
    expect((q('[data-add-comment]') as HTMLButtonElement).disabled).toBe(true);

    // 编辑器光标进入当前文件 → notifyCursor 通知订阅者，面板实时重渲染，按钮变可用
    act(() => {
      notifyCursor({ file: 'main.tex', line: 5, col: 2 });
    });
    const add = q('[data-add-comment]') as HTMLButtonElement;
    expect(add.disabled).toBe(false);
    expect(add.title).toBe('在当前行添加批注');

    // 光标又移到别的文件 → 按钮立即回到禁用
    act(() => {
      notifyCursor({ file: 'sections/intro.tex', line: 9, col: 1 });
    });
    expect((q('[data-add-comment]') as HTMLButtonElement).disabled).toBe(true);

    // 回到当前文件后添加批注：行号取通知后的光标行
    act(() => {
      notifyCursor({ file: 'main.tex', line: 5, col: 2 });
    });
    click(q('[data-add-comment]')!);
    typeInto(q<HTMLTextAreaElement>('.sf-comments-text')!, '行号来自响应式光标');
    click(q('[data-compose-submit]')!);
    const comments = useCommentsStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.line).toBe(5);
  });
});

describe('CommentsPanel · 添加批注（内联输入区）', () => {
  it('点击可用按钮弹内联输入区 → addComment(activeTab, lastCursor().line, text, 作者默认「导师」）', () => {
    renderPanel();
    expect(q('.sf-comments-compose')).toBeNull();

    click(q('[data-add-comment]')!);
    const compose = q('.sf-comments-compose')!;
    expect(compose.textContent).toContain('在 main.tex 行 12 添加批注');
    expect((q('[data-compose-submit]') as HTMLButtonElement).disabled).toBe(true); // 空文本不可提交

    typeInto(q<HTMLTextAreaElement>('.sf-comments-text')!, '这段论证需要补一条基线对比');
    typeInto(q<HTMLInputElement>('.sf-comments-author')!, '导师');
    click(q('[data-compose-submit]')!);

    const comments = useCommentsStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.file).toBe('main.tex');
    expect(comments[0]!.line).toBe(12); // 来自 lastCursor().line
    expect(comments[0]!.author).toBe('导师');
    expect(comments[0]!.text).toBe('这段论证需要补一条基线对比');
    expect(q('.sf-comments-compose')).toBeNull(); // 提交后关闭
    expect(container!.textContent).toContain('已添加批注：main.tex 12 行');
  });
});

describe('CommentsPanel · 列表/过滤/跳转', () => {
  it('默认过滤「未解决」：已解决条目不出现；三态切换 + 各自计数；已解决条目降透明度', () => {
    seedComment({ text: '问题A', resolved: false });
    seedComment({ file: 'sections/intro.tex', line: 2, text: '问题B', resolved: true });

    renderPanel();
    expect(container!.querySelectorAll('.sf-comment')).toHaveLength(1);
    expect(container!.textContent).toContain('问题A');
    expect(container!.textContent).not.toContain('问题B');

    expect(q('[data-filter="all"]')!.textContent!.trim()).toBe('全部 2');
    expect(q('[data-filter="open"]')!.textContent!.trim()).toBe('未解决 1');
    expect(q('[data-filter="resolved"]')!.textContent!.trim()).toBe('已解决 1');

    click(q('[data-filter="all"]')!);
    expect(container!.querySelectorAll('.sf-comment')).toHaveLength(2);
    // 已解决条目 opacity 0.55（降透明度）
    const resolvedItem = [...container!.querySelectorAll<HTMLElement>('.sf-comment')].find((el) =>
      el.textContent?.includes('问题B'),
    )!;
    expect(resolvedItem.style.opacity).toBe('0.55');

    click(q('[data-filter="resolved"]')!);
    expect(container!.textContent).toContain('问题B');
    expect(container!.textContent).not.toContain('问题A');
  });

  it('点击条目头 → jumpTo({file, line}) 跳源码行', () => {
    seedComment({ file: 'sections/intro.tex', line: 15, text: '这里' });
    renderPanel();

    click(q('.sf-comment-head')!);
    expect(vi.mocked(jumpTo)).toHaveBeenCalledWith({ file: 'sections/intro.tex', line: 15 });
  });
});

describe('CommentsPanel · 回复 / 解决 / 删除交互', () => {
  it('回复：内联输入 → 提交后落库（默认作者「作者」）并自动展开可见', () => {
    const c = seedComment({ text: '问题' });
    renderPanel();

    click(q('[data-comment-reply]')!);
    typeInto(q<HTMLTextAreaElement>('[data-reply-text]')!, '已在第二稿修改');
    click(q('[data-reply-submit]')!);

    const after = useCommentsStore.getState().comments[0]!;
    expect(after.replies).toHaveLength(1);
    expect(after.replies[0]!.author).toBe('作者');
    expect(after.replies[0]!.text).toBe('已在第二稿修改');
    expect(q('[data-reply-text]')).toBeNull(); // 输入框关闭
    expect(container!.textContent).toContain('已在第二稿修改'); // 回复列表展开可见
  });

  it('标为已解决：默认（未解决）过滤器下消失，切「已解决」可见，按钮文案变「重新打开」', () => {
    seedComment({ text: '问题A', resolved: false });
    renderPanel();
    expect(container!.textContent).toContain('问题A');

    click(btn('标为已解决'));
    expect(useCommentsStore.getState().comments[0]!.resolved).toBe(true);
    expect(container!.textContent).not.toContain('问题A');
    expect(container!.textContent).toContain('当前过滤器下没有批注');

    click(q('[data-filter="resolved"]')!);
    expect(container!.textContent).toContain('问题A');
    expect(btn('重新打开')).toBeTruthy();
  });

  it('删除：条目移除并提示', () => {
    seedComment({ text: '问题A' });
    seedComment({ text: '问题B' });
    renderPanel();

    const dels = container!.querySelectorAll('[data-comment-del]');
    click(dels[0]!);

    const rest = useCommentsStore.getState().comments;
    expect(rest).toHaveLength(1);
    expect(rest[0]!.text).toBe('问题B');
    expect(container!.textContent).toContain('批注已删除');
  });
});

describe('CommentsPanel · 导出审阅意见 .md', () => {
  it('点击导出：下载 review-comments-YYYYMMDD.md，内容按文件分组并含已解决标记', async () => {
    const c = seedComment({ file: 'main.tex', line: 5, text: '论证不足', resolved: true });
    useCommentsStore.getState().addReply(c.id, '已补充对比实验');
    seedComment({ file: 'sections/intro.tex', line: 2, text: '术语不一致' });
    renderPanel();

    click(q('[data-export-md]')!);
    expect(anchorDownloads).toHaveLength(1);
    expect(anchorDownloads[0]).toMatch(/^review-comments-\d{8}\.md$/);

    expect(capturedBlob).not.toBeNull();
    const md = await blobText(capturedBlob!);
    expect(md).toContain('## main.tex');
    expect(md).toContain('## sections/intro.tex');
    expect(md).toContain('- [行 5] 导师：论证不足（已解决）');
    expect(md).toContain('  - 作者：已补充对比实验');
    expect(container!.textContent).toContain('已导出 2 条批注为 .md');
  });
});

describe('CommentsPanel · zh/en 字典', () => {
  it('language=en 时按钮/过滤文案切换为英文', () => {
    useSettingsStore.setState({ language: 'en' });
    seedComment({ text: 'Issue A', resolved: false });
    seedComment({ text: 'Issue B', resolved: true });
    renderPanel();

    expect(q('[data-add-comment]')!.textContent).toContain('Add comment at cursor');
    expect(q('[data-filter="open"]')!.textContent!.trim()).toBe('Open 1');
    expect(q('[data-filter="resolved"]')!.textContent!.trim()).toBe('Resolved 1');
    expect(q('[data-export-md]')!.textContent).toContain('Export review .md');
    expect(container!.textContent).toContain('Issue A');
    expect(container!.textContent).not.toContain('Issue B');
  });
});
