/**
 * 快速打开文件浮层（Ctrl+P，sf-quickopen）：类命令面板骨架，
 * 复用 commandPalette 的 fuzzyScore 做文件名模糊匹配；Enter 打开、↑↓ 导航、Esc 关闭。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from '../commandPalette';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useSettingsStore } from '../state/settingsStore';

const STRINGS = {
  zh: { placeholder: '输入文件名打开…', empty: '无匹配文件' },
  en: { placeholder: 'Type a file name to open…', empty: 'No matching files' },
} as const;

/** 全局触发判定：Ctrl/Cmd+P 打开快速打开（导出便于单测与 App 复用） */
export function isQuickOpenTrigger(e: { metaKey?: boolean; ctrlKey?: boolean; key: string }): boolean {
  return (e.metaKey === true || e.ctrlKey === true) && e.key.toLowerCase() === 'p';
}

export function QuickOpen({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const files = useWorkspaceStore((s) => s.files);
  const openFile = useWorkspaceStore((s) => s.openFile);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const L = STRINGS[language];

  const results = useMemo(
    () =>
      Object.keys(files)
        .map((path) => ({ path, s: fuzzyScore(query, path) }))
        .filter((r) => r.s >= 0)
        .sort((a, b) => b.s - a.s || a.path.localeCompare(b.path))
        .map((r) => r.path),
    [files, query],
  );

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const path = results[active];
        if (path) {
          openFile(path);
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [results, active, onClose, openFile]);

  const open = (path: string) => {
    openFile(path);
    onClose();
  };

  return (
    <div className="sf-quickopen-overlay" onMouseDown={onClose}>
      <div className="sf-quickopen" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="sf-quickopen-input"
          placeholder={L.placeholder}
          value={query}
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
        />
        <ul className="sf-quickopen-list">
          {results.map((path, i) => (
            <li
              key={path}
              className={`sf-quickopen-item ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => open(path)}
            >
              <span>{path.split('/').pop()}</span>
              <span className="sf-quickopen-path">{path}</span>
            </li>
          ))}
          {results.length === 0 && <li className="sf-quickopen-empty">{L.empty}</li>}
        </ul>
      </div>
    </div>
  );
}
