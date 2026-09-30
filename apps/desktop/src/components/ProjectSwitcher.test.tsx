// @vitest-environment jsdom
/**
 * 测试环境说明同 QuickOpen.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现。
 * 覆盖：挂载写 __current__ 临时记录并置顶 / 一键转正式 / 保存（默认名、同名覆盖、空名回退）/
 * 列表行内容 / 打开（恢复 workspaceStore + onClose）/ 行内重命名 / 复制 / 删除（应用内确认对话框）/
 * 新建空白项目 / Esc 与遮罩关闭 / zh-en 字典。
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

import { ProjectSwitcher } from './ProjectSwitcher';
import { CURRENT_PROJECT_ID, useProjectsStore } from '../state/projectsStore';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function btn(text: string, scope: ParentNode = container!): HTMLButtonElement {
  const found = [...scope.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

function rows(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.sf-projects-row')];
}

function rowOf(name: string): HTMLElement {
  const row = rows().find((r) => r.querySelector('.sf-projects-name')?.textContent?.includes(name));
  if (!row) throw new Error(`row not found: ${name}`);
  return row;
}

const formalNames = () =>
  useProjectsStore
    .getState()
    .projects.filter((p) => p.id !== CURRENT_PROJECT_ID)
    .map((p) => p.name);

beforeEach(() => {
  localStorage.clear();
  useProjectsStore.setState({ projects: [] });
  useSettingsStore.setState({ language: 'zh' });
  useWorkspaceStore.setState({
    projectName: 'demo-paper',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'refs.bib': '@misc{key, title={T}}',
    },
    openTabs: ['main.tex', 'refs.bib'],
    activeTab: 'refs.bib',
    snapshots: {},
  });
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ProjectSwitcher onClose={onClose} />);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  useUiStore.getState().closeTextDialog();
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('ProjectSwitcher', () => {
  it('挂载即写入 __current__ 临时记录（崩溃恢复）并置顶展示', () => {
    const temp = useProjectsStore.getState().projects.find((p) => p.id === CURRENT_PROJECT_ID);
    expect(temp).toBeTruthy();
    expect(temp!.name).toBe('demo-paper');
    expect(temp!.snapshot.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(temp!.snapshot.files['main.tex']).toContain('\\begin{document}');

    const row = container!.querySelector('.sf-projects-row.current')!;
    expect(row.textContent).toContain('当前（未保存快照）');
    expect(row.textContent).toContain('demo-paper');
    expect(localStorage.getItem('sf-projects')).toContain(CURRENT_PROJECT_ID);
  });

  it('置顶临时记录可一键转正式保存（同名入库并移除临时记录）', () => {
    click(btn('转正式保存'));

    const projects = useProjectsStore.getState().projects;
    expect(projects.some((p) => p.id === CURRENT_PROJECT_ID)).toBe(false);
    expect(formalNames()).toEqual(['demo-paper']);
    expect(container!.querySelector('.sf-projects-row.current')).toBeNull();
  });

  it('保存当前项目：输入框默认当前项目名；保存入库；同名再保存覆盖；空名回退 projectName', () => {
    const input = container!.querySelector<HTMLInputElement>('.sf-projects-save-input')!;
    expect(input.value).toBe('demo-paper');

    type(input, '论文A');
    click(btn('保存'));
    expect(formalNames()).toEqual(['论文A']);
    const rec = useProjectsStore
      .getState()
      .projects.find((p) => p.id !== CURRENT_PROJECT_ID && p.name === '论文A')!;
    expect(rec.snapshot.files['main.tex']).toContain('\\begin{document}');

    // 同名覆盖：修改内容后再保存，不新增条数
    useWorkspaceStore.getState().updateFile('main.tex', '更新后的内容');
    click(btn('保存'));
    expect(formalNames()).toEqual(['论文A']);
    expect(
      useProjectsStore.getState().projects.find((p) => p.name === '论文A')!.snapshot.files['main.tex'],
    ).toBe('更新后的内容');

    // 清空输入 → 回退为当前 projectName
    type(input, '   ');
    click(btn('保存'));
    expect(formalNames()).toEqual(['demo-paper', '论文A']);
  });

  it('列表行展示名称、文件数与保存时间', () => {
    act(() => {
      useProjectsStore.getState().saveCurrent('论文A');
    });
    const row = rowOf('论文A');
    expect(row.textContent).toContain('论文A');
    expect(row.textContent).toContain('2 个文件');
    const rec = useProjectsStore.getState().projects.find((p) => p.name === '论文A')!;
    expect(row.textContent).toContain(new Date(rec.savedAt).toLocaleString());
  });

  it('打开：恢复 workspaceStore 文件与页签，并自动 onClose', () => {
    act(() => {
      useProjectsStore.getState().saveCurrent('论文A');
      useWorkspaceStore.getState().loadProject('other', 'other.tex', { 'other.tex': 'x' });
    });

    click(btn('打开', rowOf('论文A')));

    const s = useWorkspaceStore.getState();
    expect(s.projectName).toBe('demo-paper');
    expect(s.entry).toBe('main.tex');
    expect(s.openTabs).toEqual(['main.tex', 'refs.bib']);
    expect(s.activeTab).toBe('refs.bib');
    expect(s.files['main.tex']).toContain('\\begin{document}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('重命名：行内输入 Enter/确定后更新（含快照 projectName）；取消不改动', () => {
    act(() => {
      useProjectsStore.getState().saveCurrent('旧名');
    });

    click(btn('重命名', rowOf('旧名')));
    const input = container!.querySelector<HTMLInputElement>('.sf-projects-rename-input')!;
    expect(input.value).toBe('旧名');
    type(input, '新名');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    const rec = useProjectsStore.getState().projects.find((p) => p.name === '新名')!;
    expect(rec.snapshot.projectName).toBe('新名');
    expect(container!.querySelector('.sf-projects-rename-input')).toBeNull();

    click(btn('重命名', rowOf('新名')));
    click(btn('取消'));
    expect(useProjectsStore.getState().projects.find((p) => p.id === rec.id)!.name).toBe('新名');
  });

  it('复制：新增置顶「副本」记录，原件保留', () => {
    act(() => {
      useProjectsStore.getState().saveCurrent('A');
    });
    click(btn('复制', rowOf('A')));
    expect(formalNames()).toEqual(['A 副本', 'A']);
  });

  it('删除：应用内确认对话框确认后移除；取消则保留', async () => {
    act(() => {
      useProjectsStore.getState().saveCurrent('A');
    });

    // 打开确认对话框（confirm 模式，标题含项目名与不可撤销提示）
    click(btn('删除', rowOf('A')));
    const req = useUiStore.getState().textDialog;
    expect(req?.mode).toBe('confirm');
    expect(req?.title).toContain('A');

    // 取消（resolve null）：项目保留
    req!.resolve(null);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(formalNames()).toEqual(['A']);

    // 确认：项目移除
    click(btn('删除', rowOf('A')));
    await act(async () => {
      useUiStore.getState().textDialog!.resolve('');
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(formalNames()).toEqual([]);
    useUiStore.getState().closeTextDialog();
  });

  it('新建空白项目：载入最小可编译模板并 onClose', () => {
    click(btn('新建空白项目'));
    const s = useWorkspaceStore.getState();
    expect(s.projectName).toBe('未命名项目');
    expect(s.entry).toBe('main.tex');
    expect(Object.keys(s.files)).toEqual(['main.tex']);
    expect(s.files['main.tex']).toContain('\\documentclass');
    expect(s.files['main.tex']).toContain('\\begin{document}');
    expect(s.activeTab).toBe('main.tex');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc 与遮罩点击关闭；en 语言跟随设置', () => {
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

    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    expect(container!.querySelector('.sf-dialog-header')!.textContent).toContain('Projects');
    expect(container!.querySelector('.sf-projects-row.current')!.textContent).toContain(
      'Current (unsaved snapshot)',
    );
  });
});
