/**
 * 阅读队列面板（v2.8.0 ①）：文献库新增“阅读队列”视图。
 * 按优先级排序显示待读论文，标注优先原因（待读/已被引/高优先级等）。
 * LazyPanel 契约：export function ReadingQueuePanel()，无 props。
 */

import { useMemo } from 'react';
import { Bookmark, Clock3, Star } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useLibraryStore } from '../state/libraryStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { buildQueue, queueSummary, type QueueItem } from '../readingQueue';
import { useUiStore } from '../state/uiStore';

const STRINGS = {
  zh: {
    title: '阅读队列',
    desc: '按优先级排序的待读列表——引用了的先读，新入库的加分',
    empty: '没有待读文献。在文献库标记状态为“待读”即可加入队列',
    today: (n: number) => `建议今日阅读 ${n} 篇`,
    unread: (n: number) => `${n} 篇待读`,
    open: '打开 PDF',
    openLib: '去文献库',
  },
  en: {
    title: 'Reading queue',
    desc: 'Priority-sorted to-read list — cited papers first, recent additions boosted',
    empty: 'No papers to read. Mark papers as "to-read" in the library',
    today: (n: number) => `Read ${n} papers today`,
    unread: (n: number) => `${n} to read`,
    open: 'Open PDF',
    openLib: 'Library',
  },
} as const;

export function ReadingQueuePanel() {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];
  const papers = useLibraryStore((s) => s.papers);
  const openPdf = useLibraryStore((s) => s.openPdf);
  const files = useWorkspaceStore((s) => s.files);

  const { items, summary } = useMemo(() => {
    // 计算引用计数
    const citedCounts = new Map<string, number>();
    for (const [path, content] of Object.entries(files)) {
      if (!path.toLowerCase().endsWith('.tex')) continue;
      for (const m of content.matchAll(/\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
        for (const key of (m[1] ?? '').split(',')) {
          const k = key.trim();
          if (k) citedCounts.set(k, (citedCounts.get(k) ?? 0) + 1);
        }
      }
    }
    const q = buildQueue(papers, citedCounts);
    return { items: q, summary: queueSummary(q) };
  }, [papers, files]);

  if (items.length === 0) {
    return (
      <div style={{ padding: '12px 10px' }}>
        <h3 style={{ margin: '0 0 6px', fontSize: 14 }}>{L.title}</h3>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--fg-2)' }}>{L.empty}</p>
        <button
          className="sf-btn"
          style={{ marginTop: 8 }}
          onClick={() => useUiStore.getState().setSidebarTab('library')}
        >
          {L.openLib}
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Bookmark size={14} /> {L.title}
        </h3>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-2)' }}>{L.desc}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="sf-chip dim">
          <Clock3 size={11} style={{ display: 'inline' }} /> {L.today(summary.dailyTarget)}
        </span>
        <span className="sf-chip dim">{L.unread(summary.unread)}</span>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {items.slice(0, 10).map((item, i) => (
          <li
            key={item.paper.id}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '6px 10px',
              display: 'flex',
              gap: 8,
              alignItems: 'baseline',
              fontSize: 12,
            }}
          >
            <span style={{ color: 'var(--fg-2)', fontSize: 10, fontWeight: 600, flex: 'none' }}>#{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
                {item.paper.title}
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--fg-2)', marginTop: 2 }}>
                {item.reasons.join(' · ')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flex: 'none' }}>
              {item.paper.rating !== undefined && item.paper.rating >= 4 && (
                <Star size={11} style={{ color: 'var(--warn)' }} />
              )}
              <span className="sf-chip dim" style={{ fontSize: 9.5 }}>
                {item.score}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {items.length > 10 && (
        <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-2)' }}>+{items.length - 10} more</p>
      )}
    </div>
  );
}
