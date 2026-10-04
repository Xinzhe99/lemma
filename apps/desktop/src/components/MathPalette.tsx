/**
 * 数学符号面板（v3.3.0 ①）：分类展示 → 点击插入 LaTeX 命令到光标。
 * LazyFeatureDialog 契约：export function MathPaletteDialog({ onClose })。
 */

import { useEffect, useState } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import {
  MATH_SYMBOLS,
  MATH_CATEGORY_LABELS as CATEGORY_LABELS,
  type SymbolCategory,
} from '@lemma/editor';

const STRINGS = {
  zh: {
    title: '数学符号面板',
    hint: '点击符号插入到光标处',
    close: '关闭',
  },
  en: {
    title: 'Math symbol palette',
    hint: 'Click a symbol to insert at cursor',
    close: 'Close',
  },
} as const;

const CATEGORY_ORDER: SymbolCategory[] = [
  'greek-lower', 'greek-upper', 'operators', 'relations',
  'arrows', 'delimiters', 'big-ops', 'misc', 'templates',
];

export function MathPaletteDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const insert = (latex: string): void => {
    // 追加到当前 .tex 文件光标处（简化：追加到文件末尾附近由用户移动）
    // 更好的做法：通过 viewRef 精确插入，但 MathPalette 不持有 view 句柄。
    // 简化方案：追加到文件末尾前。
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) return;
    const before = ws.files[file] ?? '';
    const after = before.endsWith('\n') ? before + latex + '\n' : before + ' ' + latex;
    ws.updateFile(file, after);
    onClose();
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog"
        style={{ minWidth: 520, maxWidth: 620, maxHeight: '80vh', overflowY: 'auto' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
          <span style={{ fontSize: 11, color: 'var(--fg-2)' }}>{L.hint}</span>
        </header>
        <div className="sf-dialog-body">
          {CATEGORY_ORDER.map((cat) => (
            <section key={cat} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 4 }}>
                {CATEGORY_LABELS[cat][language]}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {MATH_SYMBOLS[cat].map((sym) => (
                  <button
                    key={sym.latex}
                    type="button"
                    title={`${sym.name} → ${sym.latex}`}
                    onClick={() => insert(sym.latex)}
                    style={{
                      minWidth: 36,
                      height: 32,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      background: 'var(--bg-0)',
                      cursor: 'pointer',
                      fontSize: sym.display.length > 3 ? 11 : 16,
                      fontFamily: 'serif',
                      padding: '0 6px',
                    }}
                  >
                    {sym.display}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        <footer style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 12px' }}>
          <button className="sf-btn dim" onClick={onClose}>
            {L.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
