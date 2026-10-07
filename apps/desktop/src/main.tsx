import React from 'react';
import ReactDOM from 'react-dom/client';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { setPdfWorkerUrl } from '@lemma/library';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { applyTheme } from './theme';
import { useSettingsStore } from './state/settingsStore';
import { applyDocumentLanguage } from './docLanguage';
import './styles.css';

// v7.8.0：窗口标题与 <html lang> 随界面语言（此前 index.html 写死中文——英文界面下
// 浏览器标签页 / 桌面窗口标题栏仍显示「Lemma — 科研写作工作站」）。
applyDocumentLanguage(useSettingsStore.getState().language, document);
// 语言切换即时生效（store 订阅：设置面板切语言后标题栏无需刷新）
useSettingsStore.subscribe((s, prev) => {
  if (s.language !== prev.language) applyDocumentLanguage(s.language, document);
});

// worker URL 中转（v4.2.0）：主 bundle 只注入地址字符串（不牵连 pdfjs 运行时），
// reader 子入口加载时取用并转交给 pdfjs GlobalWorkerOptions。
setPdfWorkerUrl(pdfWorkerUrl);

// 早期应用持久化主题（默认 light）：先于 React 挂载写入 data-theme，避免主题闪烁
applyTheme(useSettingsStore.getState().theme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
