/**
 * 统一 diff 视图：行号 + 增删着色 + 顶部文件名与统计。
 */
import { useMemo, type CSSProperties } from 'react';
import { diffLines, type Change } from 'diff';

export interface DiffViewProps {
  before: string;
  after: string;
  filename?: string;
  className?: string;
}

type RowKind = 'context' | 'add' | 'del';

interface DiffRow {
  kind: RowKind;
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** 将 diffLines 的块状结果展开为带行号的逐行视图 */
function toRows(changes: readonly Change[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const ch of changes) {
    const lines = ch.value.replace(/\n$/, '').split('\n');
    const count = ch.count ?? lines.length;
    for (let i = 0; i < count; i++) {
      const text = lines[i] ?? '';
      if (ch.added) rows.push({ kind: 'add', newNo: ++newNo, text });
      else if (ch.removed) rows.push({ kind: 'del', oldNo: ++oldNo, text });
      else rows.push({ kind: 'context', oldNo: ++oldNo, newNo: ++newNo, text });
    }
  }
  return rows;
}

const rowStyle: Record<RowKind, CSSProperties> = {
  context: { color: '#9aa3b8', background: 'transparent' },
  add: { color: '#7ee2a8', background: 'rgba(126, 226, 168, 0.12)' },
  del: { color: '#ff7a85', background: 'rgba(255, 122, 133, 0.10)' },
};

export function DiffView(props: DiffViewProps) {
  const { before, after, filename, className } = props;
  const rows = useMemo(() => toRows(diffLines(before, after)), [before, after]);
  const adds = rows.filter((r) => r.kind === 'add').length;
  const dels = rows.filter((r) => r.kind === 'del').length;

  return (
    <div
      className={className ? `sf-diff ${className}` : 'sf-diff'}
      style={{
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#14161d',
        color: '#e8eaf0',
        fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, 'Courier New', monospace",
        fontSize: '13px',
        lineHeight: '1.55',
      }}
    >
      <div
        className="sf-diff-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '6px 12px',
          borderBottom: '1px solid #262a36',
          position: 'sticky',
          top: 0,
          backgroundColor: '#14161d',
        }}
      >
        <span className="sf-diff-filename" style={{ fontWeight: 600 }}>
          {filename ?? '变更对比'}
        </span>
        <span className="sf-diff-stats" style={{ marginLeft: 'auto', userSelect: 'none' }}>
          <span className="sf-diff-adds" style={{ color: '#7ee2a8' }}>
            +{adds}
          </span>
          <span style={{ color: '#4a5160', margin: '0 4px' }}>/</span>
          <span className="sf-diff-dels" style={{ color: '#ff7a85' }}>
            -{dels}
          </span>
        </span>
      </div>
      <div className="sf-diff-body" style={{ padding: '4px 0' }}>
        {rows.map((row, i) => (
          <div
            key={i}
            data-kind={row.kind}
            style={{
              display: 'flex',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              minHeight: '1.55em',
              ...rowStyle[row.kind],
            }}
          >
            <span style={{ width: '3.5em', flexShrink: 0, textAlign: 'right', color: '#4a5160', paddingRight: '8px', userSelect: 'none' }}>
              {row.oldNo ?? ''}
            </span>
            <span style={{ width: '3.5em', flexShrink: 0, textAlign: 'right', color: '#4a5160', paddingRight: '8px', userSelect: 'none' }}>
              {row.newNo ?? ''}
            </span>
            <span style={{ flex: 1, paddingRight: '12px' }}>
              {row.kind === 'add' ? '+ ' : row.kind === 'del' ? '- ' : '  '}
              {row.text}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
