// @vitest-environment jsdom
/**
 * OutlinePanel 组件测试（大纲 | 图表 双视图）。测试环境说明同 CommentsPanel.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；mock editorJump（jumpTo）。
 * 覆盖验收路径：
 *  - 既有大纲行为零回归：默认大纲视图渲染章节树（层级缩进、非入口文件徽标）、点击 jumpTo、
 *    无章节占位文案；
 *  - 顶部「大纲 | 图表」切换（默认大纲，状态记忆于组件内：来回切换视图保持）；
 *  - 图表视图：按 kind 分组小标题 + 计数徽标、条目 kind 图标字符 + caption 截断 60 字 +
 *    文件:行号、点击 jumpTo、无 floats 占位文案；
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

vi.mock('../editorJump', () => ({
  jumpTo: vi.fn(),
  stashPendingJump: vi.fn(),
  takePendingJump: vi.fn(() => null),
  setJumpHandler: vi.fn(),
  notifyCursor: vi.fn(),
  lastCursor: vi.fn(() => ({ file: '', line: 1, col: 1 })),
}));

import { OutlinePanel } from './OutlinePanel';
import { jumpTo } from '../editorJump';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore, type WorkspaceState } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function seedWorkspace(overrides: Partial<WorkspaceState> = {}) {
  useWorkspaceStore.setState({
    projectName: 'demo',
    entry: 'main.tex',
    files: {
      'main.tex': '\\section{引言}\n\\subsection{动机}\n正文\n',
      'sections/floats.tex':
        '\\begin{figure}\n\\caption{系统总览}\n\\label{fig:overview}\n\\end{figure}\n' +
        '\\begin{table}\n\\caption{主结果}\n\\end{table}\n' +
        '\\begin{equation}\n\\label{eq:loss}\n\\end{equation}\n' +
        '\\begin{algorithm}\n\\caption{训练流程}\n\\end{algorithm}\n',
    },
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    snapshots: {},
    ...overrides,
  });
}

function renderPanel() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<OutlinePanel />);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function tab(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('.sf-subtabs button')].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`tab not found: ${text}`);
  return found;
}

function outlineItems(): HTMLLIElement[] {
  return [...container!.querySelectorAll<HTMLLIElement>('ul.sf-outline > li.sf-outline-item')];
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  seedWorkspace();
  vi.mocked(jumpTo).mockClear();
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('OutlinePanel 大纲视图（既有行为零回归）', () => {
  it('默认渲染大纲：章节树、层级缩进与非入口文件徽标', () => {
    seedWorkspace({
      files: {
        'main.tex': '\\section{引言}\n正文\n\\input{sections/method}\n',
        'sections/method.tex': '\\section{方法}\n\\subsection{设置}\n内容\n',
        'refs.bib': '@misc{k, title={T}}',
      },
    });
    renderPanel();

    const items = outlineItems();
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('引言');
    expect(items[1]!.textContent).toContain('方法');
    expect(items[1]!.textContent).toContain('sections/method.tex'); // 非入口文件徽标
    // 层级缩进：section（level 3）32px，subsection（level 4）44px
    expect(items[1]!.style.paddingLeft).toBe('32px');
    expect(items[2]!.style.paddingLeft).toBe('44px');
    // 默认视图是大纲：图表视图不渲染
    expect(container!.querySelector('.sf-floats-group')).toBeNull();
  });

  it('大纲条目点击 jumpTo({file, line})', () => {
    renderPanel();
    const items = outlineItems();
    // 默认种子：main.tex 第 1 行 \section{引言}、第 2 行 \subsection{动机}
    click(items[1]!);
    expect(jumpTo).toHaveBeenCalledWith({ file: 'main.tex', line: 2 });
  });

  it('无章节时显示占位文案', () => {
    seedWorkspace({ files: { 'main.tex': '只有正文\n' } });
    renderPanel();
    expect(container!.querySelector('p.placeholder')!.textContent).toContain(
      '未发现章节（\\section / \\subsection）',
    );
  });
});

describe('OutlinePanel 双视图切换', () => {
  it('顶部「大纲 | 图表」切换按钮，默认大纲选中', () => {
    renderPanel();
    const [outlineBtn, floatsBtn] = [tab('大纲'), tab('图表')];
    expect(outlineBtn.getAttribute('aria-selected')).toBe('true');
    expect(floatsBtn.getAttribute('aria-selected')).toBe('false');

    click(floatsBtn);
    expect(outlineBtn.getAttribute('aria-selected')).toBe('false');
    expect(floatsBtn.getAttribute('aria-selected')).toBe('true');
    expect(container!.querySelector('.sf-floats-group')).toBeTruthy();

    // 状态记忆于组件内：切回大纲再切图表，图表数据仍在
    click(outlineBtn);
    expect(container!.querySelector('.sf-floats-group')).toBeNull();
    expect(outlineItems().length).toBeGreaterThan(0);
    click(floatsBtn);
    expect(container!.querySelectorAll('.sf-floats-group').length).toBe(4);
  });

  it('无 floats 时图表视图显示占位文案', () => {
    seedWorkspace({ files: { 'main.tex': '\\section{引言}\n正文\n' } });
    renderPanel();
    click(tab('图表'));
    expect(container!.querySelector('p.placeholder')!.textContent).toContain(
      '未发现图表（figure / table / equation / algorithm）',
    );
  });
});

describe('OutlinePanel 图表视图', () => {
  beforeEach(() => {
    renderPanel();
    click(tab('图表'));
  });

  it('按 kind 分组：小标题（图/表/式/算法）+ 计数徽标', () => {
    const groups = [...container!.querySelectorAll<HTMLElement>('.sf-floats-group')];
    expect(groups.map((g) => g.querySelector('strong')?.textContent)).toEqual([
      '图',
      '表',
      '式',
      '算法',
    ]);
    expect(groups.map((g) => g.querySelector('.sf-chip')?.textContent)).toEqual(['1', '1', '1', '1']);
  });

  it('条目显示 kind 图标字符 + caption + 文件:行号，点击 jumpTo', () => {
    const figureItem = container!.querySelector('.sf-floats-group li.sf-outline-item')!;
    expect(figureItem.textContent).toContain('系统总览');
    expect(figureItem.textContent).toContain('sections/floats.tex:1');
    expect(figureItem.querySelector('span')!.textContent).toBe('图');

    const eqItem = [...container!.querySelectorAll<HTMLElement>('.sf-floats-group')].find((g) =>
      g.querySelector('strong')?.textContent === '式',
    )!;
    const eqLi = eqItem.querySelector('li.sf-outline-item')!;
    // 无 caption 回退 label；equation 环境起始行是第 8 行
    expect(eqLi.textContent).toContain('eq:loss');
    expect(eqLi.textContent).toContain('sections/floats.tex:8');

    click(eqLi);
    expect(jumpTo).toHaveBeenCalledWith({ file: 'sections/floats.tex', line: 8 });
  });

  it('caption 截断到 60 字（超出部分以省略号结尾）', () => {
    seedWorkspace({
      files: {
        'main.tex': `\\begin{figure}\n\\caption{${'很长的题注'.repeat(20)}}\n\\end{figure}\n`,
      },
    });
    renderPanel();
    click(tab('图表'));
    const li = container!.querySelector('li.sf-outline-item')!;
    const title = li.querySelector('.sf-outline-title')!.textContent!;
    expect(title).toHaveLength(61);
    expect(title.endsWith('…')).toBe(true);
  });

  it('文件内多浮动体按行号排列、计数徽标累计', () => {
    seedWorkspace({
      files: {
        'main.tex':
          '\\begin{table}\n\\end{table}\n\\begin{table}\n\\caption{T2}\n\\end{table}\n\\begin{figure}\n\\end{figure}\n',
      },
    });
    renderPanel();
    click(tab('图表'));
    const groups = [...container!.querySelectorAll<HTMLElement>('.sf-floats-group')];
    expect(groups.map((g) => g.querySelector('strong')?.textContent)).toEqual(['图', '表']);
    expect(groups.map((g) => g.querySelector('.sf-chip')?.textContent)).toEqual(['1', '2']);
    const tableLis = [...groups[1]!.querySelectorAll('li.sf-outline-item')];
    expect(
      tableLis.map((li) => li.querySelector('.sf-outline-file')!.textContent),
    ).toEqual(['main.tex:1', 'main.tex:3']);
    expect(tableLis[0]!.textContent).toContain('（无题注）');
    expect(tableLis[1]!.textContent).toContain('T2');
  });
});

describe('OutlinePanel zh/en 字典', () => {
  it('en 语言：切换按钮、分组标题与占位文案为英文', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    seedWorkspace({ files: { 'main.tex': 'no sections\n' } });
    renderPanel();

    expect(tab('Outline')).toBeTruthy();
    expect(tab('Floats')).toBeTruthy();
    click(tab('Floats'));
    expect(container!.querySelector('p.placeholder')!.textContent).toContain(
      'No floats found (figure / table / equation / algorithm)',
    );
  });
});
