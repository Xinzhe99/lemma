/**
 * Zotero 本地同步（v5.9.0）：对接桌面版 Zotero + Better BibTeX 的本地 HTTP 端点
 * （默认 http://localhost:23119/better-bibtex/library.bibtex 导出全库 BibTeX）。
 * - 取回经既有 importBibtex 合并入库（按 citekey 去重——增量语义自然成立）；
 * - 取回链：页面 fetch（BBT 自带 CORS 头）→ 失败回落系统 curl（桌面 WebView 兜底）；
 * - 未装 Zotero/BBT 或端点未开：1.5s 超时后明确提示，不伪装成功。
 */

import { parseBibtex } from '@lemma/library';
import { useLibraryStore } from './state/libraryStore';

export const ZOTERO_BBT_LIBRARY_URL = 'http://localhost:23119/better-bibtex/library.bibtex';
// v7.0.0：1.5s 对大库全量导出太紧——同步放宽 10s
const FETCH_TIMEOUT_MS = 10000;

export type ZoteroSyncResult =
  | { ok: true; added: number; skipped: number; errors: string[]; via: 'fetch' | 'curl' }
  | { ok: false; reason: string };

async function fetchViaBrowser(): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(ZOTERO_BBT_LIBRARY_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchViaCurl(): Promise<string> {
  // 系统自带 curl（Win10+/macOS）：-m 超时 -s 静默；proc_run 仅桌面形态可用
  const { tauriProcRun } = await import('./platform/tauri');
  // v7.0.0：-f 让 HTTP 4xx/5xx 走失败；大库全量导出放宽到 25s
  const r = await tauriProcRun('curl', ['-s', '-f', '-m', '25', ZOTERO_BBT_LIBRARY_URL]);
  if (r.code !== 0 || !r.stdout.trim()) throw new Error('curl 失败或返回为空');
  return r.stdout;
}

/** 探测本地 Zotero/BBT 端点是否可用（库面板按钮的可用性指示） */
export async function probeZotero(): Promise<boolean> {
  try {
    await fetchViaBrowser();
    return true;
  } catch {
    try {
      await fetchViaCurl();
      return true;
    } catch {
      return false;
    }
  }
}

/** 一键同步：全库 BibTeX → 合并入库（增量去重） */
export async function syncZotero(): Promise<ZoteroSyncResult> {
  let bibtex: string;
  let via: 'fetch' | 'curl';
  try {
    bibtex = await fetchViaBrowser();
    via = 'fetch';
  } catch {
    try {
      bibtex = await fetchViaCurl();
      via = 'curl';
    } catch {
      return {
        ok: false,
        reason:
          '未连接到本地 Zotero——请确认：① 已安装 Zotero 桌面版并正在运行；② 已安装 Better BibTeX 插件；③ BBT 钩子端口未被改动（默认 23119）。',
      };
    }
  }
  const parsed = parseBibtex(bibtex);
  if (parsed.papers.length === 0 && bibtex.trim().length > 0) {
    return { ok: false, reason: 'Zotero 返回的内容无法解析为 BibTeX 条目' };
  }
  const before = useLibraryStore.getState().papers.length;
  const r = useLibraryStore.getState().importBibtex(bibtex);
  return {
    ok: true,
    added: r.added,
    skipped: parsed.papers.length - r.added,
    errors: r.errors,
    via,
  };
}
