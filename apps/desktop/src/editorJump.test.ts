/**
 * editorJump 桥单测（D1 光标桥响应式 + D3 无 handler 兜底）：
 * - 跳转桥：handler 注册/派发/卸载、stashPendingJump 暂存与 takePendingJump 消费
 *   （含 .tex 扩展名可省略的匹配），以及无 handler（编辑器未挂载，如 PDF 视图）时
 *   jumpTo 兜底 openFile(目标文件) + setCenterView('editor') 且暂存目标不丢失；
 * - 光标桥：notifyCursor 更新 lastCursor 快照并通知全部订阅者、取消订阅后不再通知、
 *   两次通知之间快照引用稳定（useSyncExternalStore 的 getSnapshot 契约）。
 * 两 store 模块以最小假实现 mock（editorJump 仅消费 getState().openFile / setCenterView）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storeMocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  setCenterView: vi.fn(),
}));

vi.mock('./state/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ openFile: storeMocks.openFile }) },
}));
vi.mock('./state/uiStore', () => ({
  useUiStore: { getState: () => ({ setCenterView: storeMocks.setCenterView }) },
}));

import {
  jumpTo,
  lastCursor,
  notifyCursor,
  setJumpHandler,
  stashPendingJump,
  subscribeCursor,
  takePendingJump,
  type CursorInfo,
} from './editorJump';

beforeEach(() => {
  storeMocks.openFile.mockClear();
  storeMocks.setCenterView.mockClear();
});

afterEach(() => {
  setJumpHandler(null);
});

describe('跳转桥：handler 路径', () => {
  it('已注册 handler 时直接派发，不触发兜底 openFile/setCenterView', () => {
    const got: { file: string; line: number }[] = [];
    setJumpHandler((t) => got.push(t));
    jumpTo({ file: 'main.tex', line: 9 });
    expect(got).toEqual([{ file: 'main.tex', line: 9 }]);
    expect(storeMocks.openFile).not.toHaveBeenCalled();
    expect(storeMocks.setCenterView).not.toHaveBeenCalled();
  });

  it('handler 注销后（编辑器卸载）不再派发', () => {
    const got: { file: string; line: number }[] = [];
    setJumpHandler((t) => got.push(t));
    setJumpHandler(null);
    jumpTo({ file: 'main.tex', line: 3 });
    expect(got).toEqual([]);
  });
});

describe('跳转桥：无 handler 兜底（D3：PDF 视图下 EditorArea 已卸载）', () => {
  it('jumpTo 兜底 openFile(目标文件) + setCenterView("editor")，暂存目标供编辑器挂载后精确定位', () => {
    jumpTo({ file: 'sections/intro.tex', line: 42 });
    expect(storeMocks.openFile).toHaveBeenCalledTimes(1);
    expect(storeMocks.openFile).toHaveBeenCalledWith('sections/intro.tex');
    expect(storeMocks.setCenterView).toHaveBeenCalledTimes(1);
    expect(storeMocks.setCenterView).toHaveBeenCalledWith('editor');

    // 编辑器随后挂载：takePendingJump 消费暂存目标（行级定位数据不因兜底丢失）
    expect(takePendingJump('sections/intro.tex')).toEqual({ file: 'sections/intro.tex', line: 42 });
    // 消费后清空，不重复触发
    expect(takePendingJump('sections/intro.tex')).toBeNull();
  });

  it('takePendingJump 仅消费匹配当前文件的暂存目标（.tex 扩展名可省略）', () => {
    jumpTo({ file: 'sections/intro.tex', line: 7 });
    expect(takePendingJump('main.tex')).toBeNull();
    expect(takePendingJump('sections/intro')).toEqual({ file: 'sections/intro.tex', line: 7 });
  });
});

describe('暂存：stashPendingJump（跨文件跳转的既有路径）', () => {
  it('显式暂存不触发 store 兜底，仅待 takePendingJump 消费', () => {
    stashPendingJump({ file: 'refs.bib', line: 3 });
    expect(storeMocks.openFile).not.toHaveBeenCalled();
    expect(storeMocks.setCenterView).not.toHaveBeenCalled();
    expect(takePendingJump('refs.bib')).toEqual({ file: 'refs.bib', line: 3 });
  });
});

describe('光标桥（D1：notifyCursor → subscribeCursor 响应式）', () => {
  it('notifyCursor 更新 lastCursor 快照', () => {
    notifyCursor({ file: 'main.tex', line: 12, col: 3 });
    expect(lastCursor()).toEqual({ file: 'main.tex', line: 12, col: 3 });
    notifyCursor({ file: 'sections/intro.tex', line: 1, col: 1 });
    expect(lastCursor()).toEqual({ file: 'sections/intro.tex', line: 1, col: 1 });
  });

  it('notifyCursor 通知全部订阅者；取消订阅后不再收到通知', () => {
    const a: CursorInfo[] = [];
    const b: CursorInfo[] = [];
    const offA = subscribeCursor((c) => a.push(c));
    const offB = subscribeCursor((c) => b.push(c));
    notifyCursor({ file: 'main.tex', line: 4, col: 2 });
    expect(a).toEqual([{ file: 'main.tex', line: 4, col: 2 }]);
    expect(b).toEqual([{ file: 'main.tex', line: 4, col: 2 }]);
    offA();
    notifyCursor({ file: 'main.tex', line: 5, col: 1 });
    expect(a).toHaveLength(1); // 已取消：仍只有第一次的通知
    expect(b).toHaveLength(2);
    offB();
  });

  it('快照稳定性：两次通知之间 lastCursor() 返回同一引用（useSyncExternalStore 契约）', () => {
    notifyCursor({ file: 'main.tex', line: 2, col: 1 });
    const first = lastCursor();
    expect(lastCursor()).toBe(first);
    notifyCursor({ file: 'main.tex', line: 3, col: 1 });
    expect(lastCursor()).not.toBe(first);
  });
});
