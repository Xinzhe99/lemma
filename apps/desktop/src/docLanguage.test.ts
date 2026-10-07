import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDocumentLanguage, type DocTitleTarget } from './docLanguage';

function fakeDoc(): DocTitleTarget {
  return { documentElement: { lang: '' }, title: '' };
}

describe('docLanguage（标题与 <html lang> 跟随语言）', () => {
  it('zh：lang=zh-CN，标题为中文', () => {
    const doc = fakeDoc();
    applyDocumentLanguage('zh', doc);
    expect(doc.documentElement.lang).toBe('zh-CN');
    expect(doc.title).toBe('Lemma — 科研写作工作站');
  });

  it('en：lang=en，标题为英文（不再残留中文标题）', () => {
    const doc = fakeDoc();
    applyDocumentLanguage('en', doc);
    expect(doc.documentElement.lang).toBe('en');
    expect(doc.title).toBe('Lemma — AI-native paper writing workstation');
    // 英文界面下标题不应再出现中文（回归：index.html 写死中文标题）
    expect(/[\u4e00-\u9fff]/.test(doc.title)).toBe(false);
  });

  it('双向切换：zh → en → zh 均生效（幂等覆盖）', () => {
    const doc = fakeDoc();
    applyDocumentLanguage('zh', doc);
    applyDocumentLanguage('en', doc);
    expect(doc.title).toBe('Lemma — AI-native paper writing workstation');
    applyDocumentLanguage('zh', doc);
    expect(doc.documentElement.lang).toBe('zh-CN');
    expect(doc.title).toBe('Lemma — 科研写作工作站');
  });

  it('index.html 不再写死中文标题与 lang（由 main.tsx 接管）', () => {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'), 'utf8');
    expect(html).not.toMatch(/<html[^>]*lang="zh-CN"/);
    expect(html).toMatch(/<title>Lemma<\/title>/);
  });

  it('无 Tauri 桥（浏览器/测试环境）时静默跳过原生标题设置，不抛错', () => {
    const doc = fakeDoc();
    expect(() => applyDocumentLanguage('en', doc)).not.toThrow();
    expect(doc.title).toBe('Lemma — AI-native paper writing workstation');
  });

  it('Tauri 桥可用时同步原生窗口标题；桥抛错不影响 web 标题', () => {
    const calls: string[] = [];
    const g = globalThis as unknown as { window?: unknown };
    const prev = g.window;
    g.window = {
      __TAURI__: {
        window: { getCurrentWindow: () => ({ setTitle: async (s: string) => void calls.push(s) }) },
      },
    };
    try {
      const doc = fakeDoc();
      applyDocumentLanguage('en', doc);
      expect(calls).toEqual(['Lemma — AI-native paper writing workstation']);
    } finally {
      if (prev === undefined) delete g.window;
      else g.window = prev;
    }

    // setTitle 抛错（缺权限）：仍然是 web 标题生效、函数不抛
    g.window = {
      __TAURI__: {
        window: {
          getCurrentWindow: () => ({
            setTitle: () => {
              throw new Error('window.set_title not allowed');
            },
          }),
        },
      },
    };
    try {
      const doc = fakeDoc();
      expect(() => applyDocumentLanguage('zh', doc)).not.toThrow();
      expect(doc.title).toBe('Lemma — 科研写作工作站');
    } finally {
      if (prev === undefined) delete g.window;
      else g.window = prev;
    }
  });

  it('桌面能力声明包含 set-title 权限（否则原生标题栏无法随语言切换）', () => {
    const capsPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'src-tauri',
      'capabilities',
      'default.json',
    );
    const caps = JSON.parse(readFileSync(capsPath, 'utf8')) as { permissions: string[] };
    expect(caps.permissions).toContain('core:window:allow-set-title');
  });
});
