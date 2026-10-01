/**
 * 欢迎导览（WelcomeTour）：新用户第一次启动的全屏 4 页 carousel。
 *  - 遮罩走 sf-dialog-overlay 风格 + 居中 sf-dialog 卡片（复用既有类 + 内联样式，不新增 CSS）；
 *  - 页 1-3 为产品页（定位 / 写作与编译 / AI 深度参与），配 docs/screenshots 截图；
 *    页 4 为「三步上手」：开始使用（完成）/ 先看看（稍后）；
 *  - 交互：页码指示点可点、左右方向键翻页、Esc/遮罩=稍后（dismissTour：24h 内不再弹，
 *    下次启动再弹直到完成或点「开始使用」）；「跳过引导」= 永久跳过（skipTour）；
 *  - 亮暗主题跟随 CSS 变量；zh/en 文案走全局 i18n（tour.* 键）。
 * 可见性由 App 首屏 effect 判定 shouldShowTour() 后挂载；onClose 仅负责卸载。
 */

import { useCallback, useEffect, useState, type CSSProperties, type MouseEvent } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useT } from '../i18n';
import { useOnboardingStore } from '../state/onboardingStore';

const PAGE_COUNT = 4;

/** 页 1-3 的截图（public/docs/screenshots，vite 构建时随 public 目录拷贝进产物） */
const SHOTS: readonly { src: string; altKey: string }[] = [
  { src: 'docs/screenshots/writing.png', altKey: 'tour.imgAlt.writing' },
  { src: 'docs/screenshots/outline.png', altKey: 'tour.imgAlt.outline' },
  { src: 'docs/screenshots/reviewer-sim.png', altKey: 'tour.imgAlt.reviewer' },
];

export function WelcomeTour({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [page, setPage] = useState(0);
  const isLast = page === PAGE_COUNT - 1;

  /** 稍后：本次会话卸载 + 24h 内不再弹（下次启动再弹，直到完成/跳过） */
  const dismiss = useCallback(() => {
    useOnboardingStore.getState().dismissTour();
    onClose();
  }, [onClose]);

  /** 完成（「开始使用」）：永久收口 */
  const finish = useCallback(() => {
    useOnboardingStore.getState().completeTour();
    onClose();
  }, [onClose]);

  /** 永久跳过 */
  const skip = useCallback(() => {
    useOnboardingStore.getState().skipTour();
    onClose();
  }, [onClose]);

  const go = useCallback((next: number) => {
    setPage(Math.max(0, Math.min(PAGE_COUNT - 1, next)));
  }, []);

  // 键盘：← → 翻页（首尾钳制），Esc = 稍后
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPage((p) => Math.min(p + 1, PAGE_COUNT - 1));
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setPage((p) => Math.max(p - 1, 0));
      } else if (e.key === 'Escape') {
        e.preventDefault();
        dismiss();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dismiss]);

  const stopMouseDown = (e: MouseEvent<HTMLDivElement>) => e.stopPropagation();

  const dotStyle = (active: boolean): CSSProperties => ({
    width: 8,
    height: 8,
    padding: 0,
    borderRadius: '50%',
    border: 'none',
    cursor: 'pointer',
    background: active ? 'var(--accent)' : 'var(--border-strong)',
  });

  return (
    <div
      className="sf-dialog-overlay sf-tour-overlay"
      onMouseDown={dismiss}
      data-testid="sf-tour-overlay"
    >
      <div
        className="sf-dialog sf-tour-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('tour.page1.title')}
        style={{ width: 660 }}
        onMouseDown={stopMouseDown}
      >
        <div
          className="sf-tour-head"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '8px 12px 0' }}
        >
          <button type="button" className="sf-link-btn sf-tour-skip" onClick={skip}>
            {t('tour.skip')}
          </button>
        </div>

        <div className="sf-dialog-body sf-tour-body" style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 4 }}>
          {page < SHOTS.length ? (
            <>
              <h3 className="sf-tour-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                {t(`tour.page${page + 1}.title`)}
              </h3>
              <p className="sf-tour-desc" style={{ margin: 0, color: 'var(--fg-1)', fontSize: 13, lineHeight: 1.6 }}>
                {t(`tour.page${page + 1}.desc`)}
              </p>
              <img
                className="sf-tour-shot"
                src={SHOTS[page]!.src}
                alt={t(SHOTS[page]!.altKey)}
                draggable={false}
                style={{
                  width: '100%',
                  maxHeight: '42vh',
                  objectFit: 'cover',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  background: 'var(--bg-3)',
                }}
              />
            </>
          ) : (
            <>
              <h3 className="sf-tour-title" style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
                {t('tour.page4.title')}
              </h3>
              <p className="sf-tour-desc" style={{ margin: 0, color: 'var(--fg-1)', fontSize: 13, lineHeight: 1.6 }}>
                {t('tour.page4.desc')}
              </p>
              <ol className="sf-tour-steps" style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[1, 2, 3].map((n) => (
                  <li
                    key={n}
                    className="sf-tour-step"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--bg-3)',
                    }}
                  >
                    <span
                      className="sf-tour-step-num"
                      style={{
                        flex: 'none',
                        width: 22,
                        height: 22,
                        borderRadius: '50%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        color: '#fff',
                        background: 'var(--accent)',
                      }}
                    >
                      {n}
                    </span>
                    <span>
                      <strong style={{ fontSize: 13 }}>{t(`tour.step${n}.title`)}</strong>
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--fg-1)' }}>{t(`tour.step${n}.desc`)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>

        <div
          className="sf-tour-foot"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px 14px',
            borderTop: '1px solid var(--border)',
          }}
        >
          <button
            type="button"
            className="sf-btn sf-tour-prev"
            onClick={() => go(page - 1)}
            disabled={page === 0}
            title={t('tour.prev')}
          >
            <ChevronLeft size={14} />
          </button>

          <div
            className="sf-tour-dots"
            role="tablist"
            aria-label={t('tour.pageOf', { n: page + 1, total: PAGE_COUNT })}
            style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'center' }}
          >
            {Array.from({ length: PAGE_COUNT }, (_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === page}
                aria-label={t('tour.pageOf', { n: i + 1, total: PAGE_COUNT })}
                className={`sf-tour-dot ${i === page ? 'active' : ''}`}
                style={dotStyle(i === page)}
                onClick={() => go(i)}
              />
            ))}
          </div>

          {isLast ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="sf-btn sf-tour-later" onClick={dismiss}>
                {t('tour.later')}
              </button>
              <button type="button" className="sf-btn primary sf-tour-start" onClick={finish}>
                {t('tour.start')}
              </button>
            </div>
          ) : (
            <button type="button" className="sf-btn primary sf-tour-next" onClick={() => go(page + 1)}>
              {t('tour.next')} <ChevronRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
