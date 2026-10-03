// @vitest-environment jsdom
/**
 * 自动编译与 TeX 字数测试（v1.5.1 D2/D5）：
 * - attachAutoCompile：编辑（dirty）→ 防抖触发 {auto:true}；关开关/浏览器形态/编译中不触发；
 * - countTexWords：注释/命令骨架/数学剔除，可见文字才计。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./platform/types', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./platform/types')>();
  return { ...actual, getPlatform: vi.fn(actual.getPlatform) };
});

import { getPlatform } from './platform/types';

const tauriStub = {
  kind: 'tauri',
  fs: {
    readFile: async () => {
      throw new Error('not needed');
    },
    writeFile: async () => undefined,
    deleteFile: async () => undefined,
    list: async () => [] as string[],
  },
  secrets: { get: async () => undefined, set: async () => undefined },
} as unknown as ReturnType<typeof getPlatform>;
import { attachAutoCompile } from './compileAction';
import { useWorkspaceStore } from './state/workspaceStore';
import { useSettingsStore } from './state/settingsStore';
import { countTexWords } from './components/StatusBar';

const mockGetPlatform = vi.mocked(getPlatform);

function seed(files: Record<string, string>): void {
  useWorkspaceStore.setState({
    projectName: 'p',
    entry: 'main.tex',
    files,
    openTabs: ['main.tex'],
    activeTab: 'main.tex',
    compileLog: [],
    compileStatus: 'idle',
    dirty: false,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  localStorage.clear();
  mockGetPlatform.mockReturnValue(tauriStub);
  useSettingsStore.setState({ autoCompile: true, livePreview: false, providers: [], activeProviderId: null });
  seed({ 'main.tex': 'a\nb\n' });
  // attach 内部快照基线
  const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
  detach();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('attachAutoCompile（防抖与守卫）', () => {
  it('真实编辑（dirty）→ 1.5s 后以 {auto:true} 触发编译', async () => {
    const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
    try {
      useWorkspaceStore.getState().updateFile('main.tex', 'a\nb\nc\n');
      await vi.advanceTimersByTimeAsync(1600);
      expect(compileSpy).toHaveBeenCalledWith({ auto: true });
    } finally {
      detach();
    }
  });

  it('开关关闭 → 不触发', async () => {
    useSettingsStore.setState({ autoCompile: false });
    const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
    try {
      useWorkspaceStore.getState().updateFile('main.tex', 'changed\n');
      await vi.advanceTimersByTimeAsync(1600);
      expect(compileSpy).not.toHaveBeenCalled();
    } finally {
      detach();
    }
  });

  it('浏览器形态（非 tauri）→ 不触发', async () => {
    mockGetPlatform.mockReturnValue({ ...tauriStub, kind: 'browser' } as ReturnType<typeof getPlatform>);
    const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
    try {
      useWorkspaceStore.getState().updateFile('main.tex', 'changed\n');
      await vi.advanceTimersByTimeAsync(1600);
      expect(compileSpy).not.toHaveBeenCalled();
    } finally {
      detach();
    }
  });

  it('编译进行中 → 跳过本次（不排队轰炸）', async () => {
    useWorkspaceStore.setState({ compileStatus: 'running' });
    const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
    try {
      useWorkspaceStore.getState().updateFile('main.tex', 'changed\n');
      await vi.advanceTimersByTimeAsync(1600);
      expect(compileSpy).not.toHaveBeenCalled();
    } finally {
      detach();
    }
  });

  it('连续击键合并为一次（防抖窗口内）', async () => {
    const compileSpy = vi.fn();
  const detach = attachAutoCompile(compileSpy);
    try {
      useWorkspaceStore.getState().updateFile('main.tex', 'a1\n');
      await vi.advanceTimersByTimeAsync(800);
      useWorkspaceStore.getState().updateFile('main.tex', 'a2\n');
      await vi.advanceTimersByTimeAsync(800);
      expect(compileSpy).not.toHaveBeenCalled(); // 仍在第二键的窗口内
      await vi.advanceTimersByTimeAsync(1000);
      expect(compileSpy).toHaveBeenCalledTimes(1);
    } finally {
      detach();
    }
  });
});

describe('countTexWords（LaTeX 感知字数）', () => {
  it('剔除注释、结构命令、引用与数学；保留可见文字与 CJK', () => {
    const tex = [
      '\\documentclass[11pt]{article}',
      '% TODO: 这条注释不算字数 and english words',
      '\\begin{document}',
      'Hello \\textbf{world} 你好世界。',
      'See \\cite{vaswani2017attention} and \\ref{fig:1}.',
      '$E = mc^2$ 不计公式。',
      '\\end{document}',
    ].join('\n');
    const n = countTexWords(tex);
    expect(n).toBe(2 + 4 + 2 + 4); // Hello world(2) + 你好世界(4) + See and(2) + 不计公式(4)
  });

  it('\\% 转义不误删后续正文', () => {
    expect(countTexWords('100\\% accuracy rate')).toBe(3);
  });

  it('空串/纯命令为 0', () => {
    expect(countTexWords('')).toBe(0);
    expect(countTexWords('\\begin{itemize}\\item\\end{itemize}')).toBe(0);
  });
});

describe('runMockCompile 的诊断发布（浏览器闭环）', () => {
  it('源码含未闭合环境 → lint 结果作为诊断发布到 store 与编辑器注册表', async () => {
    vi.useRealTimers();
    mockGetPlatform.mockReturnValue({ ...tauriStub, kind: 'browser' } as ReturnType<typeof getPlatform>);
    seed({
      'main.tex': '\\documentclass{article}\n\\begin{document}\n\\begin{itemize}\n\\item x\n',
    });
    const { runCompile } = await import('./compileAction');
    const { setCompileDiagnosticsList } = await import('@scholarforge/editor');
    // 静态导入注册表读取（模块级单例）
    const editor = await import('@scholarforge/editor');
    const before = editor.getCompileDiagnosticsList().length;
    await runCompile();
    const store = useWorkspaceStore.getState().compileDiagnostics;
    expect(store.length).toBeGreaterThan(before);
    expect(store[0]).toMatchObject({ severity: 'error', file: 'main.tex' });
    expect(typeof store[0].line).toBe('number');
    expect(editor.getCompileDiagnosticsList()).toBe(store as never);
    setCompileDiagnosticsList([]); // 清理注册表
  });
});
