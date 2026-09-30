/**
 * 快照历史对话框：当前文件的快照时间线，可恢复任意版本（AI 修改的安全网）。
 */

import { useEffect } from 'react';
import { useWorkspaceStore } from '../state/workspaceStore';

export function SnapshotDialog({ onClose }: { onClose: () => void }) {
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

  const list = activeTab ? snapshots[activeTab] ?? [] : [];

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog sf-snap" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>快照历史 · {activeTab ?? '未打开文件'}</strong>
        </header>
        <div className="sf-dialog-body">
          {list.length === 0 ? (
            <p className="placeholder">
              暂无快照。采纳 AI 修改时会自动创建快照（设计约定：一切 AI 修改可回滚）。
            </p>
          ) : (
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
                      if (activeTab) restoreSnapshot(activeTab, i);
                      onClose();
                    }}
                  >
                    恢复此版本
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="sf-lib-dialog-actions">
            <button className="sf-btn" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
