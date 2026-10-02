/**
 * 协作补丁对话框（v1.5.0 B；LazyFeatureDialog 契约：export CollabMergeDialog({ onClose })）：
 *  - 发起协作：把当前 .tex 的「基线+我的改动」导出为 <file>.sfpatch（写入项目，
 *    用户经任意通道发给合作者）；
 *  - 合并补丁：选择收到的 .sfpatch → CRDT 合并到我的全文 → 走既有 diff 审批卡
 *    （写级门控不变，采纳自动快照）。
 * 协议：补丁携带双方共同基线 base + 补丁方全文；合并见 collabMerge.ts。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useProposalStore } from '../state/proposalStore';
import { applyCollabPatch, makePatchFile, COLLAB_PATCH_EXT } from '../collabMerge';

const STRINGS = {
  zh: {
    title: '协作补丁（CRDT 离线合并）',
    pickFile: '稿件文件',
    noTex: '项目中没有 .tex 文件',
    exportTitle: '发起协作',
    exportDesc: '把你的版本导出为补丁文件，发给持有同一基线版本的合作者（邮件/IM 任意通道）。',
    exportBtn: (f: string) => `导出 ${f}${COLLAB_PATCH_EXT}`,
    exported: (f: string) => `已写入项目：${f}${COLLAB_PATCH_EXT}（文件树可见，发送给合作者即可）`,
    mergeTitle: '合并收到的补丁',
    mergeDesc: '选择合作者发来的 .sfpatch：双方改动 CRDT 自动融合（无行级冲突），结果经 diff 审批后落稿。',
    pick: '选择 .sfpatch 文件',
    merged: '已生成合并提案：请到右侧 Agent 面板的 diff 审批卡裁决（采纳自动创建快照）',
    mergeErr: (e: string) => `合并失败：${e}`,
    unchanged: '双方内容一致，无需合并',
    from: (a: string, t: string) => `补丁来源：${a || '未知'}${t ? ` · ${t}` : ''}`,
    close: '关闭',
  },
  en: {
    title: 'Collab patch (offline CRDT merge)',
    pickFile: 'Manuscript file',
    noTex: 'No .tex file in this project',
    exportTitle: 'Start collaboration',
    exportDesc: 'Export your version as a patch file and send it to your co-author (email/IM, any channel).',
    exportBtn: (f: string) => `Export ${f}${COLLAB_PATCH_EXT}`,
    exported: (f: string) => `Written to project: ${f}${COLLAB_PATCH_EXT} (see file tree; send it to your co-author)`,
    mergeTitle: 'Merge an incoming patch',
    mergeDesc: 'Pick a .sfpatch from your co-author: both sides merge via CRDT (no line conflicts); the result goes through the diff approval card.',
    pick: 'Choose .sfpatch file',
    merged: 'Merge proposal created: approve it in the diff card on the Agent panel (auto-snapshot on accept)',
    mergeErr: (e: string) => `Merge failed: ${e}`,
    unchanged: 'Both sides identical — nothing to merge',
    from: (a: string, t: string) => `From: ${a || 'unknown'}${t ? ` · ${t}` : ''}`,
    close: 'Close',
  },
} as const;

function fmtTime(ts: number | undefined): string {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function CollabMergeDialog({ onClose }: { onClose: () => void }) {
  const language = useSettingsStore((s) => s.language);
  const L = STRINGS[language] as (typeof STRINGS)[Language];

  const files = useWorkspaceStore((s) => s.files);
  const activeTab = useWorkspaceStore((s) => s.activeTab);
  const createFile = useWorkspaceStore((s) => s.createFile);
  const setProposal = useProposalStore((s) => s.setProposal);

  const texFiles = useMemo(() => Object.keys(files).filter((f) => f.endsWith('.tex')).sort(), [files]);
  const [file, setFile] = useState(activeTab && activeTab.endsWith('.tex') ? activeTab : (texFiles[0] ?? ''));
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const exportPatch = (): void => {
    if (!file) return;
    const content = files[file] ?? '';
    const patchFile = `${file}${COLLAB_PATCH_EXT}`;
    // 新文件必须走 createFile（updateFile 对不存在的路径是 no-op）
    createFile(patchFile, makePatchFile(content, content, { file, author: 'me', at: Date.now() }));
    setNote({ ok: true, text: L.exported(file) });
  };

  const readPatch = (picked: File): void => {
    if (!file) return;
    void picked.text().then((content) => {
      try {
        const myText = files[file] ?? '';
        const { merged, meta } = applyCollabPatch(myText, content);
        if (merged === myText) {
          setNote({ ok: true, text: L.unchanged });
          return;
        }
        setProposal({
          file,
          before: myText,
          after: merged,
          kind: 'tool-edit',
          label: `合并协作者补丁（CRDT）${meta.author ? ` · ${meta.author}` : ''}`,
          via: 'CRDT merge',
        });
        setNote({ ok: true, text: L.merged });
      } catch (e) {
        setNote({ ok: false, text: L.mergeErr(e instanceof Error ? e.message : String(e)) });
      }
    });
  };

  const section: React.CSSProperties = { marginTop: 14 };

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" style={{ minWidth: 520 }} onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <strong>{L.title}</strong>
          {texFiles.length > 0 && (
            <select className="sf-input" style={{ width: 200 }} value={file} onChange={(e) => setFile(e.target.value)}>
              {texFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </header>
        <div className="sf-dialog-body">
          {texFiles.length === 0 ? (
            <p style={{ color: 'var(--fg-2)' }}>{L.noTex}</p>
          ) : (
            <>
              <section style={section}>
                <strong style={{ fontSize: 12.5 }}>{L.exportTitle}</strong>
                <p style={{ margin: '4px 0 8px', fontSize: 11.5, color: 'var(--fg-2)' }}>{L.exportDesc}</p>
                <button className="sf-btn" onClick={exportPatch}>
                  {L.exportBtn(file)}
                </button>
              </section>

              <section style={section}>
                <strong style={{ fontSize: 12.5 }}>{L.mergeTitle}</strong>
                <p style={{ margin: '4px 0 8px', fontSize: 11.5, color: 'var(--fg-2)' }}>{L.mergeDesc}</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".sfpatch,application/json,text/plain"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const picked = e.target.files?.[0];
                    if (picked) readPatch(picked);
                    e.target.value = '';
                  }}
                />
                <button className="sf-btn" onClick={() => fileInput.current?.click()}>
                  {L.pick}
                </button>
              </section>

              {note && (
                <p style={{ marginTop: 12, fontSize: 12, color: note.ok ? 'var(--ok)' : 'var(--err)' }}>{note.text}</p>
              )}
            </>
          )}
        </div>
        <footer className="sf-lib-dialog-actions" style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="sf-btn dim" onClick={onClose}>
            {L.close}
          </button>
        </footer>
      </div>
    </div>
  );
}
