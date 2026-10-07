// @vitest-environment jsdom
/**
 * dialogs.ts · 模态浮层判定测试（v7.8.0）。
 * 背景（缺陷）：命令面板 z-index 100 / 快速打开 150 低于对话框 200——
 * 对话框开着时再按 Ctrl+K / Ctrl+P 会把浮层叠在对话框「下面」，
 * 浮层仍抢走键盘输入（用户以为没反应，实际 Enter 会执行看不见的命令）。
 * App 的全局快捷键据此判定：已有模态浮层时不再叠加打开新浮层。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { MODAL_OVERLAY_SELECTOR, isModalOverlayOpen } from './dialogs';

function mount(className: string): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isModalOverlayOpen', () => {
  it('无浮层：false（快捷键可正常打开浮层）', () => {
    expect(isModalOverlayOpen()).toBe(false);
    expect(isModalOverlayOpen(false)).toBe(false);
  });

  it('对话框打开：true；命令面板开关不受自身影响（includePalette=false）', () => {
    mount('sf-dialog-overlay');
    expect(isModalOverlayOpen()).toBe(true);
    expect(isModalOverlayOpen(false)).toBe(true);
  });

  it('命令面板：默认视为浮层；includePalette=false 时不算（Ctrl+K 仍可关闭面板）', () => {
    mount('palette-overlay');
    expect(isModalOverlayOpen()).toBe(true);
    expect(isModalOverlayOpen(false)).toBe(false);
  });

  it('快速打开 / 快捷键浮层均计入', () => {
    mount('sf-quickopen-overlay');
    expect(isModalOverlayOpen()).toBe(true);
    document.body.innerHTML = '';
    mount('sf-shortcuts-overlay');
    expect(isModalOverlayOpen()).toBe(true);
  });

  it('选择器覆盖全部模态浮层根类名（与 styles.css 的 z-index 分层一致）', () => {
    for (const cls of ['sf-dialog-overlay', 'sf-quickopen-overlay', 'sf-shortcuts-overlay', 'palette-overlay']) {
      document.body.innerHTML = '';
      mount(cls);
      // 含 sf-tour-overlay 的对话框（欢迎导览）用同一根类名，亦被覆盖
      expect(isModalOverlayOpen(), cls).toBe(true);
    }
    expect(MODAL_OVERLAY_SELECTOR).toContain('sf-dialog-overlay');
    expect(MODAL_OVERLAY_SELECTOR).not.toContain('palette-overlay'); // palette 由参数追加
  });

  it('非浮层元素（侧栏/编辑器）不误判', () => {
    mount('sidebar');
    mount('center');
    expect(isModalOverlayOpen()).toBe(false);
  });
});
