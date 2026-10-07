/**
 * 窗口标题与 <html lang> 跟随界面语言（v7.8.0）。
 *
 * 此前 index.html 里把标题与 lang 写死为中文：英文界面下浏览器标签页、桌面窗口
 * 标题栏仍显示「Lemma — 科研写作工作站」，屏幕阅读器也按中文朗读。此处提供
 * 纯函数 + 订阅入口，语言切换即时生效。
 */

import { defineMessages, t } from './i18n';
import type { Language } from './state/settingsStore';

defineMessages({
  'app.docTitle': { zh: 'Lemma — 科研写作工作站', en: 'Lemma — AI-native paper writing workstation' },
});

/** 仅依赖 document 的最小子集——便于在 node 环境中直接测试（无需 jsdom）。 */
export interface DocTitleTarget {
  documentElement: { lang: string };
  title: string;
}

/** Tauri 形态的窗口 API（withGlobalTauri 注入；浏览器形态不存在）。 */
interface TauriGlobal {
  __TAURI__?: {
    window?: { getCurrentWindow?: () => { setTitle?: (title: string) => Promise<void> } };
  };
}

/**
 * 桌面形态：原生标题栏标题不跟随 document.title（由 tauri.conf.json 写死中文），
 * 需要显式 setTitle；缺少桥或权限（core:window:allow-set-title）时静默跳过。
 */
function setNativeWindowTitle(title: string): void {
  if (typeof window === 'undefined') return;
  const tauri = (window as unknown as TauriGlobal).__TAURI__;
  const win = tauri?.window?.getCurrentWindow?.();
  if (!win?.setTitle) return;
  try {
    void Promise.resolve(win.setTitle(title)).catch(() => undefined);
  } catch {
    // 桥不可用不影响 web 标题
  }
}

/** 把语言写入 `<html lang>` 与 document.title（幂等；同一语言重复调用无副作用）。 */
export function applyDocumentLanguage(lang: Language, doc: DocTitleTarget): void {
  doc.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  doc.title = t('app.docTitle', lang);
  setNativeWindowTitle(doc.title);
}
