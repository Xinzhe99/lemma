// @vitest-environment jsdom
/**
 * 命令面板分区渲染测试（palette 分组重设计）：
 * 1) 空查询只出现精选组头与精选命令，页脚提示可搜索全部命令；
 * 2) 输入关键词命中跨组命令，按分组分区渲染；
 * 3) 键盘 ↑↓ 激活索引跨组连续，Enter 执行并关闭。
 * zustand mock 说明同 FileTree.test.tsx / QuickOpen.test.tsx。
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

import { CommandPalette, groupCommands, type Command } from './commandPalette';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

/** 造命令：run 默认为 spy，可经 extra 覆盖 */
function cmd(id: string, title: string, group: string, extra: Partial<Command> = {}): Command {
  return { id, title, group, run: vi.fn(), ...extra };
}

async function renderPalette(commands: Command[]) {
  await act(async () => {
    root!.render(<CommandPalette commands={commands} onClose={onClose} />);
  });
}

/** 受控输入的 React onChange 触发：原生 setter + 冒泡 input 事件 */
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function pressKey(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }));
  });
}

function heads(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.palette-group-head')];
}

function items(): HTMLElement[] {
  return [...container!.querySelectorAll<HTMLElement>('.palette-item')];
}

beforeEach(() => {
  onClose = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('CommandPalette 分组渲染', () => {
  it('空查询默认视图：只出现精选组头（规范顺序）与精选命令，页脚提示全部命令数', async () => {
    const commands = [
      cmd('app.update', '检查应用更新', 'palette.group.app'), // 非精选：默认视图不出现
      cmd('view.theme', '切换深色/浅色主题', 'palette.group.view', { featured: true }),
      cmd('ai.session', '新建 Agent 会话', 'palette.group.ai', { featured: true }),
      cmd('proj.file', '新建文件', 'palette.group.project', { featured: true }),
      cmd('ai.draft', 'AI 起草新章节', 'palette.group.ai'), // 非精选
    ];
    await renderPalette(commands);

    // 组头只含精选命令所在组，且按 PALETTE_GROUP_ORDER 规范顺序（project → ai → view）
    expect(heads().map((h) => h.textContent)).toEqual(['项目与文件', 'AI 助手', '视图与面板']);
    // 只列出 3 个精选命令
    expect(items().map((i) => i.textContent)).toEqual([
      '新建文件',
      '新建 Agent 会话',
      '切换深色/浅色主题',
    ]);
    // 页脚提示「搜索全部 N 个命令」，N 为命令总数
    const footer = container!.querySelector<HTMLElement>('.palette-footer')!;
    expect(footer.textContent).toBe('输入关键词，搜索全部 5 个命令');
  });

  it('输入关键词：命中跨组命令并分区渲染，页脚提示隐藏；无命中显示空态', async () => {
    const commands = [
      cmd('wf.polish', '运行工作流：学术润色', 'palette.group.view'),
      cmd('ai.polish', 'AI 润色当前文件', 'palette.group.ai', { featured: true }),
      cmd('edit.table', '插入表格', 'palette.group.edit'),
    ];
    await renderPalette(commands);
    const input = container!.querySelector<HTMLInputElement>('.palette-input')!;

    type(input, '润色');
    expect(heads().map((h) => h.textContent)).toEqual(['AI 助手', '视图与面板']); // 规范顺序，未命中组不出现
    expect(items().map((i) => i.textContent)).toEqual(['AI 润色当前文件', '运行工作流：学术润色']);
    expect(container!.querySelector('.palette-footer')).toBeNull(); // 搜索态不显示页脚

    type(input, '插入');
    expect(heads().map((h) => h.textContent)).toEqual(['编辑与插入']);
    expect(items()).toHaveLength(1);

    type(input, 'zzz-no-match');
    expect(container!.querySelector('.palette-empty')).toBeTruthy();
    expect(items()).toHaveLength(0);
  });

  it('键盘导航：激活索引跨组连续移动，Enter 执行并关闭', async () => {
    const r1 = vi.fn();
    const r2 = vi.fn();
    const r3 = vi.fn();
    const commands = [
      cmd('p.1', '新建文件', 'palette.group.project', { featured: true, run: r1 }),
      cmd('p.2', '保存当前文件', 'palette.group.project', { featured: true, run: r2 }),
      cmd('a.1', '新建 Agent 会话', 'palette.group.ai', { featured: true, run: r3 }),
      cmd('a.2', 'AI 润色当前文件', 'palette.group.ai', { featured: true }),
    ];
    await renderPalette(commands);

    expect(items()[0]!.classList.contains('active')).toBe(true);
    pressKey('ArrowDown');
    expect(items()[1]!.classList.contains('active')).toBe(true);
    pressKey('ArrowDown'); // 跨过 project → ai 组边界
    expect(items()[2]!.classList.contains('active')).toBe(true);
    expect(items()[2]!.textContent).toContain('新建 Agent 会话');
    pressKey('ArrowDown');
    expect(items()[3]!.classList.contains('active')).toBe(true);
    pressKey('ArrowDown'); // 已在末尾，不下越界
    expect(items()[3]!.classList.contains('active')).toBe(true);

    pressKey('ArrowUp');
    pressKey('ArrowUp');
    pressKey('ArrowUp');
    pressKey('ArrowUp'); // 已在顶部，不上越界
    expect(items()[0]!.classList.contains('active')).toBe(true);

    pressKey('ArrowDown');
    pressKey('ArrowDown');
    pressKey('Enter');
    expect(r3).toHaveBeenCalledTimes(1);
    expect(r1).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('groupCommands 分区', () => {
  it('已知分组按规范顺序；未知分组按首次出现顺序排在其后', () => {
    const groups = groupCommands([
      cmd('1', 'a', 'custom.z'),
      cmd('2', 'b', 'palette.group.app'),
      cmd('3', 'c', 'custom.a'),
      cmd('4', 'd', 'palette.group.ai'),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['palette.group.ai', 'palette.group.app', 'custom.z', 'custom.a']);
    expect(groups[0]!.items.map((c) => c.id)).toEqual(['4']);
  });

  it('缺 group 的命令归入未分组（不渲染组头由渲染层处理）', () => {
    const groups = groupCommands([cmd('1', 'a', 'palette.group.view'), { id: '2', title: 'b' }]);
    expect(groups.map((g) => g.key)).toEqual(['palette.group.view', '']);
    expect(groups[1]!.items.map((c) => c.id)).toEqual(['2']);
  });
});
