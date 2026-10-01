/**
 * 外部版本对比对话框（命令 external.diff，研究生最高频协作动作：导师发回改过的 .tex）：
 * - 输入两态：拖入/选择一个或多个 .tex 文件，或「粘贴单个文件内容」tab（文件名 + 正文）；
 * - matchExternalFiles 对当前工作区做三级匹配 → 三区展示：
 *   匹配文件列表（点击切换 diff）、仅外部（可「添加为新文件」）、统计「N 匹配 · M 新增」；
 * - 选中匹配文件 → DiffView（before=当前工作区版本，after=外部版本），操作：
 *   「采纳外部版本」（先 snapshotFile 再 updateFile，可随时在快照面板回滚）与「仅查看」；
 * - 全部条目处理完显示结果摘要（采纳/仅查看/新增计数）；zh/en 字典，不新增 CSS。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { DiffView } from '@scholarforge/editor';
import { matchExternalFiles, type ExternalMatch } from '../externalDiff';
import { useSettingsStore } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';

const STRINGS = {
  zh: {
    title: '对比外部版本（导师改稿 vs 当前稿）',
    tabFile: '选择 / 拖入 .tex',
    tabPaste: '粘贴单个文件',
    dropHint: '拖入导师发回的 .tex 文件（可多选）',
    chooseFiles: '选择文件',
    unsupported: '不支持的格式（仅 .tex）',
    pasteNameLabel: '文件名（可含目录，如 sections/intro.tex）',
    pasteNamePlaceholder: 'sections/intro.tex',
    pasteContentLabel: '外部文件内容',
    pastePlaceholder: '把导师改过的这一个文件内容粘贴到这里…',
    compare: '对比当前工作区',
    reset: '清空重选',
    sectionMatched: '匹配文件',
    sectionOnlyExternal: '仅外部（可新增）',
    sectionOnlyLocal: '仅本地（未参与对比）',
    statsChip: (n: number, m: number) => `${n} 匹配 · ${m} 新增`,
    addAsNew: '添加为新文件',
    adopt: '采纳外部版本',
    viewOnly: '仅查看',
    badgeAdopted: '已采纳',
    badgeViewed: '已查看',
    badgeAdded: '已新增',
    diffEmpty: '选择左侧匹配文件查看差异',
    summary: (a: number, v: number, d: number) => `已全部处理：采纳 ${a} · 仅查看 ${v} · 新增 ${d}`,
    close: '关闭',
    snapshotLabel: '采纳外部版本前',
  },
  en: {
    title: 'Compare external version (advisor edits vs current)',
    tabFile: 'Choose / drop .tex',
    tabPaste: 'Paste one file',
    dropHint: 'Drop the advisor’s .tex files (multiple allowed)',
    chooseFiles: 'Choose files',
    unsupported: 'Unsupported format (.tex only)',
    pasteNameLabel: 'File name (may include a folder, e.g. sections/intro.tex)',
    pasteNamePlaceholder: 'sections/intro.tex',
    pasteContentLabel: 'External file content',
    pastePlaceholder: 'Paste the single advisor-revised file here…',
    compare: 'Compare with workspace',
    reset: 'Reset',
    sectionMatched: 'Matched files',
    sectionOnlyExternal: 'External only (add as new)',
    sectionOnlyLocal: 'Local only (untouched)',
    statsChip: (n: number, m: number) => `${n} matched · ${m} new`,
    addAsNew: 'Add as new file',
    adopt: 'Adopt external version',
    viewOnly: 'View only',
    badgeAdopted: 'Adopted',
    badgeViewed: 'Viewed',
    badgeAdded: 'Added',
    diffEmpty: 'Select a matched file to view the diff',
    summary: (a: number, v: number, d: number) => `All processed: adopted ${a} · viewed ${v} · added ${d}`,
    close: 'Close',
    snapshotLabel: 'Before adopting external version',
  },
} as const;

type Language = keyof typeof STRINGS;
type Processed = 'adopted' | 'viewed' | 'added';

export function ExternalDiffDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language) === 'en' ? 'en' : 'zh';
  const L = STRINGS[language];

  const workspaceFiles = useWorkspaceStore((s) => s.files);

  const [tab, setTab] = useState<'file' | 'paste'>('file');
  const [externalFiles, setExternalFiles] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [processed, setProcessed] = useState<Record<string, Processed>>({});
  const [error, setError] = useState('');
  const [pasteName, setPasteName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = useMemo(() => matchExternalFiles(externalFiles, workspaceFiles), [
    externalFiles,
    workspaceFiles,
  ]);
  const matched = matches.filter((m) => m.status === 'matched');
  const onlyExternal = matches.filter((m) => m.status === 'only-external');
  const onlyLocal = matches.filter((m) => m.status === 'only-local');

  const handleFiles = async (list: FileList | File[]): Promise<void> => {
    const files = Array.from(list);
    if (files.length === 0) return;
    const next: Record<string, string> = { ...externalFiles };
    const errors: string[] = [];
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith('.tex')) {
        errors.push(`${file.name}：${L.unsupported}`);
        continue;
      }
      next[file.name] = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    }
    setExternalFiles(next);
    setError(errors.join('\n'));
  };

  const handleComparePaste = (): void => {
    const name = pasteName.trim();
    if (!name || !pasteText.trim()) return;
    const key = name.toLowerCase().endsWith('.tex') ? name : `${name}.tex`;
    setExternalFiles({ ...externalFiles, [key]: pasteText });
    setError('');
  };

  const reset = (): void => {
    setExternalFiles({});
    setProcessed({});
    setSelected(null);
    setError('');
  };

  const badgeOf = (key: string): string | null => {
    const p = processed[key];
    if (p === 'adopted') return L.badgeAdopted;
    if (p === 'viewed') return L.badgeViewed;
    if (p === 'added') return L.badgeAdded;
    return null;
  };

  const handleAdopt = (m: ExternalMatch): void => {
    const ws = useWorkspaceStore.getState();
    const content = externalFiles[m.external!];
    if (content === undefined) return;
    // 先快照再覆盖：采纳外部版本前留一份可回滚的当前稿（设计 4.8 版本控制）
    ws.snapshotFile(m.file, L.snapshotLabel);
    ws.updateFile(m.file, content);
    setProcessed((prev) => ({ ...prev, [m.file]: 'adopted' }));
  };

  const handleViewOnly = (m: ExternalMatch): void => {
    setProcessed((prev) => ({ ...prev, [m.file]: 'viewed' }));
  };

  const handleAddNew = (m: ExternalMatch): void => {
    useWorkspaceStore.getState().createFile(m.file, externalFiles[m.file] ?? '');
    setProcessed((prev) => ({ ...prev, [m.file]: 'added' }));
  };

  const selectedMatch = matched.find((m) => m.file === selected) ?? null;

  const counts = { adopted: 0, viewed: 0, added: 0 } as Record<Processed, number>;
  for (const p of Object.values(processed)) counts[p]++;

  const actionable = matched.length + onlyExternal.length;
  const allDone = actionable > 0 && Object.keys(processed).length >= actionable;

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div
        className="sf-dialog"
        style={{ width: 860, maxWidth: '94vw' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
          {externalFiles && Object.keys(externalFiles).length > 0 && (
            <button className="sf-btn" style={{ marginLeft: 'auto' }} onClick={reset}>
              {L.reset}
            </button>
          )}
        </header>
        <nav className="sf-dialog-tabs">
          <button type="button" className={tab === 'file' ? 'active' : undefined} onClick={() => setTab('file')}>
            {L.tabFile}
          </button>
          <button type="button" className={tab === 'paste' ? 'active' : undefined} onClick={() => setTab('paste')}>
            {L.tabPaste}
          </button>
        </nav>
        <div className="sf-dialog-body">
          {tab === 'file' ? (
            <div
              role="region"
              aria-label={L.tabFile}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fs = e.dataTransfer?.files;
                if (fs && fs.length > 0) void handleFiles(fs);
              }}
              style={{
                border: '1px dashed var(--border-strong)',
                borderRadius: 8,
                padding: 16,
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span style={{ color: 'var(--fg-2)', fontSize: 12 }}>{L.dropHint}</span>
              <button className="sf-btn" onClick={() => fileInputRef.current?.click()}>
                {L.chooseFiles}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".tex"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const fs = e.target.files;
                  if (fs && fs.length > 0) void handleFiles(fs);
                  e.target.value = ''; // 同一批文件可重复选择
                }}
              />
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.pasteNameLabel}</span>
                <input
                  className="sf-input"
                  aria-label={L.pasteNameLabel}
                  placeholder={L.pasteNamePlaceholder}
                  value={pasteName}
                  onChange={(e) => setPasteName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.pasteContentLabel}</span>
                <textarea
                  className="sf-input"
                  aria-label={L.pasteContentLabel}
                  placeholder={L.pastePlaceholder}
                  rows={6}
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }}
                />
              </label>
              <div>
                <button
                  className="sf-btn"
                  onClick={handleComparePaste}
                  disabled={!pasteName.trim() || !pasteText.trim()}
                >
                  {L.compare}
                </button>
              </div>
            </div>
          )}

          {error && (
            <p role="alert" style={{ whiteSpace: 'pre-line', color: 'var(--danger, #c0392b)', margin: '8px 0 0' }}>
              {error}
            </p>
          )}

          {Object.keys(externalFiles).length > 0 && (
            <section style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <strong className="sf-extdiff-stats">{L.statsChip(matched.length, onlyExternal.length)}</strong>
                {allDone && (
                  <span role="status" style={{ color: 'var(--fg-2)', fontSize: 12 }}>
                    {L.summary(counts.adopted, counts.viewed, counts.added)}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div aria-label={L.sectionMatched} style={{ fontWeight: 600, fontSize: 13 }}>
                    {L.sectionMatched}
                  </div>
                  {matched.map((m) => (
                    <div key={m.file} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button
                        className="sf-btn"
                        style={selected === m.file ? { fontWeight: 700 } : undefined}
                        onClick={() => setSelected(m.file)}
                      >
                        {m.file}
                      </button>
                      {badgeOf(m.file) && (
                        <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{badgeOf(m.file)}</span>
                      )}
                    </div>
                  ))}
                  {matched.length === 0 && (
                    <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.diffEmpty}</span>
                  )}

                  <div aria-label={L.sectionOnlyExternal} style={{ fontWeight: 600, fontSize: 13, marginTop: 8 }}>
                    {L.sectionOnlyExternal}
                  </div>
                  {onlyExternal.map((m) => (
                    <div key={m.file} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 13 }}>{m.file}</span>
                      <button
                        className="sf-btn"
                        onClick={() => handleAddNew(m)}
                        disabled={processed[m.file] === 'added'}
                      >
                        {processed[m.file] === 'added' ? L.badgeAdded : L.addAsNew}
                      </button>
                    </div>
                  ))}

                  {onlyLocal.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--fg-2)', marginTop: 8 }}>
                      {L.sectionOnlyLocal}：{onlyLocal.map((m) => m.file).join('、')}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 200 }}>
                  {selectedMatch ? (
                    <>
                      <div style={{ height: 260, border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                        <DiffView
                          before={workspaceFiles[selectedMatch.file] ?? ''}
                          after={externalFiles[selectedMatch.external!] ?? ''}
                          filename={selectedMatch.file}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          className="sf-btn primary"
                          onClick={() => handleAdopt(selectedMatch)}
                          disabled={processed[selectedMatch.file] === 'adopted'}
                        >
                          {L.adopt}
                        </button>
                        <button className="sf-btn" onClick={() => handleViewOnly(selectedMatch)}>
                          {L.viewOnly}
                        </button>
                      </div>
                    </>
                  ) : (
                    <span style={{ fontSize: 12, color: 'var(--fg-2)' }}>{L.diffEmpty}</span>
                  )}
                </div>
              </div>
            </section>
          )}

          <div
            style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}
          >
            <button className="sf-btn" onClick={onClose}>
              {L.close}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
