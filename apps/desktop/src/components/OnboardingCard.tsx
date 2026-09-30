/**
 * 首启引导卡：三步跑通第一条工作流（导入项目 / 编译 / 问 Agent）。
 * 「不再显示」写入 localStorage（sf-onboarding-dismissed），此后不再出现。
 */

import { useState } from 'react';
import { FileArchive, MessageSquare, Play, X } from 'lucide-react';
import { useT } from '../i18n';
import { runCompile } from '../compileAction';
import { sendChatMessage } from '../aiActions';
import { useUiStore } from '../state/uiStore';

const DISMISS_KEY = 'sf-onboarding-dismissed';

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISS_KEY, '1');
  } catch {
    /* 隐私模式等写入失败：仅本次会话隐藏 */
  }
}

export function OnboardingCard() {
  const t = useT();
  const [hidden, setHidden] = useState(readDismissed);
  const requestZipPicker = useUiStore((s) => s.requestZipPicker);
  const setTemplateWizardOpen = useUiStore((s) => s.setTemplateWizardOpen);

  if (hidden) return null;

  const dismiss = () => {
    writeDismissed();
    setHidden(true);
  };

  return (
    <div className="sf-onboarding">
      <div className="sf-onboarding-head">
        <div>
          <strong>{t('onboarding.title')}</strong>
          <p>{t('onboarding.subtitle')}</p>
        </div>
        <button className="icon-btn" onClick={dismiss} title={t('onboarding.dismiss')} aria-label={t('onboarding.dismiss')}>
          <X size={14} />
        </button>
      </div>

      <ol className="sf-onboarding-steps">
        <li className="sf-onboarding-step">
          <span className="sf-onboarding-step-icon">
            <FileArchive size={14} />
          </span>
          <div className="sf-onboarding-step-main">
            <span className="sf-onboarding-step-title">{t('onboarding.stepImport')}</span>
            <span className="sf-onboarding-step-desc">{t('onboarding.stepImportDesc')}</span>
          </div>
          <div className="sf-onboarding-step-actions">
            <button className="sf-btn" onClick={requestZipPicker}>
              {t('onboarding.stepImportBtn')}
            </button>
            <button className="sf-link-btn" onClick={() => setTemplateWizardOpen(true)}>
              {t('onboarding.stepImportAlt')}
            </button>
          </div>
        </li>

        <li className="sf-onboarding-step">
          <span className="sf-onboarding-step-icon">
            <Play size={14} />
          </span>
          <div className="sf-onboarding-step-main">
            <span className="sf-onboarding-step-title">{t('onboarding.stepCompile')}</span>
            <span className="sf-onboarding-step-desc">{t('onboarding.stepCompileDesc')}</span>
          </div>
          <div className="sf-onboarding-step-actions">
            <button className="sf-btn" onClick={() => void runCompile()}>
              {t('onboarding.stepCompileBtn')}
            </button>
          </div>
        </li>

        <li className="sf-onboarding-step">
          <span className="sf-onboarding-step-icon">
            <MessageSquare size={14} />
          </span>
          <div className="sf-onboarding-step-main">
            <span className="sf-onboarding-step-title">{t('onboarding.stepAgent')}</span>
            <span className="sf-onboarding-step-desc">{t('onboarding.stepAgentDesc')}</span>
          </div>
          <div className="sf-onboarding-step-actions">
            <button
              className="sf-btn"
              onClick={() => void sendChatMessage(t('onboarding.agentSampleQuestion'))}
            >
              {t('onboarding.stepAgentBtn')}
            </button>
          </div>
        </li>
      </ol>
    </div>
  );
}
