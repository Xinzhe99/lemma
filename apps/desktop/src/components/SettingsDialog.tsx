/**
 * 设置对话框：模型服务（Provider CRUD + 激活）、外观（主题/语言）、关于。
 * Esc / 遮罩点击关闭。
 */

import { useEffect, useState } from 'react';
import { Check, Cpu, Globe2, Info, Palette, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useT } from '../i18n';
import {
  useSettingsStore,
  type ProviderConfig,
  type ProviderTier,
} from '../state/settingsStore';

type DialogTab = 'providers' | 'appearance' | 'about';

interface ProviderForm {
  /** 编辑既有服务时携带 id；新建为 null */
  id: string | null;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  tier: ProviderTier;
}

const EMPTY_FORM: ProviderForm = {
  id: null,
  label: '',
  baseUrl: 'https://api.example.com/v1',
  apiKey: '',
  model: '',
  tier: 'cheap',
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const embeddingModel = useSettingsStore((s) => s.embeddingModel);
  const setEmbeddingModel = useSettingsStore((s) => s.setEmbeddingModel);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const setActive = useSettingsStore((s) => s.setActive);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const [tab, setTab] = useState<DialogTab>('providers');
  const [form, setForm] = useState<ProviderForm | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveForm = () => {
    if (!form) return;
    const input = {
      label: form.label.trim() || t('settings.unnamedProvider'),
      baseUrl: form.baseUrl.trim(),
      apiKey: form.apiKey.trim(),
      model: form.model.trim(),
      tier: form.tier,
    };
    if (form.id) updateProvider(form.id, input);
    else addProvider(input);
    setForm(null);
  };

  const startEdit = (p: ProviderConfig) =>
    setForm({ id: p.id, label: p.label, baseUrl: p.baseUrl, apiKey: p.apiKey, model: p.model, tier: p.tier });

  const remove = (p: ProviderConfig) => {
    if (window.confirm(`${t('settings.deleteConfirm')} (${p.label})`)) removeProvider(p.id);
  };

  const field = (key: keyof Omit<ProviderForm, 'id'>, label: string, value: string, type = 'text') => (
    <label className="sf-form-field">
      <span>{label}</span>
      <input
        className="sf-input"
        type={type}
        value={value}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
      />
    </label>
  );

  return (
    <div className="sf-dialog-overlay" onMouseDown={onClose}>
      <div className="sf-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sf-dialog-header">
          <span>{t('settings.title')}</span>
          <button className="icon-btn" onClick={onClose} title={t('settings.cancel')}>
            <X size={16} />
          </button>
        </header>

        <nav className="sf-dialog-tabs">
          <button className={tab === 'providers' ? 'active' : ''} onClick={() => setTab('providers')}>
            <Cpu size={13} /> {t('settings.tab.providers')}
          </button>
          <button className={tab === 'appearance' ? 'active' : ''} onClick={() => setTab('appearance')}>
            <Palette size={13} /> {t('settings.tab.appearance')}
          </button>
          <button className={tab === 'about' ? 'active' : ''} onClick={() => setTab('about')}>
            <Info size={13} /> {t('settings.tab.about')}
          </button>
        </nav>

        <div className="sf-dialog-body">
          {tab === 'providers' && (
            <div className="sf-providers">
              {providers.length === 0 && !form && <p className="placeholder">{t('settings.empty')}</p>}
              {providers.map((p) => (
                <div key={p.id} className={`sf-provider-row ${p.id === activeProviderId ? 'active' : ''}`}>
                  <div className="sf-provider-main">
                    <span className="sf-provider-label">
                      {p.label} {p.id === activeProviderId && <em className="sf-chip ok">{t('settings.active')}</em>}
                    </span>
                    <span className="sf-provider-meta">
                      {p.model || '—'} · {p.tier === 'flagship' ? t('settings.tier.flagship') : t('settings.tier.cheap')} · {p.baseUrl || '—'}
                    </span>
                  </div>
                  <div className="sf-provider-actions">
                    {p.id !== activeProviderId && (
                      <button className="sf-btn" onClick={() => setActive(p.id)}>
                        <Check size={12} /> {t('settings.activate')}
                      </button>
                    )}
                    <button className="sf-btn" onClick={() => startEdit(p)}>
                      <Pencil size={12} /> {t('settings.edit')}
                    </button>
                    <button className="sf-btn danger" onClick={() => remove(p)}>
                      <Trash2 size={12} /> {t('settings.delete')}
                    </button>
                  </div>
                </div>
              ))}

              {form ? (
                <div className="sf-form">
                  {field('label', t('settings.field.label'), form.label)}
                  {field('baseUrl', t('settings.field.baseUrl'), form.baseUrl)}
                  {field('apiKey', t('settings.field.apiKey'), form.apiKey, 'password')}
                  {field('model', t('settings.field.model'), form.model)}
                  <label className="sf-form-field">
                    <span>{t('settings.field.tier')}</span>
                    <select
                      className="sf-input"
                      value={form.tier}
                      onChange={(e) => setForm((f) => (f ? { ...f, tier: e.target.value as ProviderTier } : f))}
                    >
                      <option value="cheap">{t('settings.tier.cheap')}</option>
                      <option value="flagship">{t('settings.tier.flagship')}</option>
                    </select>
                  </label>
                  <div className="sf-form-actions">
                    <button className="sf-btn primary" onClick={saveForm}>
                      {t('settings.save')}
                    </button>
                    <button className="sf-btn" onClick={() => setForm(null)}>
                      {t('settings.cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <button className="sf-btn primary" onClick={() => setForm({ ...EMPTY_FORM })}>
                  <Plus size={12} /> {t('settings.addProvider')}
                </button>
              )}

              <div className="sf-appearance-row sf-embedding-row">
                <span>{t('settings.embedding')}</span>
                <input
                  className="sf-input sf-embedding-input"
                  placeholder={t('settings.embeddingPlaceholder')}
                  value={embeddingModel}
                  onChange={(e) => setEmbeddingModel(e.target.value)}
                />
              </div>
              <p className="sf-embedding-hint">{t('settings.embeddingHint')}</p>
            </div>
          )}

          {tab === 'appearance' && (
            <div className="sf-appearance">
              <div className="sf-appearance-row">
                <span>{t('settings.theme')}</span>
                <div className="sf-segment">
                  <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>
                    {t('settings.theme.dark')}
                  </button>
                  <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>
                    {t('settings.theme.light')}
                  </button>
                </div>
              </div>
              <div className="sf-appearance-row">
                <span>{t('settings.language')}</span>
                <div className="sf-segment">
                  <button className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>
                    <Globe2 size={12} /> {t('settings.lang.zh')}
                  </button>
                  <button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>
                    <Globe2 size={12} /> {t('settings.lang.en')}
                  </button>
                </div>
              </div>
            </div>
          )}

          {tab === 'about' && (
            <div className="sf-about">
              <div className="sf-about-brand">ScholarForge</div>
              <div className="sf-about-version">v0.1.0 · {t('app.codename')}</div>
              <p className="sf-about-desc">{t('about.desc')}</p>
              <p className="sf-about-doc">{t('about.designDoc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
