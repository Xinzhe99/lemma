// @vitest-environment jsdom
/**
 * NewProjectDialog（新建项目：名称 + 本地文件夹）测试。测试环境说明同 GettingStarted.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现；platform/tauri 桥与 platform/types 打桩
 * （kind 可切换 tauri / browser）。覆盖验收路径：
 *  - 名称必填：空名创建按钮禁用；
 *  - 浏览器形态：无「选择…」按钮，文件夹输入框给浏览器形态提示；创建不入 dir；
 *  - Tauri 形态：「选择…」经 tauriPickDirectory 选目录 → 写探针验证可写 → 创建时物化
 *    main.tex 到所选目录，记录持久化 dir，轻提示，onClose；
 *  - Tauri 形态：目录不可写（探针失败）→ 错误提示且创建按钮禁用；
 *  - 创建后建首个 Agent 会话（沿用 SessionsPanel 既有行为）。
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

const platformKind = vi.hoisted(() => ({ kind: 'browser' as 'tauri' | 'browser' }));
const bridges = vi.hoisted(() => ({
  pick: vi.fn(async (_title: string) => null as string | null),
  write: vi.fn(async (_dir: string, _rel: string, _content: string) => {}),
  del: vi.fn(async (_dir: string, _rel: string) => {}),
}));

vi.mock('../platform/tauri', () => ({
  tauriPickDirectory: bridges.pick,
  tauriWriteProjectFile: bridges.write,
  tauriReadProjectFile: vi.fn(),
  tauriDeleteProjectFile: bridges.del,
  tauriScanProjectDir: vi.fn(),
  tauriProcRun: vi.fn(),
  tauriReadBase64: vi.fn(),
  tauriWriteFileBase64: vi.fn(),
  base64ToBytes: vi.fn(),
  createTauriPlatform: () => null,
}));

vi.mock('../platform/types', () => ({
  getPlatform: () =>
    platformKind.kind === 'tauri'
      ? { kind: 'tauri' as const, fs: {}, secrets: { get: async () => undefined, set: async () => {} } }
      : {
          kind: 'browser' as const,
          fs: { readFile: async () => '', writeFile: async () => {}, deleteFile: async () => {}, list: async () => [] },
          secrets: { get: async () => undefined, set: async () => {} },
        },
}));

vi.mock('lucide-react', () => {
  const shim = (_props: { size?: number }) => null;
  return { FolderOpen: shim };
});

import { NewProjectDialog } from './NewProjectDialog';
import { useAgentHubStore } from '@lemma/agent-hub';
import { PROJECTS_STORAGE_KEY, useProjectsStore } from '../state/projectsStore';
import { useUiStore } from '../state/uiStore';
import { useWorkspaceStore } from '../state/workspaceStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: ReturnType<typeof vi.fn>;

async function renderDialog() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<NewProjectDialog onClose={onClose} />);
  });
}

function input(testid: string): HTMLInputElement {
  const el = container?.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`) ?? null;
  expect(el, `缺少输入框: ${testid}`).toBeTruthy();
  return el!;
}

function createBtn(): HTMLButtonElement {
  const el = container?.querySelector<HTMLButtonElement>('[data-testid="np-create"]') ?? null;
  expect(el, '缺少创建按钮').toBeTruthy();
  return el!;
}

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function clickAsync(el: HTMLElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

beforeEach(() => {
  platformKind.kind = 'browser';
  bridges.pick.mockClear();
  bridges.write.mockClear();
  bridges.del.mockClear();
  bridges.pick.mockResolvedValue(null);
  onClose = vi.fn();
  localStorage.clear();
  useProjectsStore.setState({ projects: [] });
  useWorkspaceStore.setState({
    projectName: '',
    entry: '',
    files: {},
    openTabs: [],
    activeTab: null,
    snapshots: {},
    projectDir: null,
  });
  useUiStore.setState({ toast: null, newProjectDialogOpen: true });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('NewProjectDialog（浏览器形态）', () => {
  it('名称必填：空名时创建禁用；输入后创建载入模板项目并存记录；建首个会话', async () => {
    await renderDialog();

    expect(createBtn().disabled).toBe(true);
    typeInto(input('np-name'), '我的论文');
    expect(createBtn().disabled).toBe(false);

    await clickAsync(createBtn());

    const ws = useWorkspaceStore.getState();
    expect(ws.projectName).toBe('我的论文');
    expect(ws.entry).toBe('main.tex');
    expect(ws.files['main.tex']).toContain('\\begin{document}');
    expect(ws.projectDir).toBeNull();

    const rec = useProjectsStore.getState().projects.find((p) => p.name === '我的论文');
    expect(rec).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(PROJECTS_STORAGE_KEY)!)).toHaveLength(1);

    const session = useAgentHubStore.getState().sessions.find((s) => s.projectName === '我的论文');
    expect(session).toBeTruthy();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().toast).toContain('我的论文');
  });

  it('无「选择…」按钮；文件夹输入框提示浏览器形态限制', async () => {
    await renderDialog();
    expect(container!.querySelector('[data-testid="np-browse"]')).toBeNull();
    expect(input('np-dir').placeholder).toContain('浏览器');
  });
});

describe('NewProjectDialog（桌面形态）', () => {
  beforeEach(() => {
    platformKind.kind = 'tauri';
  });

  it('「选择…」经原生选择器选目录并探针验证；创建物化文件到该目录并持久化 dir', async () => {
    await renderDialog();
    bridges.pick.mockResolvedValue('D:\\papers\\new');

    await clickAsync(container!.querySelector<HTMLButtonElement>('[data-testid="np-browse"]')!);
    expect(input('np-dir').value).toBe('D:\\papers\\new');
    expect(bridges.write).toHaveBeenCalledWith('D:\\papers\\new', '.lemma-write-probe.tmp', 'probe');
    await act(async () => {
      await Promise.resolve();
    });

    typeInto(input('np-name'), '本地论文');
    await clickAsync(createBtn());

    const ws = useWorkspaceStore.getState();
    expect(ws.projectName).toBe('本地论文');
    expect(ws.projectDir).toBe('D:\\papers\\new');
    expect(bridges.write).toHaveBeenCalledWith('D:\\papers\\new', 'main.tex', expect.stringContaining('\\begin{document}'));

    const rec = useProjectsStore.getState().projects.find((p) => p.name === '本地论文');
    expect(rec?.dir).toBe('D:\\papers\\new');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('目录不可写（探针失败）：错误提示且创建按钮禁用；选择器取消不清空已输路径', async () => {
    bridges.write.mockRejectedValue(new Error('权限不足'));
    await renderDialog();

    // 选择器返回 null（用户取消）：保持无路径
    await clickAsync(container!.querySelector<HTMLButtonElement>('[data-testid="np-browse"]')!);
    expect(input('np-dir').value).toBe('');

    // 手输不可写路径 → 失焦触发探针 → bad（React onBlur 委托 focusout）
    typeInto(input('np-dir'), 'D:\\readonly');
    await act(async () => {
      input('np-dir').dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container!.textContent).toContain('权限不足');
    typeInto(input('np-name'), 'X');
    expect(createBtn().disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});
