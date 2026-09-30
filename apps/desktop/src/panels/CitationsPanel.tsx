/**
 * 引用面板：正文 \cite 与 refs.bib、文献库三方对账（4.4 引用完整性）。
 */

import { useMemo, useState } from 'react';
import { useT } from '../i18n';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { bibCitekeys, citedKeys } from '../projectDoc';

export function CitationsPanel() {
  const t = useT();
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
    setMessage(
      t('cites.imported', {
        path: bibPath,
        n: result.added,
        errors: result.errors.length ? t('cites.importErrors', { n: result.errors.length }) : '',
      }),
    );
  };

  return (
    <div className="sf-cites">
      <div className="sf-cites-summary">
        <span>{t('cites.bodyCited', { n: cited.length })}</span>
        <span className={missingInBib.length ? 'sf-chip err' : 'sf-chip ok'}>
          {t('cites.missingBib', { n: missingInBib.length })}
        </span>
        <span className={missingInLib.length ? 'sf-chip warn' : 'sf-chip ok'}>
          {t('cites.missingLib', { n: missingInLib.length })}
        </span>
      </div>

      {missingInLib.length > 0 && bibPath && (
        <button className="sf-btn sf-cites-import" onClick={importFromBib}>
          {t('cites.importFrom', { path: bibPath })}
        </button>
      )}
      {message && <p className="sf-cites-msg">{message}</p>}

      {cited.length === 0 ? (
        <p className="placeholder">{t('cites.empty')}</p>
      ) : (
        <ul className="sf-cites-list">
          {cited.map((key) => (
            <li key={key} className="sf-cites-row">
              <code className="sf-cites-key">{key}</code>
              <span className="sf-cites-chips">
                <span className={bibSet.has(key) ? 'sf-chip ok' : 'sf-chip err'}>
                  {bibSet.has(key) ? t('cites.inBib') : t('cites.notInBib')}
                </span>
                <span className={libSet.has(key) ? 'sf-chip ok' : 'sf-chip dim'}>
                  {libSet.has(key) ? t('cites.inLib') : t('cites.notInLib')}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
