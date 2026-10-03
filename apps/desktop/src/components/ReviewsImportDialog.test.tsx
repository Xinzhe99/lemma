// @vitest-environment jsdom
/**
 * ReviewsImportDialog 组件测试。测试环境说明同 StatsDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现，避免根 react@19 混渲染；
 * 另 mock @lemma/library 的 loadPdfText（避免拉起 pdfjs 运行时，并可控返回）。
 * 覆盖：粘贴解析、.txt/.docx/.pdf 三格式文件入口、文件名 reviewer 数字命名、
 * 预览编辑/删除/加条、统计行、启动 W7 的 launchWorkflow 参数（含 manuscript=
 * combinedDoc）、保存笔记（标题含日期、正文结构化）、空态禁用、Esc 关闭。
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

/** loadPdfText mock：按传入 PDF 首字节区分不同 fixture（vi.hoisted 供提升后的 factory 引用） */
const { loadPdfText } = vi.hoisted(() => ({
  loadPdfText: vi.fn(
    async (data: ArrayBuffer): Promise<{ numPages: number; pages: Array<{ page: number; text: string }> }> => {
      const text = new TextDecoder().decode(new Uint8Array(data));
      if (text.includes('PDF-REVIEW-2')) {
        return { numPages: 1, pages: [{ page: 1, text: '1. Second reviewer item.' }] };
      }
      return { numPages: 1, pages: [{ page: 1, text: 'Reviewer 1\n1. From pdf.' }] };
    },
  ),
}));
vi.mock('@lemma/library', () => ({ loadPdfText }));

import { ReviewsImportDialog } from './ReviewsImportDialog';
import { useSettingsStore } from '../state/settingsStore';
import { useNotesStore } from '../state/notesStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { strToU8, zipSync } from 'fflate';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PASTE_TEXT = [
  'Dear Author,',
  'Reviewer 1',
  'Weaknesses:',
  '1. No baselines.',
  '2. Writing is vague.',
  'Reviewer 2',
  '1. Figure 3 is small.',
].join('\n');

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function findButton(label: string): HTMLButtonElement {
  const btn = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === label,
  );
  expect(btn, `未找到「${label}」按钮`).toBeDefined();
  return btn!;
}

function switchTab(label: string): void {
  click(findButton(label));
}

async function typeInto(area: HTMLTextAreaElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(area, value);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** 往隐藏 file input 塞文件并触发 change（BackupDialog.test 同款手法） */
async function pickFiles(input: HTMLInputElement, files: File[]): Promise<void> {
  const shaped = {} as { [index: number]: File; length: number; item: (i: number) => File | null };
  files.forEach((f, i) => {
    shaped[i] = f;
  });
  shaped.length = files.length;
  shaped.item = (i: number) => shaped[i] ?? null;
  Object.defineProperty(input, 'files', { value: shaped, configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

function fileInput(): HTMLInputElement {
  const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error('file input not found');
  return input;
}

/**
 * jsdom 25 的 File 没有 arrayBuffer()：fixture 上补齐（组件按标准 Web API 调用，
 * 真实 WKWebView/浏览器均有该方法）。
 */
function fixtureFile(content: string | Uint8Array, name: string, type: string): File {
  const file = new File(
    [typeof content === 'string' ? content : (content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer)],
    name,
    { type },
  );
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  Object.defineProperty(file, 'arrayBuffer', {
    value: async (): Promise<ArrayBuffer> =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    configurable: true,
  });
  return file;
}

function itemTextareas(): HTMLTextAreaElement[] {
  return [...container!.querySelectorAll<HTMLTextAreaElement>('.sf-reviews-item textarea')];
}

function summary(): string {
  return container!.querySelector<HTMLElement>('.sf-reviews-summary')?.textContent ?? '';
}

function cardTitles(): string[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-reviews-card-header strong')].map(
    (el) => el.textContent ?? '',
  );
}

/** 构造最小 docx zip fixture */
function docxFile(name: string, paragraphs: string[]): File {
  const xml =
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('') +
    '</w:body></w:document>';
  return fixtureFile(zipSync({ 'word/document.xml': strToU8(xml) }), name, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
}

beforeEach(() => {
  onClose = vi.fn();
  loadPdfText.mockClear();
  useSettingsStore.setState({ language: 'zh' });
  useWorkspaceStore.setState({
    projectName: 'demo',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}\\begin{document}正文\\end{document}' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  });
  useNotesStore.setState({ notes: [] });
  useUiStore.setState({ workflowLaunch: null, workflowLaunchVars: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ReviewsImportDialog onClose={onClose} />);
  });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ReviewsImportDialog · 粘贴文本入口', () => {
  it('粘贴 → 解析预览：按审稿人分栏卡片、统计行、类型徽标', async () => {
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    expect(area).toBeTruthy();
    await typeInto(area!, PASTE_TEXT);
    click(findButton('解析预览'));

    expect(cardTitles()).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(summary()).toBe('2 位审稿人 · 3 条意见');
    const texts = itemTextareas().map((t) => t.value);
    expect(texts).toEqual(['No baselines.', 'Writing is vague.', 'Figure 3 is small.']);
    // 小节头映射的缺点类型展示为徽标
    expect(container!.textContent).toContain('[缺点]');
    // 编辑信套话被剔除（textarea 仍保留用户粘贴原文，只看预览区）
    const preview = container!.querySelector('.sf-reviews-card')!.textContent ?? '';
    expect(preview).not.toContain('Dear Author');
  });

  it('粘贴无法识别时不渲染卡片并提示', async () => {
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(area!, 'Dear Author, thank you.');
    click(findButton('解析预览'));
    expect((container!.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      '未识别到审稿意见条目',
    );
    expect(container!.querySelector('.sf-reviews-card')).toBeNull();
  });
});

describe('ReviewsImportDialog · 文件入口（.txt / .docx / .pdf）', () => {
  it('.txt/.md 直读文本，文件名含 reviewer 数字用于命名', async () => {
    switchTab('文件导入');
    await pickFiles(fileInput(), [
      fixtureFile('1. A1.\n2. A2.', 'reviewer1.txt', 'text/plain'),
      fixtureFile('1. B1.', 'reviewer2.txt', 'text/plain'),
    ]);
    expect(cardTitles()).toEqual(['Reviewer 1', 'Reviewer 2']);
    expect(summary()).toBe('2 位审稿人 · 3 条意见');
    expect(itemTextareas()[2]!.value).toBe('B1.');
  });

  it('.docx 走最小提取器（段落换行保留）并解析', async () => {
    switchTab('文件导入');
    await pickFiles(fileInput(), [
      docxFile('review2.docx', ['Reviewer 2', 'Weaknesses:', '1. No comparison.']),
    ]);
    expect(cardTitles()).toEqual(['Reviewer 2']);
    expect(itemTextareas()[0]!.value).toBe('No comparison.');
  });

  it('.pdf 走 loadPdfText 拼接分页文本（异步 loading 后出结果）', async () => {
    switchTab('文件导入');
    expect(loadPdfText).not.toHaveBeenCalled();
    await pickFiles(fileInput(), [fixtureFile('%PDF-1.7 fake bytes', 'scan.pdf', 'application/pdf')]);
    expect(loadPdfText).toHaveBeenCalledTimes(1);
    expect(cardTitles()).toEqual(['Reviewer 1']); // 文件名无 reviewer 数字、内容无分隔符 → 单审稿人
    expect(itemTextareas()[0]!.value).toBe('From pdf.');
  });

  it('不支持的扩展名给出中文提示且不产生卡片', async () => {
    switchTab('文件导入');
    await pickFiles(fileInput(), [fixtureFile('x', 'legacy.doc', 'application/msword')]);
    expect((container!.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      '不支持的格式',
    );
    expect(container!.querySelector('.sf-reviews-card')).toBeNull();
  });

  it('坏 .docx（非 zip）报错不影响其余文件解析', async () => {
    switchTab('文件导入');
    await pickFiles(fileInput(), [
      fixtureFile(new Uint8Array([1, 2, 3]), 'broken.docx', 'application/zip'),
      fixtureFile('1. Fine.', 'ok.txt', 'text/plain'),
    ]);
    expect((container!.querySelector('[role="alert"]') as HTMLElement).textContent).toContain(
      'broken.docx',
    );
    expect(summary()).toBe('1 位审稿人 · 1 条意见');
  });
});

describe('ReviewsImportDialog · 预览编辑', () => {
  async function parsePaste(): Promise<void> {
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(area!, PASTE_TEXT);
    click(findButton('解析预览'));
  }

  it('就地编辑条目文本生效', async () => {
    await parsePaste();
    const first = itemTextareas()[0]!;
    await typeInto(first, 'No baselines at all.');
    expect(itemTextareas()[0]!.value).toBe('No baselines at all.');
    expect(summary()).toBe('2 位审稿人 · 3 条意见');
  });

  it('删除条目：计数更新且按钮随空态禁用', async () => {
    await parsePaste();
    click(findButton('×'));
    expect(summary()).toBe('2 位审稿人 · 2 条意见');
    click(findButton('×'));
    click(findButton('×'));
    expect(container!.querySelector('.sf-reviews-card')).not.toBeNull(); // 卡片仍在
    const launch = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '启动 Rebuttal 起草（W7）',
    )!;
    expect(launch.disabled).toBe(true);
  });

  it('手动加条：新增可编辑空条目，参与统计与后续启动输入', async () => {
    await parsePaste();
    click(findButton('+ 添加一条')); // 第一位审稿人的卡片
    expect(summary()).toBe('2 位审稿人 · 4 条意见');
    const added = itemTextareas()[2]!; // Reviewer 1 的第 3 条
    expect(added.value).toBe('');
    await typeInto(added, 'Newly added point.');
    expect(added.value).toBe('Newly added point.');
  });
});

describe('ReviewsImportDialog · 启动 W7 与保存笔记', () => {
  it('启动按钮调用 launchWorkflow：reviews 为结构化文本、manuscript 为 combinedDoc，随后 onClose', async () => {
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(area!, PASTE_TEXT);
    click(findButton('解析预览'));

    const launchSpy = vi.spyOn(useUiStore.getState(), 'launchWorkflow');
    click(findButton('启动 Rebuttal 起草（W7）'));
    expect(launchSpy).toHaveBeenCalledTimes(1);
    const [wfId, vars] = launchSpy.mock.calls[0]! as [string, Record<string, string>];
    expect(wfId).toBe('w7-rebuttal');
    expect(vars.reviews).toBe(
      ['【Reviewer 1】', 'R1.1: No baselines.', 'R1.2: Writing is vague.', '', '【Reviewer 2】', 'R2.1: Figure 3 is small.'].join('\n'),
    );
    expect(vars.manuscript).toContain('正文'); // combinedDoc(files) 的展开结果
    expect(onClose).toHaveBeenCalledTimes(1);
    launchSpy.mockRestore();
  });

  it('仅保存为笔记：标题含当日日期、正文为结构化文本', async () => {
    const area = container!.querySelector<HTMLTextAreaElement>('textarea');
    await typeInto(area!, PASTE_TEXT);
    click(findButton('解析预览'));

    click(findButton('仅保存为笔记'));
    const notes = useNotesStore.getState().notes;
    expect(notes).toHaveLength(1);
    const today = new Date().toISOString().slice(0, 10);
    expect(notes[0]!.title).toBe(`审稿意见 ${today}`);
    expect(notes[0]!.bodyMd).toContain('R1.1: No baselines.');
    expect(notes[0]!.bodyMd).toContain('【Reviewer 2】');
    expect((container!.querySelector('[role="status"]') as HTMLElement).textContent).toContain(
      '已保存到笔记',
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('ReviewsImportDialog · 空态与关闭', () => {
  it('未解析内容时两个主按钮禁用，解析按钮也因空文本禁用', () => {
    const launch = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent === '启动 Rebuttal 起草（W7）',
    )!;
    const save = findButton('仅保存为笔记');
    const parse = findButton('解析预览');
    expect(launch.disabled).toBe(true);
    expect(save.disabled).toBe(true);
    expect(parse.disabled).toBe(true);
  });

  it('Esc 与关闭按钮触发 onClose', () => {
    click(findButton('关闭'));
    expect(onClose).toHaveBeenCalledTimes(1);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
