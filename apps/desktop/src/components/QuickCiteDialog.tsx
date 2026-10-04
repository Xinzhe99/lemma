/**
 * 快速引用添加（v3.4.0 A）：粘贴 DOI / arXiv ID → 联网抓取 → 入库 → 返回 citekey。
 * LazyFeatureDialog 契约：export function QuickCiteDialog({ onClose })。
 */

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { searchCrossref, searchArxiv, type PaperSearchHit } from '@lemma/library';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useLibraryStore } from '../state/libraryStore';

const STRINGS = {
  zh: {
    title: '快速添加引用',
    desc: '粘贴 DOI 或 arXiv ID，自动抓取元数据并入库。返回编辑器输入 \\cite{ 即可补全。',
    placeholder: '10.1038/s41586-020-2649-2 或 2301.07041',
    add: '抓取并入库',
    busy: '抓取中…',
    ok: (key: string, title: string) => `✓ 已入库：${key}\n${title}`,
    fail: (err: string) => `✗ ${err}`,
    formatErr: '无法识别格式（需要 10.xxx/xxx 或 数字.数字 的 arXiv ID）',
    notFound: '未找到匹配的文献，请检查 ID 是否正确',
    close: '关闭',
  },
  en: {
    title: 'Quick add citation',
    desc: 'Paste a DOI or arXiv ID to fetch metadata and add to library.',
    placeholder: '10.1038/s41586-020-2649-2 or 2301.07041',
    add: 'Fetch & add',
    busy: 'Fetching…',
    ok: (key: string, title: string) => `✓ Added: ${key}\n${title}`,
    fail: (err: string) => `✗ ${err}`,
    formatErr: 'Cannot parse format (need 10.xxx/xxx or arXiv ID like 2301.07041)',
    notFound: 'No matching paper found. Check the ID.',
    close: 'Close',
  },
} as const;

function detectType(input: string): 'doi' | 'arxiv' | null {
  const t = input.trim();
  if (/^10\.\d{4,}\/\S+/.test(t)) return 'doi';
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(t)) return 'arxiv';
  return null;
}

export function QuickCiteDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];
  const importHit = useLibraryStore((s) => s.importHit);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; key?: string; text: string } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleAdd = async (): Promise<void> => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    const type = detectType(trimmed);
    if (!type) {
      setResult({ ok: false, text: L.formatErr });
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const http = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };
      const hits: PaperSearchHit[] = type === 'doi'
        ? await searchCrossref(trimmed, http, 1)
        : await searchArxiv(trimmed, http, 1);

      if (!hits || hits.length === 0) {
        setResult({ ok: false, text: L.notFound });
        return;
      }

      const hit = hits[0]!;
      const imported = importHit(hit);
      setResult({ ok: true, key: imported.citekey, text: L.ok(imported.citekey, hit.title) });
    } catch (e) {
      setResult({ ok: false, text: L.fail(e instanceof Error ? e.message : String(e)) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" style={{ minWidth: 480 }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>
            <Search size={13} /> {L.title}
          </strong>
        </header>
        <div className="sf-dialog-body">
          <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--fg-2)' }}>{L.desc}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              className="sf-input"
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 13 }}
              value={input}
              placeholder={L.placeholder}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAdd();
              }}
              autoFocus
            />
            <button className="sf-btn primary" disabled={busy || !input.trim()} onClick={() => void handleAdd()}>
              {busy ? L.busy : L.add}
            </button>
          </div>
          {result && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 10px',
                borderRadius: 6,
                background: result.ok ? 'color-mix(in srgb, var(--ok) 6%, var(--bg-0))' : 'color-mix(in srgb, var(--err) 6%, var(--bg-0))',
                border: `1px solid ${result.ok ? 'var(--ok)' : 'var(--err)'}`,
                fontSize: 12.5,
                color: result.ok ? 'var(--ok)' : 'var(--err)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {result.text}
              {result.ok && result.key && (
                <div style={{ marginTop: 6 }}>
                  <code
                    style={{
                      background: 'var(--bg-2)',
                      padding: '2px 8px',
                      borderRadius: 4,
                      fontSize: 13,
                      fontFamily: 'monospace',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      void navigator.clipboard.writeText(`\\cite{${result.key}}`);
                    }}
                    title="点击复制 \\cite 命令"
                  >
                    \\cite{'{'}{result.key}{'}'}  📋
                  </code>
                </div>
              )}
            </div>
          )}
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
