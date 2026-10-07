/**
 * 自动更新入口（v7.10 对齐 Codex）：**左下角浮动卡片**——
 *   available/downloading：紧凑卡片 + 下载进度条（静默后台下载，不可关闭）；
 *   downloaded：主行动卡片「新版本已就绪」+【立即更新并重启】/【稍后】——
 *     点击后安装 + 自动重启，重启后首屏提示「已更新，会话与项目状态已恢复」；
 *   error：仅手动检查失败显示（静默失败不展示）。
 * 浏览器形态（unsupported）与 idle/checking/up-to-date 不渲染任何内容。
 * dismissed 后本会话隐藏（phase 不变）。
 * 样式类 .sf-update-card-* 见全局 styles.css（明暗主题跟随 CSS 变量）。
 */

import { useState } from 'react';
import { useT } from '../i18n';
import { useUpdateStore } from '../state/updateStore';

export function UpdateBar() {
  const t = useT();
  const phase = useUpdateStore((s) => s.phase);
  const newVersion = useUpdateStore((s) => s.newVersion);
  const progress = useUpdateStore((s) => s.progress);
  const errorCode = useUpdateStore((s) => s.errorCode);
  const errorDetail = useUpdateStore((s) => s.errorDetail);
  const silent = useUpdateStore((s) => s.silent);
  const dismissed = useUpdateStore((s) => s.dismissed);
  const applyAndRestart = useUpdateStore((s) => s.applyAndRestart);
  const dismiss = useUpdateStore((s) => s.dismiss);
  const [restarting, setRestarting] = useState(false);

  if (dismissed) return null;
  if (phase === 'unsupported' || phase === 'idle' || phase === 'checking' || phase === 'up-to-date') {
    return null;
  }

  // 发现新版本 / 后台下载中：左下角紧凑卡片 + 进度条（静默下载，无需用户操作）
  if (phase === 'available' || phase === 'downloading') {
    return (
      <div className="sf-update-card" role="status">
        <div className="sf-update-card-title">{t('update.available', { version: newVersion ?? '' })}</div>
        <div
          className="sf-update-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress ?? undefined}
        >
          <div className="sf-update-progress-fill" style={{ width: `${progress ?? 8}%` }} />
        </div>
        <div className="sf-update-card-meta">
          {progress === undefined
            ? t('update.downloadingIndeterminate')
            : t('update.downloading', { percent: progress })}
        </div>
      </div>
    );
  }

  // 已就绪：主行动卡片——一键「立即更新并重启」（安装 + 自动重启 + 状态恢复）
  if (phase === 'downloaded') {
    const autoInstalled = useUpdateStore.getState().autoInstalled;
    return (
      <div className="sf-update-card ready" role="status">
        <div className="sf-update-card-title">
          {autoInstalled
            ? t('update.installed', { version: newVersion ?? '' })
            : t('update.ready', { version: newVersion ?? '' })}
        </div>
        <div className="sf-update-card-meta">{t('update.restoreHint')}</div>
        <div className="sf-update-actions">
          <button
            type="button"
            className="sf-update-btn-primary"
            disabled={restarting}
            onClick={() => {
              if (restarting) return;
              setRestarting(true);
              void applyAndRestart().finally(() => setRestarting(false));
            }}
          >
            {restarting ? t('update.restarting') : autoInstalled ? t('update.restartNow') : t('update.confirmUpdate')}
          </button>
          <button type="button" className="sf-update-btn-ghost" onClick={dismiss}>
            {t('update.later')}
          </button>
        </div>
      </div>
    );
  }

  // error：仅手动检查失败显示（静默检查失败 silent=true，不打扰）
  if (silent) return null;
  return (
    <div className="sf-update-card error" role="alert">
      <div className="sf-update-card-title error-title">{errorCode ? t(`update.error.${errorCode}`) : ''}</div>
      {errorDetail ? <div className="sf-update-card-meta error-detail">({errorDetail})</div> : null}
      <div className="sf-update-actions">
        <button type="button" className="sf-update-btn-ghost" onClick={dismiss}>
          {t('update.later')}
        </button>
      </div>
    </div>
  );
}
