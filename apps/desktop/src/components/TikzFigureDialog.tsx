/**
 * AI 画图（v5.7.0 F2，对标 PapersFlow figure generation）：
 * 描述图 → AI 生成 TikZ 代码（可编辑）→ 桌面端编译 standalone 预览 →
 * 组装 figure 环境经 diff 审批插入稿件。浏览器形态无真实引擎，仅显代码。
 */
import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import { getPlatform } from '../platform/types';
import { useProposalStore } from '../state/proposalStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { runAgentTurn } from '../agentTools';
import { resolveProvider } from '../aiActions';
import { useAgentUsageStore } from '../state/agentUsage';

const PREVIEW_PREAMBLE = [
  '\\documentclass[border=4pt]{standalone}',
  '\\usepackage{tikz}',
  '\\usetikzlibrary{arrows.meta,positioning,shapes.geometric,calc,fit,backgrounds}',
  '\\begin{document}',
  '',
].join('\n');

export function TikzFigureDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const setProposal = useProposalStore((s) => s.setProposal);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onGenerate = async () => {
    if (!desc.trim() || busy) return;
    setBusy(true);
    setError('');
    const t0 = Date.now();
    try {
      const { real, provider, model } = resolveProvider();
      if (!real) {
        setError(t('tikz.demoMode'));
        return;
      }
      const reply = await runAgentTurn({
        provider,
        model,
        system:
          '你是 TikZ 专家。根据描述生成一段可直接编译的 tikzpicture 代码（不含 documentclass/\\begin{document}）。要求：节点/箭头风格简洁学术论文风；自动布局避免重叠；中文文本也可用。只输出 tikzpicture 代码本身（含 \\begin{tikzpicture}...\\end{tikzpicture}），不要解释、不要围栏。',
        history: [],
        user: desc.trim(),
      });
      const cleaned = reply
        .trim()
        .replace(/^```[a-zA-Z]*\n?/, '')
        .replace(/\n?```$/, '')
        .trim();
      try {
        useAgentUsageStore.getState().record({
          kind: 'tool',
          model,
          inputTokens: Math.ceil(desc.trim().length / 2),
          outputTokens: Math.ceil(cleaned.length / 2),
          latencyMs: Date.now() - t0,
        });
      } catch {
        /* 用量记录失败不影响画图 */
      }
      if (!cleaned.includes('tikzpicture')) {
        setError(t('tikz.noTikz'));
        return;
      }
      setCode(cleaned);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** 桌面端：编译 standalone 预览（复用编译物化目录与引擎探测链） */
  const onPreview = async () => {
    if (!code.trim() || previewing) return;
    setPreviewing(true);
    setError('');
    try {
      const fs = getPlatform().fs;
      const full = `${PREVIEW_PREAMBLE}${code.trim()}\n\\end{document}\n`;
      await fs.writeFile('sf-tikz-preview.tex', full);
      const { compileTexPreview } = await import('../compileAction');
      const result = await compileTexPreview('sf-tikz-preview.tex');
      if (!result.ok) {
        setError(t('tikz.previewFailed'));
        return;
      }
      // 不内嵌：编译成功后右侧预览区自动切到 sf-tikz-preview.pdf（原生查看器）
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewing(false);
    }
  };

  const onInsert = () => {
    const ws = useWorkspaceStore.getState();
    const file = ws.activeTab;
    if (!file || !file.endsWith('.tex')) {
      setError(t('tikz.noTexFile'));
      return;
    }
    if (!code.trim()) return;
    const before = ws.files[file] ?? '';
    const figure = [
      '\\begin{figure}[tb]',
      '  \\centering',
      code.trim()
        .split('\n')
        .map((l) => `  ${l}`)
        .join('\n'),
      `  \\caption{${desc.trim().slice(0, 60) || t('tikz.defaultCaption')}}`,
      '  \\label{fig:ai-generated}',
      '\\end{figure}',
    ].join('\n');
    const after = `${before.trimEnd()}\n\n${figure}\n`;
    setProposal({
      file,
      before,
      after,
      kind: 'draft-section',
      label: t('tikz.insertLabel'),
      via: 'tikz-figure',
    });
    onClose();
  };

  const desktop = typeof window !== 'undefined' && (window as unknown as { __TAURI__?: unknown }).__TAURI__ != null;

  return (
    <div
      className="sf-dialog-overlay"
      role="dialog"
      aria-label={t('tikz.dialogLabel')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sf-dialog" style={{ width: 640, maxWidth: '92vw' }}>
        <h3>{t('tikz.title')}</h3>
        <p className="dim" style={{ fontSize: 12 }}>
          {t('tikz.desc')}
        </p>

        <textarea
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t('tikz.placeholder')}
          style={{
            width: '100%',
            minHeight: 56,
            fontSize: 12.5,
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 8,
            background: 'var(--bg-0)',
            color: 'var(--fg-0)',
            resize: 'vertical',
          }}
        />

        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <button type="button" className="sf-btn primary" disabled={!desc.trim() || busy} onClick={() => void onGenerate()}>
            {busy ? t('tikz.generate') : t('tikz.generateBtn')}
          </button>
          {code ? (
            <>
              {desktop ? (
                <button type="button" className="sf-pill-btn" disabled={previewing} onClick={() => void onPreview()}>
                  {previewing ? t('tikz.preview') : t('tikz.previewBtn')}
                </button>
              ) : null}
              <button type="button" className="sf-pill-btn" onClick={onInsert}>
                {t('tikz.insert')}
              </button>
            </>
          ) : null}
        </div>

        {error ? (
          <div className="sf-agent-note" style={{ color: 'var(--err)', marginTop: 8 }}>
            {error}
          </div>
        ) : null}


        {code ? (
          <>
            <div className="dim" style={{ fontSize: 11, margin: '10px 0 4px' }}>
              {t('tikz.codeLabel')}
            </div>
            <textarea
              value={code}
              onChange={(e) => setCode(e.target.value)}
              spellCheck={false}
              style={{
                width: '100%',
                minHeight: 140,
                fontFamily: 'var(--mono, monospace)',
                fontSize: 11.5,
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: 8,
                background: 'var(--bg-0)',
                color: 'var(--fg-0)',
                resize: 'vertical',
              }}
            />
          </>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="sf-link-btn" onClick={onClose}>
            {t('dlg.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
