/**
 * 文献库 BibTeX 导出（v2.6.0 ①）：命令面板入口 → 生成 .bib → 浏览器下载。
 * citedOnly=true 时只导出稿件 \cite 过的条目。
 */

import { toBibtex } from '@lemma/library';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';

/** 收集稿件中引用的 citekey */
function collectCitedKeys(): Set<string> {
  const keys = new Set<string>();
  const ws = useWorkspaceStore.getState();
  for (const [path, content] of Object.entries(ws.files)) {
    if (!path.toLowerCase().endsWith('.tex')) continue;
    for (const m of content.matchAll(/\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
      for (const key of (m[1] ?? '').split(',')) {
        const k = key.trim();
        if (k) keys.add(k);
      }
    }
  }
  return keys;
}

/** 导出并触发下载 */
export function exportLibraryBib(citedOnly: boolean): void {
  const papers = useLibraryStore.getState().papers;
  if (papers.length === 0) return;

  const citedKeys = citedOnly ? collectCitedKeys() : undefined;
  const bib = toBibtex(papers, { citedKeys });
  if (!bib.trim()) return;

  const name = citedOnly ? 'cited-refs.bib' : 'library.bib';
  const blob = new Blob([bib], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
