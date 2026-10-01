/**
 * 顶部自动更新横幅（topbar 上方）：类 Codex/VSCode 的克制三段体验——
 *   available/downloading：灰色信息条（不可关闭，静默后台下载）；
 *   downloaded：主行动条「✓ 新版本已就绪 — 重启即可完成」+【立即重启】/【稍后】；
 *   error：仅手动检查失败显示（静默失败不展示），附【稍后】可关闭。
 * 浏览器形态（unsupported）与 idle/checking/up-to-date 不渲染任何内容。
 * dismissed 后本会话隐藏（phase 不变）。
 *
 * 样式走内联 + 全局 CSS 变量（styles.css 不归本工作流所有），
 * 亮暗主题经 var(--bg-1)/var(--btn-bg) 等自动跟随。
 */

import { useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { useUpdateStore } from '../state/updateStore';

/** 信息条 / 行动条共用的细横幅外壳（hairline 边框、单行、不弹窗）。 */
function shell(backgroundColor: string, borderColor: string): CSSProperties {
  return {
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 30,
    padding: '3px 12px',
    backgroundColor,
    borderBottom: `1px solid ${borderColor}`,
    fontSize: 12,
    color: 'var(--fg-1)',
  };
}

const primaryBtn: CSSProperties = {
  background: 'var(--btn-bg)',
  color: 'var(--btn-fg)',
  border: 'none',
  borderRadius: 999,
  padding: '3px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const laterBtn: CSSProperties = {
  background: 'transparent',
  color: 'var(--fg-1)',
  border: 'none',
  padding: '3px 4px',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline',
  textDecorationColor: 'var(--border-strong)',
};

export function UpdateBar() {
  const t = useT();
  const phase = useUpdateStore((s) => s.phase);
  const newVersion = useUpdateStore((s) => s.newVersion);
  const progress = useUpdateStore((s) => s.progress);
  const error = useUpdateStore((s) => s.error);
  const silent = useUpdateStore((s) => s.silent);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const applyAndRestart = useUpdateStore((s) => s.applyAndRestart);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const [restarting, setRestarting] = useState(false);

  if (dismissed) return null;
  if (phase === 'unsupported' || phase === 'idle' || phase === 'checking' || phase === 'up-to-date') {
    return null;
  }

  // 发现新版本 / 后台下载中：灰色信息条，不可关闭
  if (phase === 'available' || phase === 'downloading') {
    return (
      <div className="sf-updatebar sf-updatebar-info" role="status" style={shell('var(--bg-1)', 'var(--border)')}>
        <span>{t('update.available', { version: newVersion ?? '' })}</span>
        <span aria-hidden>·</span>
        <span>
          {progress === undefined
            ? t('update.downloadingIndeterminate')
            : t('update.downloading', { percent: progress })}
        </span>
      </div>
    );
  }

  // 已就绪：主行动条（一条细横幅，不弹窗）
  if (phase === 'downloaded') {
    return (
      <div
        className="sf-updatebar sf-updatebar-ready"
        role="status"
        style={shell('var(--accent)', 'var(--accent-dim)')}
      >
        <span style={{ color: '#ffffff', fontWeight: 550 }}>
          {t('update.ready', { version: newVersion ?? '' })}
        </span>
        <button
          type="button"
          style={primaryBtn}
          disabled={restarting}
          onClick={() => {
            if (restarting) return;
            setRestarting(true);
            void applyAndRestart().finally(() => setRestarting(false));
          }}
        >
          {restarting ? t('update.restarting') : t('update.restart')}
        </button>
        <button type="button" style={laterBtn} onClick={dismiss}>
          {t('update.later')}
        </button>
      </div>
    );
  }

  // error：仅手动检查失败显示（静默检查失败 silent=true，不打扰）
  if (silent) return null;
  return (
    <div className="sf-updatebar sf-updatebar-error" role="alert" style={shell('#fdf3f2', 'var(--err)')}>
      <span style={{ color: 'var(--err)' }}>{error}</span>
      <button type="button" style={laterBtn} onClick={dismiss}>
        {t('update.later')}
      </button>
    </div>
  );
}
