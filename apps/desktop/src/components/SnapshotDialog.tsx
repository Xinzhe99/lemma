/**
 * 快照历史对话框：全项目快照时间线，按文件分组（workspaceStore.snapshots 只读）。
 * 任一条目可恢复（restoreSnapshot(path, index)）；当前打开文件的分组高亮。
 */

import { useEffect, useMemo } from 'react';
import { useT } from '../i18n';
import { useWorkspaceStore } from '../state/workspaceStore';

export function SnapshotDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const snapshots = useWorkspaceStore((s) => s.snapshots);
  const restoreSnapshot = useWorkspaceStore((s) => s.restoreSnapshot);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  /** 按文件分组（快照多的文件排前，当前文件置顶），只读 snapshots */
  const groups = useMemo(() => {
    return Object.entries(snapshots)
      .filter(([, list]) => list.length > 0)
      .map(([path, list]) => ({ path, list }))
      .sort((a, b) => {
        if (a.path === activeTab) return -1;
        if (b.path === activeTab) return 1;
        return b.list.length - a.list.length || a.path.localeCompare(b.path);
      });
  }, [snapshots, activeTab]);

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-snap" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{t('snap.title')}</strong>
        </header>
        <div className="sf-dialog-body">
          {groups.length === 0 ? (
            <p className="placeholder">{t('snap.empty')}</p>
          ) : (
            groups.map(({ path, list }) => (
              <section key={path} className={`sf-snap-group ${path === activeTab ? 'current' : ''}`}>
                <header className="sf-snap-group-header">
                  <code className="sf-snap-group-path">{path}</code>
                  {path === activeTab && <em className="sf-chip ok">{t('snap.currentFile')}</em>}
                </header>
                <ul className="sf-snap-list">
                  {list.map((snap, i) => (
                    <li key={`${snap.ts}-${i}`} className="sf-snap-row">
                      <div className="sf-snap-main">
                        <span className="sf-snap-label">{snap.label}</span>
                        <span className="sf-snap-time">{new Date(snap.ts).toLocaleString()}</span>
                        <code className="sf-snap-preview">
                          {snap.content.slice(0, 90).replace(/\n/g, ' ')}
                          {snap.content.length > 90 ? '…' : ''}
                        </code>
                      </div>
                      <button
                        className="sf-btn"
                        onClick={() => {
                          restoreSnapshot(path, i);
                          onClose();
                        }}
                      >
                        {t('snap.restore')}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={onClose}>
              {t('snap.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
