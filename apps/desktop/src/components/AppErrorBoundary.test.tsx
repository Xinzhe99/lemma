// @vitest-environment jsdom
/**
 * 根级 ErrorBoundary 测试：子组件渲染异常时呈现品牌错误卡（应用名 + 错误摘要 + 重试/复制按钮）
 * 而非白屏；「重试」重置内部 state 重新挂载子树（子树修复后即恢复）；正常子树原样渲染不受影响；
 * 「复制错误详情」把 message + stack 写入剪贴板。React 渲染异常的 console.error 噪音以 spy 静音。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppErrorBoundary } from './AppErrorBoundary';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render(ui: React.ReactElement) {
  act(() => {
    root!.render(ui);
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function button(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent === text,
  );
  if (!found) throw new Error(`button not found: ${text}`);
  return found;
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  vi.restoreAllMocks();
  const r = root;
  if (r) act(() => r.unmount());
  container?.remove();
  root = null;
  container = null;
});

/** 渲染即抛异常的子组件（模拟编辑器/编译面板崩溃） */
function Bomb({ message }: { message: string }): never {
  throw new Error(message);
}

function Ok() {
  return <p data-testid="ok">一切正常</p>;
}

describe('AppErrorBoundary', () => {
  it('正常子树不受影响：原样渲染，不出现错误卡', () => {
    render(
      <AppErrorBoundary>
        <Ok />
      </AppErrorBoundary>,
    );
    expect(container!.querySelector('[data-testid="ok"]')).toBeTruthy();
    expect(container!.textContent).not.toContain('重试');
    expect(container!.textContent).not.toContain('复制错误详情');
  });

  it('子组件渲染异常时呈现品牌错误卡（应用名 + 错误摘要 + 两个操作按钮），而非白屏', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Bomb message="编辑器渲染崩溃" />
      </AppErrorBoundary>,
    );
    const text = container!.textContent ?? '';
    expect(text).toContain('ScholarForge');
    expect(text).toContain('编辑器渲染崩溃');
    expect(text).toContain('重试');
    expect(text).toContain('复制错误详情');
    errSpy.mockRestore();
  });

  it('点击「重试」重置错误并重新挂载子树（子树修复后即恢复）', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Bomb message="boom" />
      </AppErrorBoundary>,
    );
    expect(container!.textContent).toContain('boom');

    // 子树换成正常组件（模拟修复）：错误卡仍在，直到用户点击重试
    render(
      <AppErrorBoundary>
        <Ok />
      </AppErrorBoundary>,
    );
    expect(container!.querySelector('[data-testid="ok"]')).toBeNull();

    click(button('重试'));
    expect(container!.querySelector('[data-testid="ok"]')).toBeTruthy();
    expect(container!.textContent).not.toContain('boom');
    errSpy.mockRestore();
  });

  it('「复制错误详情」把 message + stack 写入剪贴板', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });

    render(
      <AppErrorBoundary>
        <Bomb message="复制我" />
      </AppErrorBoundary>,
    );
    click(button('复制错误详情'));

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('Error');
    expect(copied).toContain('复制我');

    delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    errSpy.mockRestore();
  });
});
