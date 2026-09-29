import React from 'react';
import ReactDOM from 'react-dom/client';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { configurePdfWorker } from '@scholarforge/library';
import { App } from './App';
import './styles.css';

configurePdfWorker(pdfWorkerUrl);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
