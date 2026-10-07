/**
 * 快照历史对话框：全项目快照时间线，按文件分组（workspaceStore.snapshots 只读）。
 * 任一条目可恢复（restoreSnapshot(path, index)）；当前打开文件的分组高亮。
 * 每条快照行带「对比当前」按钮：行下展开 DiffView（before=快照内容，after=当前文件内容，
 * 同时只展开一条）；内容一致时显示「与当前版本一致」文案，不再渲染 diff。
 * 新增交互字符串使用组件内 zh/en 本地字典（不触碰 i18n.ts）；不新增 CSS（展开容器用内联样式）。
 */

import { useEffect, useMemo, useState } from 'react';
import { DiffView } from '@lemma/editor';
import { useT } from '../i18n';
import { confirmDialog } from '../dialogs';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';

const STRINGS = {
  zh: { compare: '对比当前', collapse: '收起对比', same: '与当前版本一致' },
  en: { compare: 'Compare with current', collapse: 'Hide comparison', same: 'Identical to current version' },
} as const;

export function SnapshotDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language];
  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const snapshots = useWorkspaceStore((s) => s.snapshots);
  const restoreSnapshot = useWorkspaceStore((s) => s.restoreSnapshot);

  /** 当前展开对比的快照行（`${path}#${index}`），同时只展开一条 */
  const [diffOpenKey, setDiffOpenKey] = useState<string | null>(null);

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
                  {list.map((snap, i) => {
                    const key = `${path}#${i}`;
                    const open = diffOpenKey === key;
                    const current = files[path] ?? '';
                    const same = snap.content === current;
                    return (
                      <li
                        key={key}
                        className="sf-snap-row"
                        style={open ? { flexWrap: 'wrap', alignItems: 'flex-start' } : undefined}
                      >
                        <div className="sf-snap-main">
                          <span className="sf-snap-label">{snap.label}</span>
                          <span className="sf-snap-time">{new Date(snap.ts).toLocaleString()}</span>
                          <code className="sf-snap-preview">
                            {snap.content.slice(0, 90).replace(/\n/g, ' ')}
                            {snap.content.length > 90 ? '…' : ''}
                          </code>
                        </div>
                        <button
                          className="sf-btn sf-snap-compare"
                          aria-expanded={open}
                          onClick={() => setDiffOpenKey(open ? null : key)}
                        >
                          {open ? L.collapse : L.compare}
                        </button>
                        <button
                          className="sf-btn"
                          onClick={() => {
                            // 恢复会覆盖当前内容且不自动备份 → 先确认（对齐删除/回滚等破坏性操作）
                            void confirmDialog(
                              t('snap.restoreConfirmTitle', { path }),
                              t('snap.restoreConfirm'),
                            ).then((ok) => {
                              if (!ok) return;
                              restoreSnapshot(path, i);
                              onClose();
                            });
                          }}
                        >
                          {t('snap.restore')}
                        </button>
                        {open &&
                          (same ? (
                            <p
                              className="sf-snap-same placeholder"
                              style={{ flexBasis: '100%', margin: '8px 0 0' }}
                            >
                              {L.same}
                            </p>
                          ) : (
                            <div
                              className="sf-snap-diff"
                              style={{
                                flexBasis: '100%',
                                height: 260,
                                marginTop: 8,
                                border: '1px solid var(--border)',
                                borderRadius: 'var(--radius, 6px)',
                                overflow: 'hidden',
                              }}
                            >
                              <DiffView before={snap.content} after={current} filename={path} />
                            </div>
                          ))}
                      </li>
                    );
                  })}
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
