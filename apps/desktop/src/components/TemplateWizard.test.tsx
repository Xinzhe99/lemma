// @vitest-environment jsdom
/**
 * TemplateWizard 组件测试（自定义模板集成）。测试环境说明同 CommentsPanel.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；templatesStore 以可控的 mock store 替代
 * （验证「保存当前项目为模板」对 saveFromWorkspace 的调用）；@lemma/compile 部分 mock
 * （scaffoldProject 挂 spy，验证自定义模板路径不走脚手架）。
 * 覆盖验收路径：
 *  - 自定义模板区渲染（name/描述/文件数/savedAt、置于列表顶部、无模板时不渲染）；
 *  - 选中自定义模板 → 创建直接以其 entry+files 调 loadProject（scaffoldProject 不调用）；
 *  - 与内置模板选中互斥（切回内置走 scaffoldProject）；
 *  - 保存折叠区：默认折叠、展开输入 name/description → saveFromWorkspace 调用、
 *    成功/失败 inline 提示（空名不调 store）；
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

/** 可控的 templatesStore mock（组件内 useTemplatesStore 的数据源） */
const tplStore = vi.hoisted(() => ({
  templates: [] as {
    id: string;
    name: string;
    description: string;
    entry: string;
    files: Record<string, string>;
    savedAt: number;
  }[],
  saveFromWorkspace: vi.fn((): boolean => true),
}));

vi.mock('../state/templatesStore', () => ({
  useTemplatesStore: (selector: (s: typeof tplStore) => unknown) => selector(tplStore),
}));

vi.mock('@lemma/compile', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@lemma/compile')>();
  return { ...mod, scaffoldProject: vi.fn(mod.scaffoldProject) };
});

import { listTemplates, scaffoldProject } from '@lemma/compile';
import { TemplateWizard } from './TemplateWizard';
import { useSettingsStore } from '../state/settingsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore, type WorkspaceState } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onDone: ReturnType<typeof vi.fn>;

const USER_TPL = {
  id: 'user-1',
  name: '我的会议模板',
  description: '投 AAAI 用的双栏起步',
  entry: 'paper.tex',
  files: { 'paper.tex': '\\documentclass{article}\n', 'refs.bib': '@misc{k,t={T}}' },
  savedAt: new Date('2026-01-15T08:00:00Z').getTime(),
};

function seedWorkspace(overrides: Partial<WorkspaceState> = {}) {
  useWorkspaceStore.setState({
    projectName: '当前项目',
    entry: 'main.tex',
    files: {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nhi\n\\end{document}\n',
      'refs.bib': '@misc{key, title={T}}',
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    ...overrides,
  });
}

function renderWizard() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TemplateWizard onDone={onDone} />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function btn(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
    b.textContent?.includes(text),
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

/** 自定义模板区的条目（第一个 sf-wiz-list 位于 sf-wiz-user 内） */
function userItems(): HTMLLIElement[] {
  const scope = container!.querySelector('.sf-wiz-user');
  return scope ? [...scope.querySelectorAll<HTMLLIElement>('li.sf-wiz-item')] : [];
}

function builtinItems(): HTMLLIElement[] {
  // 内置列表是 sf-wiz-user 之外的 sf-wiz-list
  const lists = [...container!.querySelectorAll('ul.sf-wiz-list')];
  const builtinList = lists.find((ul) => !ul.closest('.sf-wiz-user'));
  return builtinList ? [...builtinList.querySelectorAll<HTMLLIElement>('li.sf-wiz-item')] : [];
}

beforeEach(() => {
  localStorage.clear();
  tplStore.templates = [];
  tplStore.saveFromWorkspace.mockReset();
  tplStore.saveFromWorkspace.mockReturnValue(true);
  vi.mocked(scaffoldProject).mockClear();
  useSettingsStore.setState({ language: 'zh' });
  useUiStore.setState({ templateWizardOpen: true, sidebarTab: 'outline' });
  seedWorkspace();
  onDone = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('TemplateWizard 自定义模板区渲染', () => {
  it('无自定义模板时不渲染该区，内置列表照常', () => {
    renderWizard();
    expect(container!.querySelector('.sf-wiz-user')).toBeNull();
    expect(builtinItems().length).toBe(listTemplates().length);
  });

  it('有自定义模板时置于列表顶部：显示 name / 描述 / 文件数 / savedAt', () => {
    tplStore.templates = [USER_TPL];
    renderWizard();

    const user = container!.querySelector('.sf-wiz-user')!;
    expect(user).toBeTruthy();
    // 顶部：sf-wiz-user 在 DOM 中先于内置列表
    const firstList = container!.querySelector('ul.sf-wiz-list')!;
    expect(firstList.closest('.sf-wiz-user')).toBeTruthy();

    const item = userItems()[0]!;
    expect(item.textContent).toContain('我的会议模板');
    expect(item.textContent).toContain('投 AAAI 用的双栏起步');
    expect(item.textContent).toContain('2 个文件');
    expect(item.textContent).toContain(new Date(USER_TPL.savedAt).toLocaleDateString());
  });

  it('描述为空时显示（无描述）占位', () => {
    tplStore.templates = [{ ...USER_TPL, description: '' }];
    renderWizard();
    expect(userItems()[0]!.textContent).toContain('（无描述）');
  });
});

describe('TemplateWizard 选中自定义模板加载', () => {
  it('选中后创建：直接以 entry+files 调 loadProject，不走 scaffoldProject', () => {
    tplStore.templates = [USER_TPL];
    renderWizard();

    click(userItems()[0]!);
    expect(userItems()[0]!.className).toContain('active');

    click(btn('创建项目'));
    const ws = useWorkspaceStore.getState();
    expect(ws.entry).toBe('paper.tex');
    expect(ws.files['paper.tex']).toBe(USER_TPL.files['paper.tex']);
    expect(ws.files['refs.bib']).toBe(USER_TPL.files['refs.bib']);
    // 项目名回退：标题输入框默认「未命名论文」
    expect(ws.projectName).toBe('未命名论文');
    expect(scaffoldProject).not.toHaveBeenCalled();
    // 对话框关闭、切到文件页签、成功消息
    expect(useUiStore.getState().templateWizardOpen).toBe(false);
    expect(useUiStore.getState().sidebarTab).toBe('files');
    expect(onDone).toHaveBeenCalledWith('已按模板「我的会议模板」创建项目');
  });

  it('与内置模板互斥：切回内置后创建走 scaffoldProject', () => {
    tplStore.templates = [USER_TPL];
    renderWizard();

    click(userItems()[0]!);
    click(builtinItems()[0]!);
    expect(userItems()[0]!.className).not.toContain('active');
    expect(builtinItems()[0]!.className).toContain('active');

    click(btn('创建项目'));
    expect(scaffoldProject).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().files['README.md']).toBeTruthy(); // 脚手架产出
  });

  it('再次点击已选中的自定义模板取消选中，创建按钮禁用', () => {
    tplStore.templates = [USER_TPL];
    renderWizard();
    click(userItems()[0]!);
    click(userItems()[0]!); // 取消
    const create = [...container!.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent === '创建项目',
    )!;
    expect(create.disabled).toBe(true);
  });
});

describe('TemplateWizard 保存当前项目为模板', () => {
  it('默认折叠；展开后输入 name/description → saveFromWorkspace 调用 + 成功提示', () => {
    renderWizard();
    expect(container!.querySelector('.sf-wiz-save input')).toBeNull();

    click(btn('保存当前项目为模板'));
    const inputs = [...container!.querySelectorAll<HTMLInputElement>('.sf-wiz-save input')];
    expect(inputs).toHaveLength(2);

    typeInto(inputs[0]!, '模板X');
    typeInto(inputs[1]!, '复用描述');
    click(btn('保存模板'));

    expect(tplStore.saveFromWorkspace).toHaveBeenCalledTimes(1);
    expect(tplStore.saveFromWorkspace).toHaveBeenCalledWith('模板X', '复用描述');
    const msg = container!.querySelector('.sf-wiz-save p.placeholder')!;
    expect(msg.textContent).toContain('已保存模板「模板X」');
  });

  it('空名不调 store，提示输入模板名', () => {
    renderWizard();
    click(btn('保存当前项目为模板'));
    click(btn('保存模板'));

    expect(tplStore.saveFromWorkspace).not.toHaveBeenCalled();
    expect(container!.querySelector('.sf-wiz-save p.placeholder')!.textContent).toContain(
      '请输入模板名',
    );
  });

  it('store 返回 false 时按文件数显示失败原因', () => {
    seedWorkspace(); // 2 个文件（非空）→ 超限文案
    tplStore.saveFromWorkspace.mockReturnValue(false);
    renderWizard();
    click(btn('保存当前项目为模板'));
    const [nameInput] = [...container!.querySelectorAll<HTMLInputElement>('.sf-wiz-save input')];
    typeInto(nameInput!, '失败模板');
    click(btn('保存模板'));

    expect(tplStore.saveFromWorkspace).toHaveBeenCalledWith('失败模板', '');
    const msg = container!.querySelector('.sf-wiz-save p.placeholder')!;
    expect(msg.textContent).toContain('文件数超过 50 上限');
  });

  it('空工作区保存失败时提示「当前项目没有文件」', () => {
    seedWorkspace({ entry: '', files: {} });
    tplStore.saveFromWorkspace.mockReturnValue(false);
    renderWizard();
    click(btn('保存当前项目为模板'));
    const [nameInput] = [...container!.querySelectorAll<HTMLInputElement>('.sf-wiz-save input')];
    typeInto(nameInput!, '失败模板');
    click(btn('保存模板'));
    expect(container!.querySelector('.sf-wiz-save p.placeholder')!.textContent).toContain(
      '当前项目没有文件',
    );
  });
});

describe('TemplateWizard Esc 关闭', () => {
  it('Esc 关闭向导（对齐其他对话框的统一交互）', () => {
    act(() => {
      useUiStore.setState({ templateWizardOpen: true });
    });
    seedWorkspace();
    renderWizard();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    });
    expect(useUiStore.getState().templateWizardOpen).toBe(false);
  });
});

describe('TemplateWizard zh/en 字典', () => {
  it('en 语言：自定义模板区与保存折叠区文案为英文', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    tplStore.templates = [USER_TPL];
    renderWizard();

    expect(container!.querySelector('.sf-wiz-user strong')!.textContent).toBe('Custom templates');
    expect(userItems()[0]!.textContent).toContain('2 files');
    expect(userItems()[0]!.textContent).toContain('投 AAAI 用的双栏起步'); // 描述照常显示

    click(btn('Save current project as template'));
    expect(container!.querySelectorAll('.sf-wiz-save input').length).toBe(2);
    const [nameInput, descInput] = [
      ...container!.querySelectorAll<HTMLInputElement>('.sf-wiz-save input'),
    ];
    typeInto(nameInput!, 'MyTpl');
    typeInto(descInput!, 'desc');
    click(btn('Save template'));
    expect(container!.querySelector('.sf-wiz-save p.placeholder')!.textContent).toContain(
      'Template "MyTpl" saved',
    );
  });
});
