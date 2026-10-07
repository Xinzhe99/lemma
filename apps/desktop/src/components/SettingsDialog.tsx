/**
 * 设置对话框：模型服务（Provider CRUD + 激活）、外观（主题/语言）、关于。
 * Esc / 遮罩点击关闭。
 * 激活器 WS-Act：表单顶部「快速预设」下拉（一键填充 + 去获取 Key 链接）、
 * 底部「测试连接」按钮（保存前即可验证 BaseURL/Key/模型）。
 */

import { useEffect, useState } from 'react';
import { Check, Cpu, Globe2, Info, Palette, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useT } from '../i18n';
import { isCliAgentAvailable, tauriCliRunner } from '../cliAgent';
import { confirmDialog } from '../dialogs';
import {
  useSettingsStore,
  type ProviderConfig,
  type ProviderTier,
} from '../state/settingsStore';
import { PROVIDER_PRESETS, findPreset, matchPresetByBaseUrl } from '../providers/presets';
import { testProvider, type TestResult } from '../providers/connectionTest';

type DialogTab = 'providers' | 'appearance' | 'about';

interface ProviderForm {
  /** 编辑既有服务时携带 id；新建为 null */
  id: string | null;
  /** 当前选中的预设 id（'' 未选；'custom' 显式自定义；不持久化） */
  presetId: string;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  tier: ProviderTier;
}

const EMPTY_FORM: ProviderForm = {
  id: null,
  presetId: '',
  label: '',
  baseUrl: '',
  apiKey: '',
  model: '',
  tier: 'cheap',
};

// ---------------------------------------------------------------------------
// 激活器新增 UI 文案（zh/en 组件内字典；其余沿用全局 i18n）
// ---------------------------------------------------------------------------

interface ActivationDict {
  quickPreset: string;
  presetPlaceholder: string;
  custom: string;
  getKey: string;
  testConnection: string;
  testing: string;
  testOkNoModel: (ms: number) => string;
  testOkModel: (ms: number, model: string) => string;
  testFail: (err: string) => string;
}

const ACTIVATION: Record<'zh' | 'en', ActivationDict> = {
  zh: {
    quickPreset: '快速预设',
    presetPlaceholder: '选择服务商，一键填充…',
    custom: '自定义…',
    getKey: '去获取 Key ↗',
    testConnection: '测试连接',
    testing: '测试中…',
    testOkNoModel: (ms) => `✓ 连接正常 · ${ms}ms`,
    testOkModel: (ms, model) => `✓ 连接正常 · ${ms}ms · 模型 ${model} 可用`,
    testFail: (err) => `✗ ${err}`,
  },
  en: {
    quickPreset: 'Quick preset',
    presetPlaceholder: 'Pick a provider to autofill…',
    custom: 'Custom…',
    getKey: 'Get key ↗',
    testConnection: 'Test connection',
    testing: 'Testing…',
    testOkNoModel: (ms) => `✓ Connected · ${ms}ms`,
    testOkModel: (ms, model) => `✓ Connected · ${ms}ms · model ${model} available`,
    testFail: (err) => `✗ ${err}`,
  },
};

/** CLI 配置输入框样式（沿用 sf-input 视觉，但类名独立：SettingsDialog 零回归测试按类名断言） */
const CLI_INPUT_STYLE: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  padding: '4px 8px',
  fontSize: 12.5,
  background: 'var(--bg-0)',
};

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const theme = useSettingsStore((s) => s.theme);
  const speechLanguage = useSettingsStore((st) => st.speechLanguage);
  const setSpeechLanguage = (v: 'auto' | 'zh' | 'en' | undefined) =>
    useSettingsStore.setState({ speechLanguage: v });
  const language = useSettingsStore((s) => s.language);
  const embeddingModel = useSettingsStore((s) => s.embeddingModel);
  const setEmbeddingModel = useSettingsStore((s) => s.setEmbeddingModel);
  const agentEngine = useSettingsStore((s) => s.agentEngine);
  const setAgentEngine = useSettingsStore((s) => s.setAgentEngine);
  const enginePreference = useSettingsStore((s) => s.enginePreference);
  const setEnginePreference = useSettingsStore((s) => s.setEnginePreference);
  const livePreview = useSettingsStore((s) => s.livePreview);
  const setLivePreview = useSettingsStore((s) => s.setLivePreview);
  const cliAgent = useSettingsStore((s) => s.cliAgent);
  const setCliAgent = useSettingsStore((s) => s.setCliAgent);
  // v7.5.0：会话预算 + 会话亲和缓存
  const sessionBudgetTokens = useSettingsStore((s) => s.sessionBudgetTokens);
  const setSessionBudgetTokens = useSettingsStore((s) => s.setSessionBudgetTokens);
  const promptCacheKey = useSettingsStore((s) => s.promptCacheKey);
  const setPromptCacheKey = useSettingsStore((s) => s.setPromptCacheKey);
  const addProvider = useSettingsStore((s) => s.addProvider);
  const updateProvider = useSettingsStore((s) => s.updateProvider);
  const removeProvider = useSettingsStore((s) => s.removeProvider);
  const setActive = useSettingsStore((s) => s.setActive);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const [tab, setTab] = useState<DialogTab>('providers');
  const [cliTest, setCliTest] = useState<string | null>(null);
  const cliAvailable = isCliAgentAvailable();

  const probeCli = async (): Promise<void> => {
    setCliTest('…');
    try {
      const r = await tauriCliRunner.run(cliAgent.command.trim(), ['--version']);
      const ver = (r.stdout || r.stderr).trim().split('\n')[0]?.slice(0, 60) ?? '';
      setCliTest(r.code === 0 ? t('settings.cliTestOk', { v: ver || 'ok' }) : t('settings.cliTestFail', { e: `exit ${r.code}` }));
    } catch (e) {
      setCliTest(t('settings.cliTestFail', { e: e instanceof Error ? e.message : String(e) }));
    }
  };
  const [form, setForm] = useState<ProviderForm | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // 激活器 UI 文案（按当前语言）
  const L = ACTIVATION[language];

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
    setTestResult(null);
  };

  const startEdit = (p: ProviderConfig) => {
    setTestResult(null);
    setForm({
      id: p.id,
      // 按 baseUrl 反查预设：命中则回显（含「去获取 Key」链接），否则视为自定义
      presetId: matchPresetByBaseUrl(p.baseUrl)?.id ?? 'custom',
      label: p.label,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.model,
      tier: p.tier,
    });
  };

  /** 选预设：一键填 baseUrl + 默认模型 + 名称；'custom' 只切状态不覆盖已填内容 */
  const applyPreset = (id: string) => {
    setTestResult(null);
    setForm((f) => {
      if (!f) return f;
      if (id === 'custom') return { ...f, presetId: 'custom' };
      const p = findPreset(id);
      if (!p) return { ...f, presetId: '' };
      return { ...f, presetId: id, label: p.label, baseUrl: p.baseUrl, model: p.models[0] ?? f.model };
    });
  };

  /** 测试连接：用表单当前值（不必先保存）；loading 态防重复点击 */
  const runTest = async () => {
    if (!form || testing) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider({
        baseUrl: form.baseUrl,
        apiKey: form.apiKey,
        model: form.model.trim() || undefined,
      });
      setTestResult(result);
    } finally {
      setTesting(false);
    }
  };

  const testLine = testResult
    ? testResult.ok
      ? testResult.model
        ? L.testOkModel(testResult.latencyMs ?? 0, testResult.model)
        : L.testOkNoModel(testResult.latencyMs ?? 0)
      : L.testFail(testResult.error ?? '')
    : null;

  /** 删除确认走应用内对话框（Tauri WKWebView 下原生 confirm 静默失效） */
  const remove = async (p: ProviderConfig): Promise<void> => {
    if (await confirmDialog(`${t('settings.deleteConfirm')} (${p.label})`, t('settings.delete'))) {
      removeProvider(p.id);
    }
  };

  /** 当前表单选中的预设（未选/自定义为 null） */
  const formPreset = form && form.presetId !== '' && form.presetId !== 'custom' ? findPreset(form.presetId) ?? null : null;

  const field = (
    key: keyof Omit<ProviderForm, 'id' | 'presetId'>,
    label: string,
    value: string,
    type = 'text',
    placeholder?: string,
  ) => (
    <label className="sf-form-field">
      <span>{label}</span>
      <input
        className="sf-input"
        type={type}
        value={value}
        placeholder={placeholder}
        list={key === 'model' && formPreset ? 'sf-preset-models' : undefined}
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
                    <button className="sf-btn danger" onClick={() => void remove(p)}>
                      <Trash2 size={12} /> {t('settings.delete')}
                    </button>
                  </div>
                </div>
              ))}

              {form ? (
                <div className="sf-form">
                  {/* 快速预设：一键填充 + 去获取 Key 链接（激活器） */}
                  <label className="sf-form-field" style={{ gridColumn: '1 / -1' }}>
                    <span>
                      {L.quickPreset}
                      {formPreset?.keyUrl && (
                        <a
                          className="sf-link-btn"
                          href={formPreset.keyUrl}
                          target="_blank"
                          rel="noreferrer"
                          title={formPreset.keyUrl}
                        >
                          {L.getKey}
                        </a>
                      )}
                    </span>
                    <select className="sf-input" value={form.presetId} onChange={(e) => applyPreset(e.target.value)}>
                      <option value="">{L.presetPlaceholder}</option>
                      {PROVIDER_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                      <option value="custom">{L.custom}</option>
                    </select>
                    {formPreset && (
                      <small className="sf-agent-note" style={{ margin: 0 }}>
                        {language === 'en' && formPreset.noteEn ? formPreset.noteEn : formPreset.note}
                      </small>
                    )}
                  </label>
                  {formPreset && (
                    <datalist id="sf-preset-models">
                      {formPreset.models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                  {field('label', t('settings.field.label'), form.label)}
                  {field('baseUrl', t('settings.field.baseUrl'), form.baseUrl, 'text', 'https://api.deepseek.com/v1')}
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
                    <button
                      className="sf-btn"
                      onClick={() => void runTest()}
                      disabled={testing || !form.baseUrl.trim() || !form.apiKey.trim()}
                      title={t('settings.field.baseUrl') + ' + ' + t('settings.field.apiKey')}
                    >
                      {testing ? L.testing : L.testConnection}
                    </button>
                    <button className="sf-btn primary" onClick={saveForm}>
                      {t('settings.save')}
                    </button>
                    <button
                      className="sf-btn"
                      onClick={() => {
                        setForm(null);
                        setTestResult(null);
                      }}
                    >
                      {t('settings.cancel')}
                    </button>
                  </div>
                  {testLine && (
                    <p className="sf-agent-note" role="status" style={{ gridColumn: '1 / -1', margin: 0 }}>
                      {testLine}
                    </p>
                  )}
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

              {/* —— Agent 引擎选择 + CLI agent 桥（v1.5.0） —— */}
              <div className="sf-appearance-row sf-engine-row">
                <span>{t('settings.engine')}</span>
                <div className="sf-segment">
                  {(['auto', 'api', 'cli'] as const).map((e) => (
                    <button key={e} className={agentEngine === e ? 'active' : ''} onClick={() => setAgentEngine(e)}>
                      {t(`settings.engine.${e}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="sf-cli-block" style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Cpu size={12} />
                  <strong style={{ fontSize: 12.5 }}>{t('settings.cliTitle')}</strong>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, marginLeft: 'auto' }}>
                    <input
                      type="checkbox"
                      checked={cliAgent.enabled}
                      disabled={!cliAvailable}
                      onChange={(e) => setCliAgent({ enabled: e.target.checked })}
                    />
                    {t('settings.cliEnable')}
                  </label>
                </div>
                {!cliAvailable && <p style={{ margin: 0, fontSize: 11, color: 'var(--warn)' }}>{t('settings.cliUnavailable')}</p>}
                <div className="sf-cli-grid" style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-2)' }}>
                    <span>{t('settings.cliLabel')}</span>
                    <input className="sf-cli-input" style={CLI_INPUT_STYLE} value={cliAgent.label} onChange={(e) => setCliAgent({ label: e.target.value })} />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-2)' }}>
                    <span>{t('settings.cliCommand')}</span>
                    <input
                      className="sf-cli-input"
                      style={CLI_INPUT_STYLE}
                      value={cliAgent.command}
                      placeholder="codex"
                      onChange={(e) => setCliAgent({ command: e.target.value })}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4, fontSize: 11.5, color: 'var(--fg-2)', gridColumn: '1 / -1' }}>
                    <span>{t('settings.cliTemplate')}</span>
                    <input
                      className="sf-cli-input"
                      style={CLI_INPUT_STYLE}
                      value={cliAgent.argsTemplate}
                      placeholder="exec {prompt}"
                      onChange={(e) => setCliAgent({ argsTemplate: e.target.value })}
                    />
                  </label>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="sf-btn" disabled={!cliAvailable || !cliAgent.command.trim()} onClick={() => void probeCli()}>
                    {t('settings.cliTest')}
                  </button>
                  {cliTest && <span style={{ fontSize: 11.5 }}>{cliTest}</span>}
                </div>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-2)' }}>{t('settings.cliHint')}</p>

              {/* —— LaTeX 引擎 + 实时预览（v2.0.0） —— */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{t('settings.enginePreference')}</span>
                  <select
                    className="sf-cli-input"
                    style={CLI_INPUT_STYLE}
                    value={enginePreference}
                    onChange={(e) => setEnginePreference(e.target.value as typeof enginePreference)}
                  >
                    <option value="auto">{t('settings.engineAuto')}</option>
                    <option value="tectonic">Tectonic</option>
                    <option value="lualatex">LuaLaTeX</option>
                    <option value="xelatex">XeLaTeX</option>
                    <option value="pdflatex">pdfLaTeX</option>
                    <option value="latexmk">latexmk</option>
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{t('settings.livePreview')}</span>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                    <input type="checkbox" checked={livePreview} onChange={(e) => setLivePreview(e.target.checked)} />
                    {t('settings.livePreviewHint')}
                  </label>
                </div>
              </div>

              {/* —— Agent 会话（v7.5.0：token 预算 + 会话亲和缓存） —— */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12 }}>{t('settings.sessionBudget')}</span>
                  <input
                    className="sf-cli-input"
                    style={CLI_INPUT_STYLE}
                    type="number"
                    min={0}
                    step={1000}
                    value={sessionBudgetTokens}
                    onChange={(e) => setSessionBudgetTokens(Number(e.target.value))}
                  />
                </div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={promptCacheKey}
                    onChange={(e) => setPromptCacheKey(e.target.checked)}
                  />
                  {t('settings.promptCacheKey')}
                </label>
                <p style={{ margin: 0, fontSize: 11, color: 'var(--fg-2)' }}>{t('settings.promptCacheKeyHint')}</p>
              </div>
              </div>
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
                <span>{t('settings.speech')}</span>
                <div className="sf-segment">
                  <button className={speechLanguage === undefined ? 'active' : ''} onClick={() => setSpeechLanguage(undefined)}>
                    {t('settings.speech.off')}
                  </button>
                  <button className={speechLanguage === 'auto' ? 'active' : ''} onClick={() => setSpeechLanguage('auto')}>
                    {t('settings.speech.auto')}
                  </button>
                  <button className={speechLanguage === 'zh' ? 'active' : ''} onClick={() => setSpeechLanguage('zh')}>
                    {t('settings.speech.zh')}
                  </button>
                  <button className={speechLanguage === 'en' ? 'active' : ''} onClick={() => setSpeechLanguage('en')}>
                    {t('settings.speech.en')}
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
              <div className="sf-about-brand">Lemma</div>
              <div className="sf-about-version">v{__APP_VERSION__} · {t('app.codename')}</div>
              <p className="sf-about-desc">{t('about.desc')}</p>
              <p className="sf-about-doc">{t('about.designDoc')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
