import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  kbd?: string;
  run?: () => void;
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

export function CommandPalette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => {
    return commands
      .map((c) => ({ c, s: fuzzyScore(query, c.title + ' ' + (c.hint ?? '')) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = results[active];
        if (cmd) {
          cmd.run?.();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, active, onClose]);

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="输入命令…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="palette-list">
          {results.map((c, i) => (
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
          ))}
          {results.length === 0 && <li className="palette-empty">无匹配命令</li>}
        </ul>
      </div>
    </div>
  );
}
