import React from 'react';
import ReactDOM from 'react-dom/client';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { setPdfWorkerUrl } from '@lemma/library';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { applyTheme } from './theme';
import { useSettingsStore } from './state/settingsStore';
import './styles.css';

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
