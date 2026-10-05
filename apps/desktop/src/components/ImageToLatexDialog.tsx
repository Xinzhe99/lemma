/**
 * 图像转 LaTeX 对话框（v5.2.0 C，借鉴 Prism「图像转代码」）：
 * 粘贴（Ctrl+V）/ 拖拽 / 选择公式或表格截图 → 视觉模型转 LaTeX → 预览可编辑
 * → 「插入到稿件」走 diff 审批卡。
 */
import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { fileToDataUrl, imageToLatex } from '../visionConvert';
import { useProposalStore } from '../state/proposalStore';
import { useWorkspaceStore } from '../state/workspaceStore';

type Kind = 'auto' | 'formula' | 'table';

export function ImageToLatexDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [image, setImage] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('auto');
  const [busy, setBusy] = useState(false);
  const [latex, setLatex] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const setProposal = useProposalStore((s) => s.setProposal);

  // 全局粘贴监听：对话框开着时 Ctrl+V 直接收图
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      void fileToDataUrl(file).then(setImage).catch(() => setError('读取剪贴板图片失败'));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  const onFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setError('');
    try {
      setImage(await fileToDataUrl(file));
    } catch {
      setError('读取图片失败');
    }
  };

  const onConvert = async () => {
    if (!image || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await imageToLatex(image, kind);
      if (r.ok && r.latex) setLatex(r.latex);
      else setError(r.error ?? '转换失败');
    } finally {
      setBusy(false);
    }
  };

  const onInsert = () => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) {
      setError('没有打开的 .tex 文件——请先在右侧「编辑器」模式打开目标文件');
      return;
    }
    if (!latex.trim()) return;
    const before = ws.files[file] ?? '';
    const after = `${before.trimEnd()}\n${latex.trim()}\n`;
    setProposal({
      file,
      before,
      after,
      kind: 'draft-section',
      label: '图像转 LaTeX（截图 → 公式/表格）',
      via: 'vision',
    });
    onClose();
  };

  return (
    <div className="sf-dialog-overlay" role="dialog" aria-label="图像转 LaTeX">
      <div className="sf-dialog" style={{ width: 620, maxWidth: '92vw' }}>
        <h3>🖼 图像转 LaTeX</h3>
        <p className="dim" style={{ fontSize: 12 }}>
          粘贴（Ctrl+V）/ 拖拽 / 选择公式或表格截图，AI 转换为可插入的 LaTeX（需视觉模型，如 GLM-4V / gpt-4o / Qwen-VL）。
        </p>

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void onFiles(e.dataTransfer.files);
          }}
          onClick={() => fileRef.current?.click()}
          style={{
            border: '1px dashed var(--border)',
            borderRadius: 8,
            padding: 12,
            minHeight: 120,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            background: 'var(--bg-0)',
          }}
        >
          {image ? (
            <img src={image} alt="待转换截图" style={{ maxWidth: '100%', maxHeight: 220 }} />
          ) : (
            <span className="dim" style={{ fontSize: 12 }}>
              点击选择图片，或直接 Ctrl+V 粘贴截图
            </span>
          )}
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = '';
          }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
          <select
            className="sf-cli-input"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}
          >
            <option value="auto">自动识别</option>
            <option value="formula">数学公式</option>
            <option value="table">表格</option>
          </select>
          <button
            type="button"
            className="sf-btn primary"
            disabled={!image || busy}
            onClick={() => void onConvert()}
          >
            {busy ? '转换中…' : '转换为 LaTeX'}
          </button>
          {image ? (
            <button type="button" className="sf-link-btn" onClick={() => { setImage(null); setLatex(''); }}>
              清除图片
            </button>
          ) : null}
        </div>

        {error ? (
          <div className="sf-agent-note" style={{ color: 'var(--err)', marginTop: 8 }}>
            {error}
          </div>
        ) : null}

        {latex ? (
          <>
            <div className="dim" style={{ fontSize: 11, margin: '10px 0 4px' }}>
              转换结果（可编辑）：
            </div>
            <textarea
              value={latex}
              onChange={(e) => setLatex(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 110,
                fontFamily: 'var(--mono, monospace)',
                fontSize: 12,
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 8,
                background: 'var(--bg-0)',
                color: 'var(--fg-0)',
                resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="sf-link-btn" onClick={onClose}>
                {t('dlg.cancel')}
              </button>
              <button type="button" className="sf-btn primary" onClick={onInsert}>
                插入到稿件（走审批）
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
