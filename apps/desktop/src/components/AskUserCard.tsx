/**
 * AI 提问卡（v7.5.0）：user.ask 工具的 UI——问题 + 选项按钮 + 可选自由输入。
 * 与 DiffApprovalCard2 同区渲染（AgentPanel 的 AI 改稿区），作答后立即回传模型。
 */
import { useState } from 'react';
import type { Language } from '../state/settingsStore';
import type { PendingAsk } from '../userAsk';

const DICT: Record<Language, { title: string; customPlaceholder: string; submit: string }> = {
  zh: { title: 'AI 需要你拍板', customPlaceholder: '自由输入其他答案…', submit: '提交' },
  en: { title: 'AI needs your decision', customPlaceholder: 'Type another answer…', submit: 'Submit' },
};

export function AskUserCard({
  ask,
  lang,
  onAnswer,
}: {
  ask: PendingAsk;
  lang: Language;
  onAnswer: (token: string, answer: string) => void;
}) {
  const t = DICT[lang] ?? DICT.zh;
  const [custom, setCustom] = useState('');
  return (
    <div className="sf-ask-card" role="alertdialog" aria-label={t.title}>
      <p className="sf-ask-title">
        ❓ {t.title}
      </p>
      <p className="sf-ask-question">{ask.question}</p>
      {ask.options.length > 0 && (
        <div className="sf-ask-options">
          {ask.options.map((o) => (
            <button key={o.label} className="sf-btn sf-ask-option" onClick={() => onAnswer(ask.token, o.label)}>
              <span className="sf-ask-option-label">{o.label}</span>
              {o.description && <span className="sf-ask-option-desc">{o.description}</span>}
            </button>
          ))}
        </div>
      )}
      {ask.allowCustom && (
        <div className="sf-ask-custom">
          <input
            className="sf-input"
            placeholder={t.customPlaceholder}
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) onAnswer(ask.token, custom.trim());
            }}
          />
          <button className="sf-btn" disabled={!custom.trim()} onClick={() => onAnswer(ask.token, custom.trim())}>
            {t.submit}
          </button>
        </div>
      )}
    </div>
  );
}
