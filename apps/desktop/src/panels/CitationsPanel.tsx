/**
 * 引用面板：正文 \cite 与 refs.bib、文献库三方对账（4.4 引用完整性）。
 */

import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { bibCitekeys, citedKeys } from '../projectDoc';

export function CitationsPanel() {
  const files = useWorkspaceStore((s) => s.files);
  const papers = useLibraryStore((s) => s.papers);
  const importBibtex = useLibraryStore((s) => s.importBibtex);
  const [message, setMessage] = useState<string | null>(null);

  const cited = useMemo(() => citedKeys(files), [files]);
  const bibSet = useMemo(() => bibCitekeys(files), [files]);
  const libSet = useMemo(() => new Set(papers.map((p) => p.citekey)), [papers]);

  const missingInBib = cited.filter((k) => !bibSet.has(k));
  const missingInLib = cited.filter((k) => bibSet.has(k) && !libSet.has(k));
  const bibPath = Object.keys(files).find((p) => p.endsWith('.bib'));

  const importFromBib = () => {
    if (!bibPath) return;
    const result = importBibtex(files[bibPath] ?? '');
    setMessage(`已从 ${bibPath} 导入 ${result.added} 条${result.errors.length ? `（${result.errors.length} 条提示）` : ''}`);
  };

  return (
    <div className="sf-cites">
      <div className="sf-cites-summary">
        <span>正文引用 {cited.length}</span>
        <span className={missingInBib.length ? 'sf-chip err' : 'sf-chip ok'}>
          bib 缺失 {missingInBib.length}
        </span>
        <span className={missingInLib.length ? 'sf-chip warn' : 'sf-chip ok'}>
          库缺失 {missingInLib.length}
        </span>
      </div>

      {missingInLib.length > 0 && bibPath && (
        <button className="sf-btn sf-cites-import" onClick={importFromBib}>
          从 {bibPath} 导入文献库
        </button>
      )}
      {message && <p className="sf-cites-msg">{message}</p>}

      {cited.length === 0 ? (
        <p className="placeholder">正文暂无 \cite 引用</p>
      ) : (
        <ul className="sf-cites-list">
          {cited.map((key) => (
            <li key={key} className="sf-cites-row">
              <code className="sf-cites-key">{key}</code>
              <span className="sf-cites-chips">
                <span className={bibSet.has(key) ? 'sf-chip ok' : 'sf-chip err'}>
                  {bibSet.has(key) ? 'bib ✓' : 'bib ✗'}
                </span>
                <span className={libSet.has(key) ? 'sf-chip ok' : 'sf-chip dim'}>
                  {libSet.has(key) ? '文献库 ✓' : '文献库 ✗'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
