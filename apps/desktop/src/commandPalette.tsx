import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from './i18n';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  kbd?: string;
  /** 分组（i18n key，如 'palette.group.edit'）；缺省不渲染组头、排在已知分组之后 */
  group?: string;
  /** 精选命令：空查询默认视图只展示带此标记的高频项（每组 2-3 个） */
  featured?: boolean;
  run?: () => void;
}

/** 分组展示的规范顺序（i18n key）；未列入的分组按首次出现顺序排在其后 */
export const PALETTE_GROUP_ORDER: string[] = [
  'palette.group.project',
  'palette.group.compile',
  'palette.group.edit',
  'palette.group.ai',
  'palette.group.library',
  'palette.group.view',
  'palette.group.workflow',
  'palette.group.submit',
  'palette.group.knowledge',
  'palette.group.app',
];

export interface CommandGroup {
  /** i18n 分组键；'' 表示未分组（不渲染组头） */
  key: string;
  items: Command[];
}

/**
 * 按 group 分区：已知分组按 PALETTE_GROUP_ORDER 排序，未知分组保持首次出现顺序追加；
 * 组内保持原有相对顺序。
 */
export function groupCommands(cmds: Command[]): CommandGroup[] {
  const buckets = new Map<string, Command[]>();
  for (const c of cmds) {
    const key = c.group ?? '';
    const list = buckets.get(key);
    if (list) list.push(c);
    else buckets.set(key, [c]);
  }
  const rank = (key: string) => {
    const i = PALETTE_GROUP_ORDER.indexOf(key);
    return i === -1 ? PALETTE_GROUP_ORDER.length : i;
  };
  return [...buckets.entries()]
    .map(([key, items]) => ({ key, items }))
    .sort((a, b) => rank(a.key) - rank(b.key));
}

/** 简单子序列模糊匹配：返回得分（越大越优先），不匹配返回 -1 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 0;
  let qi = 0;
  let score = 0;
  let streak = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      streak++;
      score += 1 + streak + (ti === 0 || t[ti - 1] === ' ' ? 2 : 0);
    } else {
      streak = 0;
    }
  }
  return qi === q.length ? score : -1;
}

export function CommandPalette({
  commands,
  onClose,
  placeholder,
  emptyText,
}: {
  commands: Command[];
  onClose: () => void;
  placeholder?: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const t = useT();

  const trimmed = query.trim();
  const searching = trimmed.length > 0;

  const groups = useMemo<CommandGroup[]>(() => {
    if (!searching) {
      // 空查询：只展示精选默认命令；调用方未标记精选时退回全量分组展示
      const featured = commands.filter((c) => c.featured);
      return groupCommands(featured.length > 0 ? featured : commands);
    }
    // 有查询词：全文模糊匹配全部命令（标题+提示），按得分排序后分区展示
    const matched = commands
      .map((c) => ({ c, s: fuzzyScore(trimmed, c.title + ' ' + (c.hint ?? '')) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
    return groupCommands(matched);
  }, [commands, trimmed, searching]);

  // 键盘导航用的扁平序列：激活索引跨组连续
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const flatIndex = useMemo(() => new Map(flat.map((c, i) => [c.id, i])), [flat]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, flat.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = flat[active];
        if (cmd) {
          cmd.run?.();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, active, onClose]);

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder={placeholder ?? t('palette.placeholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="palette-list">
          {groups.map((g) => (
            <Fragment key={g.key || '__ungrouped'}>
              {g.key && <li className="palette-group-head">{t(g.key)}</li>}
              {g.items.map((c) => {
                const i = flatIndex.get(c.id) ?? 0;
                return (
                  <li
                    key={c.id}
                    className={`palette-item ${i === active ? 'active' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => {
                      c.run?.();
                      onClose();
                    }}
                  >
                    <span>{c.title}</span>
                    <span className="palette-meta">
                      {c.hint && <em>{c.hint}</em>}
                      {c.kbd && <kbd>{c.kbd}</kbd>}
                    </span>
                  </li>
                );
              })}
            </Fragment>
          ))}
          {flat.length === 0 && <li className="palette-empty">{emptyText ?? t('palette.empty')}</li>}
        </ul>
        {!searching && commands.length > 0 && (
          <div className="palette-footer">{t('palette.searchAll', { n: commands.length })}</div>
        )}
      </div>
    </div>
  );
}
