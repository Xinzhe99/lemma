// @vitest-environment jsdom
/**
 * BackupDialog 组件测试（全量备份/恢复）。测试环境说明同 ProjectSwitcher.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现。覆盖验收路径：
 *  - 导出：当前数据摘要展示；点击导出 → Blob 下载（createObjectURL/anchor.download/撤销），
 *    备份内容经 buildBackup（schema/version/data 各节），且 API key 永不出现；
 *  - 选文件：坏 JSON / 坏 schema 拒绝并提示，不出现恢复按钮；
 *  - 恢复：合法备份 → 摘要展示 → 应用内 confirm（openTextDialog mode:'confirm'）→
 *    逐 store setState（library/notes/annotation/projects[localStorage sf-projects]/workspace/设置），
 *    providers 不被覆盖；完成后提示「已恢复，建议刷新页面」；取消不改动；
 *  - zh/en 字典。
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

import { BackupDialog } from './BackupDialog';
import { buildBackup } from '../backup';
import { useAnnotationStore } from '../state/annotationStore';
import { useLibraryStore } from '../state/libraryStore';
import { useNotesStore } from '../state/notesStore';
import { useProjectsStore, PROJECTS_STORAGE_KEY, type ProjectRecord } from '../state/projectsStore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import type { Annotation, Note, Paper } from '@lemma/shared';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 的 Blob/File 无 text()（导出内容断言与组件内 file.text() 都依赖）：经 FileReader 补齐
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

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock');
const revokeObjectURL = vi.fn();
const anchorClicks: HTMLAnchorElement[] = [];

// —— 完整类型的初始/恢复数据（store setState 与 toEqual 都要求完整实体） ——

const PAPER_CUR: Paper = {
  id: 'p-cur',
  citekey: 'vaswani2017attention',
  title: 'Attention Is All You Need',
  authors: [],
  tags: [],
  collections: [],
  readStatus: 'done',
  addedAt: 1,
};
const NOTE_CUR: Note = { id: 'n-cur', title: '当前卡片', bodyMd: '', links: [], createdAt: 1, updatedAt: 1 };
const ANN_CUR: Annotation = { id: 'a-cur', paperId: '', page: 1, kind: 'note', createdAt: 1 };

const PAPER_RESTORED: Paper = {
  id: 'p-restored',
  citekey: 'brown2020language',
  title: 'Language Models',
  authors: [],
  tags: [],
  collections: [],
  readStatus: 'to-read',
  addedAt: 2,
};
const NOTE_RESTORED: Note = {
  id: 'n-restored',
  title: '恢复的卡片',
  bodyMd: '',
  links: [],
  createdAt: 2,
  updatedAt: 2,
};
const ANN_RESTORED: Annotation = { id: 'a-restored', paperId: 'p-restored', page: 2, kind: 'highlight', createdAt: 2 };
const REC_RESTORED: ProjectRecord = {
  id: 'rec-restored',
  name: 'restored-project',
  savedAt: 1700000000000,
  snapshot: {
    projectName: 'restored-project',
    entry: 'paper.tex',
    files: { 'paper.tex': '\\documentclass{article}' },
    openTabs: ['paper.tex'],
    activeTab: 'paper.tex',
    snapshots: {},
  },
};

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

/** 模拟 file input 选择文件并触发 change（异步 onChange）；jsdom 无 DataTransfer，直接定义 files。
 *  额外等一个宏任务：FileReader（Blob.text polyfill）的 load 回调与 setState 需要出队后才可见。 */
async function pickFile(input: HTMLInputElement, name: string, text: string): Promise<void> {
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

/** 构造一份与初始状态不同的合法备份 JSON（含 API key 探针以验证永不落盘/永不恢复 providers） */
function validBackupJson(): string {
  return JSON.stringify(
    buildBackup({
      papers: [PAPER_RESTORED],
      notes: [NOTE_RESTORED],
      annotationsByFile: { 'paper:p-restored': [ANN_RESTORED] },
      projects: [REC_RESTORED],
      workspace: {
        projectName: 'restored-project',
        entry: 'paper.tex',
        files: { 'paper.tex': '\\documentclass{article}' },
        snapshots: { 'paper.tex': [{ content: 'old', ts: 1, label: 'AI 修改前' }] },
      },
      embeddingModel: 'bge-m3',
      theme: 'dark',
      language: 'en',
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  onClose = vi.fn();
  useSettingsStore.setState({
    providers: [
      {
        id: 'pv1',
        label: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-never-export-me',
        model: 'gpt-4o',
        tier: 'flagship',
      },
    ],
    activeProviderId: 'pv1',
    embeddingModel: '',
    theme: 'light',
    language: 'zh',
  });
  useLibraryStore.setState({
    papers: [PAPER_CUR],
    indexReady: true,
  });
  useNotesStore.setState({ notes: [NOTE_CUR] });
  useAnnotationStore.setState({ byFile: { 'pdf:cur.pdf': [ANN_CUR] } });
  useProjectsStore.setState({
    projects: [
      {
        id: 'rec-cur',
        name: 'demo-paper',
        savedAt: 1,
        snapshot: {
          projectName: 'demo-paper',
          entry: 'main.tex',
          files: { 'main.tex': '\\documentclass{article}' },
          openTabs: ['main.tex'],
          activeTab: 'main.tex',
          snapshots: {},
        },
      },
    ],
  });
  useWorkspaceStore.setState({
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: { 'main.tex': '\\documentclass{article}' },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
  });
  useUiStore.setState({ textDialog: null });

  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
    writable: true,
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push(this);
  });

  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<BackupDialog onClose={onClose} />);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useUiStore.getState().closeTextDialog();
  const r = root;
  if (r) act(() => r.unmount());
  anchorClicks.length = 0;
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  container?.remove();
  root = null;
  container = null;
});

describe('BackupDialog · 导出', () => {
  it('展示当前数据摘要（各部分条数）', () => {
    const text = container!.textContent ?? '';
    expect(text).toContain('文献 1 条');
    expect(text).toContain('笔记 1 张');
    expect(text).toContain('PDF 标注 1 条（1 个文件）');
    expect(text).toContain('项目记录 1 个');
    expect(text).toContain('工作区文件 1 个（demo-paper · 入口 main.tex）');
  });

  it('点击导出 → Blob 下载 lemma-backup-YYYYMMDD-HHmm.json，内容为合法备份且不含 API key', async () => {
    click(btn('导出全量备份'));

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    const anchor = anchorClicks[0]!;
    expect(anchor.download).toMatch(/^lemma-backup-\d{8}-\d{4}\.json$/);

    const blob = createObjectURL.mock.calls[0]![0];
    const parsed = JSON.parse(await blob.text()) as ReturnType<typeof buildBackup>;
    expect(parsed.schema).toBe('lemma-backup');
    expect(parsed.version).toBe(1);
    expect(parsed.data.library.papers).toHaveLength(1);
    expect(parsed.data.knowledge.notes).toHaveLength(1);
    expect(parsed.data.knowledge.annotationsByFile['pdf:cur.pdf']).toHaveLength(1);
    expect(parsed.data.projects).toHaveLength(1);
    expect(parsed.data.workspace.projectName).toBe('demo-paper');
    // API key 永不进备份
    expect(await blob.text()).not.toContain('sk-never-export-me');
    expect(parsed.data.settings).not.toHaveProperty('providers');

    expect((container!.querySelector('[role="status"]') as HTMLElement).textContent).toMatch(
      /^已导出：lemma-backup-/,
    );
  });
});

describe('BackupDialog · 选文件与校验', () => {
  function fileInput(): HTMLInputElement {
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not found');
    return input;
  }

  it('坏 JSON（parse 失败）拒绝并提示，不出现恢复按钮', async () => {
    await pickFile(fileInput(), 'bad.json', '{not json');
    expect((container!.querySelector('[role="status"]') as HTMLElement).textContent).toContain(
      '备份文件无效',
    );
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent === '从备份恢复')).toBe(false);
  });

  it('坏 schema / 坏 version 拒绝并提示', async () => {
    await pickFile(fileInput(), 'wrong-schema.json', JSON.stringify({ schema: 'other', version: 1 }));
    expect((container!.querySelector('[role="status"]') as HTMLElement).textContent).toContain('schema');

    await pickFile(fileInput(), 'wrong-version.json', JSON.stringify({
      schema: 'lemma-backup',
      version: 2,
      exportedAt: '2026-01-01T00:00:00.000Z',
      data: {},
    }));
    const status = (container!.querySelector('[role="status"]') as HTMLElement).textContent ?? '';
    expect(status).toContain('version');
    expect([...container!.querySelectorAll('button')].some((b) => b.textContent === '从备份恢复')).toBe(false);
  });
});

describe('BackupDialog · 恢复', () => {
  function fileInput(): HTMLInputElement {
    const input = container!.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error('file input not found');
    return input;
  }

  it('合法备份 → 摘要展示 → 应用内 confirm 确认后逐 store 恢复，providers 不动，提示建议刷新', async () => {
    await pickFile(fileInput(), 'backup.json', validBackupJson());
    const text = container!.textContent ?? '';
    expect(text).toContain('备份内容');
    expect(text).toContain('restored-project');
    expect(text).toContain('文献 1 条');

    click(btn('从备份恢复'));
    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('confirm');
    expect(req?.confirmText).toBe('恢复');

    await act(async () => {
      req!.resolve('yes');
      await new Promise((r) => setTimeout(r, 0));
    });

    // 逐 store 校验
    expect(useLibraryStore.getState().papers).toEqual([PAPER_RESTORED]);
    expect(useNotesStore.getState().notes).toEqual([NOTE_RESTORED]);
    expect(useAnnotationStore.getState().byFile).toEqual({
      'paper:p-restored': [ANN_RESTORED],
    });
    // projectsStore 恢复并回写 localStorage sf-projects
    expect(useProjectsStore.getState().projects.map((p) => p.name)).toEqual(['restored-project']);
    expect(localStorage.getItem(PROJECTS_STORAGE_KEY)).toContain('restored-project');

    const ws = useWorkspaceStore.getState();
    expect(ws.projectName).toBe('restored-project');
    expect(ws.entry).toBe('paper.tex');
    expect(ws.files['paper.tex']).toContain('documentclass');
    expect(ws.snapshots['paper.tex']).toHaveLength(1);

    const st = useSettingsStore.getState();
    expect(st.theme).toBe('dark');
    expect(st.language).toBe('en');
    expect(st.embeddingModel).toBe('bge-m3');
    // providers（含现有 API key）不被备份覆盖
    expect(st.providers).toHaveLength(1);
    expect(st.providers[0]!.apiKey).toBe('sk-never-export-me');

    expect((container!.querySelector('[role="status"]') as HTMLElement).textContent).toBe(
      '已恢复，建议刷新页面',
    );
  });

  it('confirm 取消（resolve null）：所有 store 不改动', async () => {
    await pickFile(fileInput(), 'backup.json', validBackupJson());
    click(btn('从备份恢复'));
    await act(async () => {
      useUiStore.getState().textDialog!.resolve(null);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(useLibraryStore.getState().papers[0]!.id).toBe('p-cur');
    expect(useNotesStore.getState().notes[0]!.id).toBe('n-cur');
    expect(useWorkspaceStore.getState().projectName).toBe('demo-paper');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('Esc 关闭（onClose 触发）', () => {
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BackupDialog · 字典', () => {
  it('en 渲染英文文案', async () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    const text = container!.textContent ?? '';
    expect(text).toContain('Export full backup');
    expect(text).toContain('Restore from backup');
    expect(text).toContain('1 papers');
  });
});
