// @vitest-environment jsdom
/**
 * 测试环境说明同 FileTree.test.tsx：mock zustand 为仅依赖本包 react@18 的等价实现
 * （语义与真实 zustand 一致），避免根 react@19 与 apps/desktop react@18 混渲染。
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

import { StatusBar, countTexWords, countWords, relativeTime } from './StatusBar';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useUiStore } from '../state/uiStore';
import { useSubmitStore } from '../state/submitStore';
import { useSettingsStore } from '../state/settingsStore';
import { todayKey, useWritingStatsStore } from '../state/writingStats';
import { hasSynctexIndex, jumpSourceToPdf, onPdfGoto, setSynctexIndex } from '../synctexBridge';
import type { SynctexIndex } from '@scholarforge/compile';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderView(cursor: { line: number; col: number } = { line: 3, col: 7 }) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<StatusBar cursor={cursor} />);
  });
}

beforeEach(() => {
  useWorkspaceStore.getState().loadDemoProject();
  useWorkspaceStore.setState({ dirty: false, lastSavedAt: null });
  useSubmitStore.setState({ venueId: null });
});

afterEach(() => {
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('countWords（混合字数统计纯函数）', () => {
  it('空串与纯标点为 0', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('  ! ? , . ; ')).toBe(0);
    expect(countWords('\\section{}\\cite{x}')).toBe(3); // section / cite / x
  });

  it('纯中文每字计 1，纯英文连续词计 1', () => {
    expect(countWords('你好，世界')).toBe(4);
    expect(countWords('hello world')).toBe(2);
    expect(countWords('state-of-the-art')).toBe(1);
    expect(countWords("don't stop")).toBe(2);
  });

  it('中英混合：CJK 每字 + 拉丁词各计 1', () => {
    expect(countWords('Hello 世界 world 2026')).toBe(5);
    expect(countWords('大语言模型（LLM）重塑 research workflow')).toBe(10); // 7 CJK + 3 拉丁词
  });
});

describe('relativeTime（相对时间纯函数）', () => {
  const NOW = 1_000_000_000_000;

  it('中文相对时间分档', () => {
    expect(relativeTime(NOW - 2_000, NOW)).toBe('刚刚');
    expect(relativeTime(NOW + 60_000, NOW)).toBe('刚刚'); // 未来时间按刚刚处理
    expect(relativeTime(NOW - 30_000, NOW)).toBe('30 秒前');
    expect(relativeTime(NOW - 5 * 60_000, NOW)).toBe('5 分钟前');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3 小时前');
    expect(relativeTime(NOW - 2 * 86_400_000, NOW)).toBe('2 天前');
  });

  it('英文相对时间分档', () => {
    expect(relativeTime(NOW - 2_000, NOW, 'en')).toBe('just now');
    expect(relativeTime(NOW - 30_000, NOW, 'en')).toBe('30 seconds ago');
    expect(relativeTime(NOW - 60_000, NOW, 'en')).toBe('1 minute ago');
    expect(relativeTime(NOW - 5 * 60_000, NOW, 'en')).toBe('5 minutes ago');
  });
});

describe('StatusBar 渲染', () => {
  it('渲染文件名、字数、行数、光标行列与已保存态', () => {
    const content = useWorkspaceStore.getState().files['main.tex']!;
    renderView();
    const text = container!.textContent ?? '';
    expect(text).toContain('main.tex');
    expect(text).toContain(`字数 ${countTexWords(content)}`);
    expect(text).toContain(`行数 ${content.split('\n').length}`);
    expect(text).toContain('行 3, 7');
    expect(text).toContain('✓ 已保存');
    expect(text).not.toContain('●');
  });

  it('dirty 时显示 ● 未保存；保存后显示 ✓ 已保存 + 相对时间', () => {
    renderView();
    act(() => {
      useWorkspaceStore.getState().updateFile('main.tex', '状态栏渲染测试');
    });
    let text = container!.textContent ?? '';
    expect(text).toContain('●');
    expect(text).toContain('未保存');
    expect(text).toContain(`字数 ${countWords('状态栏渲染测试')}`);

    act(() => {
      useWorkspaceStore.setState({ dirty: false, lastSavedAt: Date.now() - 30_000 });
    });
    text = container!.textContent ?? '';
    expect(text).toContain('✓ 已保存');
    expect(text).toContain('30 秒前');
  });

  it('无活动文件时显示占位且行数为 1', () => {
    useWorkspaceStore.setState({ activeTab: null });
    renderView();
    const text = container!.textContent ?? '';
    expect(text).toContain('未打开文件');
    expect(text).toContain('行数 1');
  });
});

describe('StatusBar 目标进度 chip（写作统计）', () => {
  /** 状态栏渲染测试基线：chip 显式重置为当日 0/500，避免受自动统计订阅影响 */
  function resetStats() {
    useWritingStatsStore.setState({
      today: todayKey(),
      dailyGoal: 500,
      wordsToday: 0,
      history: {},
      streakDays: 0,
    });
  }

  it('字数旁显示 wordsToday/goal；达标后显示 ✓ wordsToday，title 提示命令面板可改目标', () => {
    resetStats();
    renderView();
    let chip = container!.querySelector<HTMLElement>('.sf-stats-goal-chip');
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe('0/500');
    expect(chip!.title).toContain('今日写作字数/目标');
    expect(chip!.title).toContain('命令面板可改目标');

    act(() => {
      useWritingStatsStore.setState({ wordsToday: 620 });
    });
    chip = container!.querySelector<HTMLElement>('.sf-stats-goal-chip');
    expect(chip!.textContent).toBe('✓ 620');
  });
});

describe('StatusBar「⇄ PDF」同步按钮（WS-2 源码 → PDF）', () => {
  /** 手造最小 SynctexIndex：main.tex 第 1 行 → 第 1 页；第 3 行 → 第 4 页（区分光标行定位） */
  const INDEX: SynctexIndex = {
    version: 1,
    inputs: [{ tag: 1, path: 'main.tex' }],
    blocks: [
      { page: 1, tag: 1, line: 1, x: 0, y: 0, w: 10000, h: 20000 },
      { page: 4, tag: 1, line: 3, x: 0, y: 5000, w: 10000, h: 200 },
    ],
  };

  const findSyncButton = (): HTMLButtonElement => {
    const btn = [...(container!.querySelectorAll('button'))].find((b) => b.textContent === '⇄ PDF');
    expect(btn, '未找到 ⇄ PDF 按钮').toBeDefined();
    return btn as HTMLButtonElement;
  };

  afterEach(() => {
    setSynctexIndex(null);
    useUiStore.setState({ pdfView: null, centerView: 'editor' });
  });

  it('无索引时 disabled 且 title 提示需要真实编译产出', () => {
    setSynctexIndex(null);
    renderView();
    const btn = findSyncButton();
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('需要真实编译产出');
  });

  it('索引可用且 PDF 预览已打开 → 点击广播 onPdfGoto（以光标行为基准，D11 修复）', () => {
    setSynctexIndex(INDEX);
    useUiStore.setState({ pdfView: { name: 'main.pdf', data: new ArrayBuffer(0) } });
    renderView(); // 默认光标 { line: 3, col: 7 }
    const btn = findSyncButton();
    expect(btn.disabled).toBe(false);
    expect(btn.title).toContain('跳转到光标行在 PDF 中的位置');
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    act(() => {
      btn.click();
    });
    off();
    // 命中第 3 行块（第 4 页），而非固定第 1 行（第 1 页）
    expect(gotos).toEqual([{ page: 4, y: 5000 }]);
  });

  it('同步目标随光标行变化（光标在第 1 行 → 第 1 页，不再固定首行）', () => {
    setSynctexIndex(INDEX);
    useUiStore.setState({ pdfView: { name: 'main.pdf', data: new ArrayBuffer(0) } });
    renderView({ line: 1, col: 1 });
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    act(() => {
      findSyncButton().click();
    });
    off();
    expect(gotos).toEqual([{ page: 1, y: 0 }]);
  });

  it('索引可用但 PDF 预览未打开 → 记录编译日志提示，不广播', () => {
    setSynctexIndex(INDEX);
    useUiStore.setState({ pdfView: null });
    renderView();
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    act(() => {
      findSyncButton().click();
    });
    off();
    expect(gotos).toEqual([]);
    expect(useWorkspaceStore.getState().compileLog.join('\n')).toContain('请先编译以生成 PDF 预览');
  });

  it('索引未命中当前活动文件 → 记录编译日志提示，不广播', () => {
    setSynctexIndex({
      version: 1,
      inputs: [{ tag: 1, path: 'other.tex' }],
      blocks: [{ page: 1, tag: 1, line: 1, x: 0, y: 0, w: 10000, h: 20000 }],
    });
    useUiStore.setState({ pdfView: { name: 'main.pdf', data: new ArrayBuffer(0) } });
    renderView();
    expect(jumpSourceToPdf('main.tex', 1)).toBe(false); // 索引确不含 main.tex
    const gotos: { page: number; y?: number }[] = [];
    const off = onPdfGoto((g) => gotos.push(g));
    act(() => {
      findSyncButton().click();
    });
    off();
    expect(gotos).toEqual([]);
    expect(useWorkspaceStore.getState().compileLog.join('\n')).toContain('SyncTeX 未命中该文件');
  });

  it('hasSynctexIndex 随真实编译注册翻转（编译状态驱动重渲染后按钮启用）', () => {
    setSynctexIndex(null);
    renderView();
    expect(findSyncButton().disabled).toBe(true);
    act(() => {
      setSynctexIndex(INDEX);
      useWorkspaceStore.setState({ compileStatus: 'ok' });
    });
    expect(hasSynctexIndex()).toBe(true);
    expect(findSyncButton().disabled).toBe(false);
  });
});

describe('StatusBar 页数预算 chip（mock workspace + submit 两 store）', () => {
  const PDFLATEX_OK = [
    '▶ latexmk 真实编译 main.tex',
    'Output written on main.pdf (10 pages, 348576 bytes).',
  ];

  function pageChip(): HTMLElement | null {
    return container!.querySelector<HTMLElement>('.sf-page-chip');
  }

  function setCompile(log: string[], status: 'ok' | 'idle' | 'fail' = 'ok'): void {
    act(() => {
      useWorkspaceStore.setState({ compileLog: log, compileStatus: status });
    });
  }

  it('编译成功且日志有页数、未选 venue → 只显示「N 页」（中性样式）', () => {
    renderView();
    expect(pageChip()).toBeNull(); // idle 无 chip
    setCompile(PDFLATEX_OK);
    const chip = pageChip();
    expect(chip).toBeTruthy();
    expect(chip!.textContent).toBe('10 页');
    expect(chip!.className).not.toContain('err');
    expect(chip!.className).not.toContain('ok');
    expect(chip!.title).toContain('页数上限');
  });

  it('选了 venue（NeurIPS 9 页）→ 「N / M 页」，超限 err 红、未超限 ok', () => {
    renderView();
    act(() => {
      useSubmitStore.setState({ venueId: 'neurips' });
    });
    setCompile(PDFLATEX_OK); // 10 页 > 9
    let chip = pageChip()!;
    expect(chip.textContent).toBe('10 / 9 页');
    expect(chip.className).toContain('err');

    setCompile(['note: Wrote 9 pages']); // tectonic 日志：恰好达限
    chip = pageChip()!;
    expect(chip.textContent).toBe('9 / 9 页');
    expect(chip.className).toContain('ok');
    expect(chip.className).not.toContain('err');
  });

  it('venue 无数字上限（venueId null）→ 不带上限展示；编译失败/无页数不渲染 chip', () => {
    renderView();
    setCompile(PDFLATEX_OK, 'fail'); // 失败：即使日志有页数也不显示
    expect(pageChip()).toBeNull();

    setCompile(['▣ tectonic（内置） · 3 趟 · 1200ms · 成功'], 'ok'); // 成功但日志无页数行
    expect(pageChip()).toBeNull();
  });

  it('en 语言显示「N / M pages」且超限仍为 err', () => {
    act(() => {
      useSettingsStore.setState({ language: 'en' });
    });
    renderView();
    act(() => {
      useSubmitStore.setState({ venueId: 'cvpr' }); // 上限 8
    });
    setCompile(PDFLATEX_OK); // 10 页
    const chip = pageChip()!;
    expect(chip.textContent).toBe('10 / 8 pages');
    expect(chip.className).toContain('err');
    act(() => {
      useSettingsStore.setState({ language: 'zh' });
    });
  });
});
