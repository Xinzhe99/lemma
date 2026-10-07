/**
 * 文献库 BibTeX 导出（v2.6.0 ①）：命令面板入口 → 生成 .bib → 浏览器下载。
 * citedOnly=true 时只导出稿件 \cite 过的条目（稿件无引用则不产出文件，返回 false）。
 */

import { toBibtex } from '@lemma/library';
import { useLibraryStore } from './state/libraryStore';
import { useWorkspaceStore } from './state/workspaceStore';

/**
 * 稿件中的引用命令：\cite / \citep / \citet（含 * 变体）。
 * 可选参数可重复出现（natbib 的 `\citep[see][p. 3]{key}` 两段式），
 * 只匹配一段会把这类引用整条漏掉——cited-only 导出因此丢条目。
 */
const CITE_RE = /\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;

/** 收集稿件中引用的 citekey */
function collectCitedKeys(): Set<string> {
  const keys = new Set<string>();
  const ws = useWorkspaceStore.getState();
  for (const [path, content] of Object.entries(ws.files)) {
    if (!path.toLowerCase().endsWith('.tex')) continue;
    for (const m of content.matchAll(CITE_RE)) {
      for (const key of (m[1] ?? '').split(',')) {
        const k = key.trim();
        if (k) keys.add(k);
      }
    }
  }
  return keys;
}

/**
 * 导出并触发下载；返回是否真的产出了文件（未产出时调用方可提示）。
 * citedOnly=true 且稿件一处 \cite 都没有 → 不下载：toBibtex 对「空 citedKeys」
 * 视为不过滤，会把整个文献库当成「被引文献」写出（cite-refs.bib 名不副实）。
 */
export function exportLibraryBib(citedOnly: boolean): boolean {
  const papers = useLibraryStore.getState().papers;
  if (papers.length === 0) return false;

  const citedKeys = citedOnly ? collectCitedKeys() : undefined;
  if (citedKeys && citedKeys.size === 0) return false;
  const bib = toBibtex(papers, { citedKeys });
  if (!bib.trim()) return false;

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
  return true;
}
