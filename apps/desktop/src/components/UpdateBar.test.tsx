// @vitest-environment jsdom
/**
 * UpdateBar 组件测试（自动更新横幅）。测试环境说明同 BackupDialog.test.tsx：
 * mock zustand 为仅依赖本包 react@18 的等价实现（i18n→settingsStore 需要），
 * '../state/updateStore' mock 为外部存储 + 选择器 hook（actions 为 spy）。
 * 覆盖验收路径：
 *  - 不渲染：unsupported（浏览器形态）/ idle / checking / up-to-date / dismissed；
 *  - available/downloading：灰色信息条含版本号与下载进度（有百分比/不定态），
 *    无任何关闭或行动按钮；
 *  - downloaded：主行动条「✓ 已就绪 — 重启即可完成」+【立即重启】/【稍后】按钮回调；
 *  - error：仅 silent=false（手动检查失败）显示错误文案与【稍后】；静默失败不显示；
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

vi.mock('../state/updateStore', async () => {
  const { useSyncExternalStore } = await import('react');
  interface MockUpdateState {
    phase: string;
    currentVersion?: string;
    newVersion?: string;
    progress?: number;
    error?: string;
    silent: boolean;
    dismissed: boolean;
    applyAndRestart(): Promise<void>;
    dismiss(): void;
  }
  const listeners = new Set<() => void>();
  let state: MockUpdateState = {
    phase: 'idle',
    currentVersion: undefined,
    newVersion: undefined,
    progress: undefined,
    error: undefined,
    silent: true,
    dismissed: false,
    applyAndRestart: () => Promise.resolve(),
    dismiss: () => undefined,
  };
  const setState = (patch: Partial<MockUpdateState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  const getState = () => state;
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  };
  const useUpdateStore = <T,>(select: (s: MockUpdateState) => T): T =>
    useSyncExternalStore(
      subscribe,
      () => select(state),
      () => select(state),
    );
  return { useUpdateStore: Object.assign(useUpdateStore, { setState, getState, subscribe }) };
});

import { UpdateBar } from './UpdateBar';
import { useUpdateStore } from '../state/updateStore';
import { useSettingsStore } from '../state/settingsStore';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let applyAndRestart: ReturnType<typeof vi.fn>;
let dismiss: ReturnType<typeof vi.fn>;

function render(): HTMLElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<UpdateBar />);
  });
  return container;
}

interface UpdatePatch {
  phase?: string;
  newVersion?: string;
  progress?: number;
  error?: string;
  silent?: boolean;
  dismissed?: boolean;
}

function setPhase(patch: UpdatePatch): void {
  act(() => {
    // mock 的 setState 收 Partial；绕开真实模块的 zustand 类型（覆盖重载推断）
    (useUpdateStore.setState as (partial: UpdatePatch) => void)(patch);
  });
}

beforeEach(() => {
  localStorage.clear();
  useSettingsStore.setState({ language: 'zh' });
  applyAndRestart = vi.fn(async () => undefined);
  dismiss = vi.fn();
  useUpdateStore.setState({
    phase: 'idle',
    currentVersion: '0.9.0',
    newVersion: undefined,
    progress: undefined,
    error: undefined,
    silent: true,
    dismissed: false,
    applyAndRestart: async () => applyAndRestart(),
    dismiss: () => dismiss(),
  });
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
});

describe('UpdateBar · 不渲染的形态', () => {
  it('unsupported（浏览器形态）完全不渲染', () => {
    setPhase({ phase: 'unsupported' });
    expect(render().innerHTML).toBe('');
  });

  it('idle / checking / up-to-date 不渲染（不打扰）', () => {
    setPhase({ phase: 'idle' });
    expect(render().innerHTML).toBe('');
    setPhase({ phase: 'checking' });
    expect(container!.innerHTML).toBe('');
    setPhase({ phase: 'up-to-date' });
    expect(container!.innerHTML).toBe('');
  });

  it('downloaded 但已 dismissed（点了稍后）→ 本会话隐藏', () => {
    setPhase({ phase: 'downloaded', newVersion: '1.2.3', dismissed: true });
    expect(render().innerHTML).toBe('');
  });
});

describe('UpdateBar · 信息条（available / downloading）', () => {
  it('available：显示「发现新版本 vX.Y.Z」与后台下载文案，无任何按钮（不可关闭）', () => {
    setPhase({ phase: 'available', newVersion: '1.2.3', progress: undefined });
    const el = render();
    expect(el.textContent).toContain('发现新版本 v1.2.3');
    expect(el.textContent).toContain('正在后台下载…');
    expect(el.querySelector('button')).toBeNull();
  });

  it('downloading：显示进度百分比（42%）', () => {
    setPhase({ phase: 'downloading', newVersion: '1.2.3', progress: 42 });
    expect(render().textContent).toContain('42%');
  });

  it('downloading 总长未知（progress undefined）：不定态文案，不出现百分比', () => {
    setPhase({ phase: 'downloading', newVersion: '1.2.3', progress: undefined });
    const text = render().textContent ?? '';
    expect(text).toContain('正在后台下载…');
    expect(text).not.toContain('%');
  });
});

describe('UpdateBar · 主行动条（downloaded）', () => {
  it('显示「✓ 已就绪 — 重启即可完成」+【立即重启】【稍后】', () => {
    setPhase({ phase: 'downloaded', newVersion: '1.2.3', progress: 100 });
    const text = render().textContent ?? '';
    expect(text).toContain('✓ 新版本 v1.2.3 已就绪');
    expect(text).toContain('重启即可完成更新');
    expect(text).toContain('立即重启');
    expect(text).toContain('稍后');
  });

  it('点击【立即重启】→ 调 applyAndRestart（install+relaunch 由 store 负责）', async () => {
    setPhase({ phase: 'downloaded', newVersion: '1.2.3' });
    const el = render();
    await act(async () => {
      el.querySelector<HTMLButtonElement>('button')!.click();
      await Promise.resolve();
    });
    expect(applyAndRestart).toHaveBeenCalledTimes(1);
  });

  it('点击【稍后】→ 调 dismiss', () => {
    setPhase({ phase: 'downloaded', newVersion: '1.2.3' });
    const el = render();
    const later = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('稍后'),
    )!;
    act(() => {
      later.click();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateBar · 错误条（仅手动检查失败显示）', () => {
  it('静默检查失败（silent=true）不显示', () => {
    setPhase({ phase: 'error', error: '检查更新失败：boom', silent: true });
    expect(render().innerHTML).toBe('');
  });

  it('手动检查失败（silent=false）显示中文错误与【稍后】；点稍后调 dismiss', () => {
    setPhase({ phase: 'error', error: '网络请求失败，请检查网络后重试', silent: false });
    const el = render();
    expect(el.textContent).toContain('网络请求失败');
    const later = Array.from(el.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
      b.textContent?.includes('稍后'),
    )!;
    act(() => {
      later.click();
    });
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateBar · i18n', () => {
  it('en 字典：downloaded 行动条与按钮文案随语言切换', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    setPhase({ phase: 'downloaded', newVersion: '1.2.3' });
    const text = render().textContent ?? '';
    expect(text).toContain('v1.2.3 is ready');
    expect(text).toContain('Restart now');
    expect(text).toContain('Later');
  });

  it('en 字典：downloading 进度文案', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    setPhase({ phase: 'downloading', newVersion: '1.2.3', progress: 7 });
    const text = render().textContent ?? '';
    expect(text).toContain('New version v1.2.3');
    expect(text).toContain('Downloading in background… (7%)');
  });
});
