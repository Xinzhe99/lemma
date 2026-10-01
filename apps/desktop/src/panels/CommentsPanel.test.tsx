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
 *  - 导出批注包 .json / 审阅报告 HTML（空批注+空标注禁用；文件名 sf-review-…；内容/统计）；
 *  - 导入批注包（合法包 → 应用内 confirm 含条数摘要 → 落库 + 统计提示；取消不落库；
 *    坏 JSON / 坏 schema 中文提示；标注按 id 去重跳过计入 K）；
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
import { useAnnotationStore } from '../state/annotationStore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { buildReviewPackage } from '../reviewPackage';
import type { Annotation } from '@scholarforge/shared';

// jsdom 的 Blob/File 无 text()（导入流程组件内 file.text() 依赖）：经 FileReader 补齐
if (typeof Blob !== 'undefined' && Blob.prototype.text === undefined) {
  Blob.prototype.text = function (this: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

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
  useAnnotationStore.setState({ byFile: {} });
  useUiStore.setState({ textDialog: null });
  useSettingsStore.setState({ language: 'zh' });
  useWorkspaceStore.setState({
    projectName: 'demo-paper',
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
  useUiStore.getState().closeTextDialog();
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

// ===========================================================================
// 导出批注包 .json / 审阅报告 HTML / 导入批注包（协作闭环）
// ===========================================================================

/** 预置一条 PDF 标注进 annotationStore（缺省键 pdf:ref.pdf） */
function seedAnnotation(over: Partial<Annotation> & { fileKey?: string } = {}): Annotation {
  const a: Annotation = {
    id: over.id ?? 'a-1',
    paperId: over.paperId ?? 'p-1',
    page: over.page ?? 3,
    kind: over.kind ?? 'highlight',
    semantic: over.semantic ?? 'method',
    quotedText: over.quotedText ?? 'Baseline comparison missing.',
    text: over.text ?? '建议补对比',
    createdAt: over.createdAt ?? 1700000000000,
  };
  const fileKey = over.fileKey ?? 'pdf:ref.pdf';
  useAnnotationStore.setState({
    byFile: { ...useAnnotationStore.getState().byFile, [fileKey]: [a] },
  });
  return a;
}

function statusText(): string {
  return (q('[role="status"]') as HTMLElement | null)?.textContent ?? '';
}

describe('CommentsPanel · 导出批注包 / 审阅报告', () => {
  it('空批注 + 空标注：.json 与 HTML 导出按钮禁用（.md 按批注禁用）', () => {
    renderPanel();
    expect((q('[data-export-json]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[data-export-html]') as HTMLButtonElement).disabled).toBe(true);
    expect((q('[data-export-md]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('导出批注包：下载 sf-review-{projectName}-{YYYYMMDD}.json，内容含 schema/批注/标注与统计提示', async () => {
    seedComment({ file: 'main.tex', line: 5, text: '论证不足' });
    seedAnnotation({ id: 'ref', semantic: 'finding' });

    renderPanel();
    click(q('[data-export-json]')!);

    expect(anchorDownloads).toHaveLength(1);
    expect(anchorDownloads[0]).toMatch(/^sf-review-demo-paper-\d{8}\.json$/);
    expect(capturedBlob).not.toBeNull();
    const parsed = JSON.parse(await blobText(capturedBlob!)) as ReturnType<typeof buildReviewPackage>;
    expect(parsed.schema).toBe('sf-review');
    expect(parsed.version).toBe(1);
    expect(parsed.projectName).toBe('demo-paper');
    expect(parsed.comments).toHaveLength(1);
    expect(parsed.comments[0]!.text).toBe('论证不足');
    expect(parsed.annotations).toHaveLength(1);
    expect(parsed.annotations[0]!.items[0]!.semantic).toBe('finding');
    expect(statusText()).toBe('已导出批注包：1 条批注 / 1 条标注');
  });

  it('导出审阅报告 (HTML)：下载 sf-review-…-.html，自包含（doctype/两区标题/Ctrl+P 提示）', async () => {
    seedComment({ file: 'main.tex', line: 5, text: '论证不足' });
    seedAnnotation({ id: 'ref' });

    renderPanel();
    click(q('[data-export-html]')!);

    expect(anchorDownloads).toHaveLength(1);
    expect(anchorDownloads[0]).toMatch(/^sf-review-demo-paper-\d{8}\.html$/);
    const html = await blobText(capturedBlob!);
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('稿件批注');
    expect(html).toContain('PDF 标注');
    expect(html).toContain('Ctrl+P 打印为 PDF');
    expect(statusText()).toBe('已导出审阅报告（1 条批注 / 1 条标注）');
  });

  it('仅有 PDF 标注（无批注）时 .json/HTML 可导出，包内 comments 为空数组', async () => {
    seedAnnotation({ id: 'ref' });
    renderPanel();

    expect((q('[data-export-json]') as HTMLButtonElement).disabled).toBe(false);
    expect((q('[data-export-html]') as HTMLButtonElement).disabled).toBe(false);
    expect((q('[data-export-md]') as HTMLButtonElement).disabled).toBe(true); // .md 仅看批注

    click(q('[data-export-json]')!);
    const parsed = JSON.parse(await blobText(capturedBlob!)) as ReturnType<typeof buildReviewPackage>;
    expect(parsed.comments).toHaveLength(0);
    expect(parsed.annotations[0]!.items).toHaveLength(1);
  });
});

describe('CommentsPanel · 导入批注包', () => {
  /** 模拟选择导入文件（jsdom 无 DataTransfer，直接定义 files；等待 file.text() 出队） */
  async function pickImportFile(name: string, text: string): Promise<void> {
    const input = q<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('import file input not found');
    const file = new File([text], name, { type: 'application/json' });
    Object.defineProperty(input, 'files', {
      value: { 0: file, length: 1, item: () => file },
      configurable: true,
    });
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 10));
    });
  }

  /** 一份合法导入包（导师机导出形态）：1 条已解决批注 + 2 条标注 */
  function advisorPackageJson(): string {
    return JSON.stringify(
      buildReviewPackage({
        projectName: 'from-advisor',
        comments: [
          {
            id: 'c-ext',
            file: 'sections/intro.tex',
            line: 9,
            author: '李导师',
            text: '引言动机不足',
            resolved: true,
            createdAt: 1700000000000,
            replies: [{ author: '作者', text: '已补充', createdAt: 1700000001000 }],
          },
        ],
        annotations: {
          'pdf:ref.pdf': [
            { id: 'a-ext-1', paperId: 'p-1', page: 2, kind: 'highlight', semantic: 'question', quotedText: 'Why?', text: '追问', createdAt: 1700000000000 },
            { id: 'a-ext-2', paperId: 'p-1', page: 4, kind: 'note', text: '排版', createdAt: 1700000002000 },
          ],
        },
      }),
    );
  }

  it('合法包：应用内 confirm（标题含条数摘要）→ 确认后落库并提示统计', async () => {
    renderPanel();
    await pickImportFile('review.json', advisorPackageJson());

    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('confirm');
    expect(req?.title).toBe('将导入 1 条批注 / 2 条 PDF 标注，是否继续？');
    expect(req?.confirmText).toBe('导入');
    expect(statusText()).toBe(''); // 确认前无结果提示

    await act(async () => {
      req!.resolve('导入');
      await new Promise((r) => setTimeout(r, 0));
    });

    const comments = useCommentsStore.getState().comments;
    expect(comments).toHaveLength(1);
    expect(comments[0]!.file).toBe('sections/intro.tex');
    expect(comments[0]!.line).toBe(9);
    expect(comments[0]!.author).toBe('李导师');
    expect(comments[0]!.resolved).toBe(true); // resolved 保留
    expect(comments[0]!.replies[0]!.text).toBe('已补充');

    const byFile = useAnnotationStore.getState().byFile;
    expect(byFile['pdf:ref.pdf']).toHaveLength(2);
    expect(statusText()).toBe('已导入 1 条批注 / 2 条标注（跳过重复 0）');
  });

  it('confirm 取消（resolve null）：不落库、无统计提示', async () => {
    renderPanel();
    await pickImportFile('review.json', advisorPackageJson());
    await act(async () => {
      useUiStore.getState().textDialog!.resolve(null);
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(useCommentsStore.getState().comments).toHaveLength(0);
    expect(useAnnotationStore.getState().byFile).toEqual({});
    expect(statusText()).toBe('');
  });

  it('坏 JSON 文件：中文提示且不弹确认框', async () => {
    renderPanel();
    await pickImportFile('bad.json', '{not json');
    expect(statusText()).toBe('导入失败：不是有效的 JSON 文件');
    expect(useUiStore.getState().textDialog).toBeNull();
  });

  it('坏 schema：提示校验错误（含 schema 字样），不弹确认框、不落库', async () => {
    renderPanel();
    await pickImportFile('wrong.json', JSON.stringify({ schema: 'other', version: 1 }));
    expect(statusText()).toBe('导入失败：schema 不符：期望 "sf-review"');
    expect(useUiStore.getState().textDialog).toBeNull();
    expect(useCommentsStore.getState().comments).toHaveLength(0);
  });

  it('标注按 id 去重：本机已有同 id 跳过计入 K，批注仍导入', async () => {
    useAnnotationStore.setState({
      byFile: { 'pdf:ref.pdf': [{ id: 'a-ext-1', paperId: 'p-1', page: 2, kind: 'highlight', createdAt: 1 }] },
    });
    renderPanel();
    await pickImportFile('review.json', advisorPackageJson());
    await act(async () => {
      useUiStore.getState().textDialog!.resolve('导入');
      await new Promise((r) => setTimeout(r, 0));
    });

    const byFile = useAnnotationStore.getState().byFile;
    expect(byFile['pdf:ref.pdf']).toHaveLength(2); // 已有 1 + 新 1（a-ext-1 跳过）
    expect(useCommentsStore.getState().comments).toHaveLength(1);
    expect(statusText()).toBe('已导入 1 条批注 / 1 条标注（跳过重复 1）');
  });

  it('en 字典：导出/导入按钮与导入确认标题为英文', async () => {
    useSettingsStore.setState({ language: 'en' });
    seedComment({ text: 'Issue' });
    renderPanel();

    expect(q('[data-export-json]')!.textContent).toContain('Export package (.json)');
    expect(q('[data-export-html]')!.textContent).toContain('Export report (HTML)');
    expect(q('[data-import-json]')!.textContent).toContain('Import package');

    await pickImportFile('review.json', advisorPackageJson());
    const req = useUiStore.getState().textDialog;
    expect(req?.title).toBe('Import 1 comments / 2 PDF annotations?');
    expect(req?.confirmText).toBe('Import');
    await act(async () => {
      req!.resolve('Import');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(statusText()).toBe('Imported 1 comments / 2 annotations (0 duplicates skipped)');
  });
});
