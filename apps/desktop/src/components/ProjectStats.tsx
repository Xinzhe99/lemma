/**
 * 项目统计卡（v2.4.0 ④）：一栏看完引用数/图表数/总字数/文献库规模。
 * 纯展示组件（数据经 useMemo 从 workspaceStore + libraryStore 派生），不新增 store。
 */

import { useMemo, type CSSProperties } from 'react';
import { BookOpen, FileText, Hash, Type } from 'lucide-react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { countTexWords } from './StatusBar';

const STRINGS = {
  zh: {
    title: '项目统计',
    citations: '引用文献',
    figures: '图表',
    tables: '表格',
    words: '可见字数',
    library: '文献库',
    unique: '去重后',
  },
  en: {
    title: 'Project stats',
    citations: 'Citations',
    figures: 'Figures',
    tables: 'Tables',
    words: 'Visible words',
    library: 'Library',
    unique: 'unique',
  },
} as const;

interface StatItem {
  icon: React.ReactNode;
  label: string;
  value: string;
}

export function ProjectStats() {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];
  const files = useWorkspaceStore((s) => s.files);
  const papers = useLibraryStore((s) => s.papers);

  const stats = useMemo(() => {
    let totalWords = 0;
    let figures = 0;
    let tables = 0;
    const citedKeys = new Set<string>();

    for (const [path, content] of Object.entries(files)) {
      if (!path.toLowerCase().endsWith('.tex')) continue;
      totalWords += countTexWords(content);
      figures += (content.match(/\\begin\{figure\*?\}/g) ?? []).length;
      tables += (content.match(/\\begin\{table\*?\}/g) ?? []).length;
      for (const m of content.matchAll(/\\cite[pt]?\*?\s*(?:\[[^\]]*\]\s*)?\{([^}]*)\}/g)) {
        for (const key of (m[1] ?? '').split(',')) {
          const k = key.trim();
          if (k) citedKeys.add(k);
        }
      }
    }

    return { totalWords, figures, tables, uniqueCitations: citedKeys.size };
  }, [files]);

  const items: StatItem[] = [
    { icon: <Hash size={13} />, label: L.citations, value: `${stats.uniqueCitations} ${L.unique}` },
    { icon: <FileText size={13} />, label: L.figures, value: String(stats.figures) },
    { icon: <FileText size={13} />, label: L.tables, value: String(stats.tables) },
    { icon: <Type size={13} />, label: L.words, value: stats.totalWords.toLocaleString() },
    { icon: <BookOpen size={13} />, label: L.library, value: String(papers.length) },
  ];

  const cardStyle: CSSProperties = {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '10px 12px',
  };

  return (
    <section className="sf-dash-card sf-dash-project-stats" style={cardStyle}>
      <h4
        className="sf-dash-title"
        style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--fg-1)', letterSpacing: '0.5px' }}
      >
        {L.title}
      </h4>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'baseline' }}>
        {items.map((item) => (
          <div key={item.label} style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
            <span style={{ color: 'var(--fg-2)' }}>{item.icon}</span>
            <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{item.label}</span>
            <span style={{ fontSize: 16, fontWeight: 600, fontFamily: 'monospace' }}>{item.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
