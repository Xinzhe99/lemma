/**
 * WF-1 投稿工作台（S1–S5）：
 * - 目标期刊/会议档案（submission/venues.ts）选择与全字段展示；
 * - 投稿 deadline 追踪：type=date 输入绑定 submitStore.deadline，
 *   deadlineCountdown 倒计时 chip（>14 天灰 / 3–14 天 warn / <3 天 err）；
 * - 投稿打包自检（@scholarforge/compile packagingChecklist）逐项 ✓/✗，
 *   全部通过才可 buildProjectZip 生成 zip 并触发浏览器下载；
 * - 「起草 Cover Letter (W11)」经 uiStore.launchWorkflow 预填 journal/highlights；
 * - 「起草 Related Work (W12)」同经 launchWorkflow 预填 topic（摘要前 200 字或 venue 名）/manuscript；
 * - 「导出 Word (.docx)」经 pandoc.exportDocx（内置 pandoc 自动下载/系统探测）转换并下载，
 *   含 loading/错误态（错误中文展示在自检卡片下方）；
 * - 期刊推荐（submission/recommend.ts）：库内发表去向 + 摘要 scope 重叠，可一键设为目标。
 * 壳层以动态 import 挂载：export function SubmitPanel()，无 props。
 * 文案为组件内自包含 zh/en 双语字典（读 settingsStore.language）。
 */

import { useMemo, useState } from 'react';
import { BookOpen, Check, FileArchive, FileText, Plus } from 'lucide-react';
import { buildProjectZip, packagingChecklist } from '@scholarforge/compile';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useUiStore } from '../state/uiStore';
import { deadlineCountdown, useSubmitStore } from '../state/submitStore';
import { exportDocx } from '../pandoc';
import { VENUE_PROFILES, venueById } from '../submission/venues';
import { extractAbstractFromTex, recommendVenues } from '../submission/recommend';
import './submit.css';

const STRINGS: Record<Language, {
  title: string;
  target: string;
  placeholder: string;
  noVenue: string;
  typeConference: string;
  typeJournal: string;
  fPageLimit: string;
  fTemplate: string;
  fAnonymity: string;
  fSupplementary: string;
  fAiPolicy: string;
  fNotes: string;
  deadlineTitle: string;
  deadlineLabel: string;
  coverLetter: string;
  relatedWork: string;
  checklistTitle: string;
  passedUnit: string;
  exportZip: string;
  exportBlocked: string;
  lastExport: string;
  exportDocx: string;
  exportingDocx: string;
  recTitle: string;
  recEmpty: string;
  setTarget: string;
  isTarget: string;
}> = {
  zh: {
    title: '投稿工作台',
    target: '目标期刊/会议',
    placeholder: '选择目标场所…',
    noVenue: '尚未选择目标场所。从上方下拉选择，或在下方推荐中「设为目标」。',
    typeConference: '会议',
    typeJournal: '期刊',
    fPageLimit: '页数上限',
    fTemplate: '模板',
    fAnonymity: '匿名规则',
    fSupplementary: '补充材料',
    fAiPolicy: 'AI 政策',
    fNotes: '备注',
    deadlineTitle: '投稿 Deadline',
    deadlineLabel: '投稿截止日期',
    coverLetter: '起草 Cover Letter (W11)',
    relatedWork: '起草 Related Work (W12)',
    checklistTitle: '投稿打包自检',
    passedUnit: '项通过',
    exportZip: '打包导出 zip',
    exportBlocked: '存在未通过项，处理后才能导出投稿包。',
    lastExport: '最近导出',
    exportDocx: '导出 Word (.docx)',
    exportingDocx: '导出中…',
    recTitle: '期刊推荐',
    recEmpty: '暂无推荐：库内没有指向内置场所的发表记录，且摘要未命中任何 scope 词表。',
    setTarget: '设为目标',
    isTarget: '当前目标',
  },
  en: {
    title: 'Submit',
    target: 'Target journal / conference',
    placeholder: 'Select a venue…',
    noVenue: 'No target venue yet. Pick one above, or set one from the recommendations below.',
    typeConference: 'Conference',
    typeJournal: 'Journal',
    fPageLimit: 'Page limit',
    fTemplate: 'Template',
    fAnonymity: 'Anonymity',
    fSupplementary: 'Supplementary',
    fAiPolicy: 'AI policy',
    fNotes: 'Notes',
    deadlineTitle: 'Submission deadline',
    deadlineLabel: 'Submission deadline date',
    coverLetter: 'Draft Cover Letter (W11)',
    relatedWork: 'Draft Related Work (W12)',
    checklistTitle: 'Packaging checklist',
    passedUnit: 'passed',
    exportZip: 'Export project zip',
    exportBlocked: 'Some checks failed; fix them before exporting the submission package.',
    lastExport: 'Last export',
    exportDocx: 'Export Word (.docx)',
    exportingDocx: 'Exporting…',
    recTitle: 'Venue recommendations',
    recEmpty: 'No recommendations: no library papers map to built-in venues and the abstract hits no scope keywords.',
    setTarget: 'Set as target',
    isTarget: 'Current target',
  },
};

export function SubmitPanel() {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language];
  const locale = language === 'zh' ? 'zh-CN' : 'en-US';

  const files = useWorkspaceStore((s) => s.files);
  const projectName = useWorkspaceStore((s) => s.projectName);
  const papers = useLibraryStore((s) => s.papers);

  const venueId = useSubmitStore((s) => s.venueId);
  const lastExportAt = useSubmitStore((s) => s.lastExportAt);
  const setVenueId = useSubmitStore((s) => s.setVenueId);
  const markExported = useSubmitStore((s) => s.markExported);
  const deadline = useSubmitStore((s) => s.deadline);
  const setDeadline = useSubmitStore((s) => s.setDeadline);

  const profile = venueId ? venueById(venueId) : undefined;

  // S2：打包自检随文件实时重算；有未通过项 → 导出按钮禁用
  const checklist = useMemo(() => packagingChecklist(files), [files]);
  const passedCount = checklist.filter((i) => i.ok).length;
  const allOk = checklist.length > 0 && checklist.every((i) => i.ok);

  // S5：推荐输入 = 库内条目 venue + 从稿件源码抽取的摘要
  const abstract = useMemo(() => extractAbstractFromTex(files), [files]);
  const recs = useMemo(() => recommendVenues(papers, abstract, language), [papers, abstract, language]);

  // deadline 倒计时 chip：>14 天 dim、3–14 天 warn、<3 天（含已过期/当天）err
  const countdown = useMemo(() => (deadline ? deadlineCountdown(deadline) : null), [deadline]);
  const countdownTone = countdown ? (countdown.days > 14 ? 'dim' : countdown.days >= 3 ? 'warn' : 'err') : '';

  // 导出 Word（.docx）：pandoc 转换在桌面形态可能触发内置下载（首用时较慢），故带 loading/错误态
  const [docxPhase, setDocxPhase] = useState<'idle' | 'running' | 'error'>('idle');
  const [docxError, setDocxError] = useState<string | null>(null);
  const onExportDocx = () => {
    if (docxPhase === 'running') return;
    setDocxPhase('running');
    setDocxError(null);
    void exportDocx().then((r) => {
      if (r.ok) {
        setDocxPhase('idle');
      } else {
        setDocxPhase('error');
        setDocxError(r.error);
      }
    });
  };

  const exportZip = () => {
    const { name, bytes } = buildProjectZip(files, projectName);
    // zipSync 产出精确尺寸的 buffer；cast 兼容 TS 新版 BlobPart 泛型口径
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    markExported();
  };

  // S4：W11 变量预填（journal + highlights），启动器不再询问任何输入
  const draftCoverLetter = () => {
    if (!profile) return;
    useUiStore.getState().launchWorkflow('w11-cover-letter', {
      journal: profile.name,
      highlights: '',
    });
  };

  // W12：topic 预填摘要前 200 字，稿件无摘要时回落 venue 名（都没有则留空，由启动器询问）
  const draftRelatedWork = () => {
    const abstractText = abstract.trim();
    const topic = abstractText ? abstractText.slice(0, 200) : (profile?.name ?? '');
    useUiStore.getState().launchWorkflow('w12-related-work', { topic, manuscript: '' });
  };

  const fields: [string, string][] = profile
    ? [
        [t.fPageLimit, profile.pageLimit],
        [t.fTemplate, profile.template],
        [t.fAnonymity, profile.anonymity],
        [t.fSupplementary, profile.supplementary],
        [t.fAiPolicy, profile.aiPolicy],
        [t.fNotes, profile.notes],
      ]
    : [];

  return (
    <div className="sf-submit">
      <div className="sf-submit-head">
        <strong>{t.title}</strong>
        <select
          className="sf-submit-select"
          value={venueId ?? ''}
          aria-label={t.target}
          onChange={(e) => setVenueId(e.target.value || null)}
        >
          <option value="">{t.placeholder}</option>
          {VENUE_PROFILES.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </div>

      <section className="sf-submit-card">
        {profile ? (
          <>
            <div className="sf-submit-card-head">
              <strong>{profile.name}</strong>
              <span className="sf-chip">
                {profile.type === 'conference' ? t.typeConference : t.typeJournal}
              </span>
            </div>
            <dl className="sf-submit-fields">
              {fields.map(([label, value]) => (
                <div key={label} className="sf-submit-field">
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <button className="sf-btn sf-btn--primary sf-submit-coverletter" onClick={draftCoverLetter}>
              <FileText size={12} /> {t.coverLetter}
            </button>
          </>
        ) : (
          <p className="sf-submit-empty">{t.noVenue}</p>
        )}
      </section>

      <section className="sf-submit-card">
        <div className="sf-submit-card-head">
          <strong>{t.deadlineTitle}</strong>
          {countdown && <span className={`sf-chip ${countdownTone}`}>{countdown.label}</span>}
        </div>
        <input
          type="date"
          className="sf-submit-select"
          value={deadline ?? ''}
          aria-label={t.deadlineLabel}
          onChange={(e) => setDeadline(e.target.value || null)}
        />
        <button className="sf-btn sf-btn--primary sf-submit-coverletter" onClick={draftRelatedWork}>
          <BookOpen size={12} /> {t.relatedWork}
        </button>
      </section>

      <section className="sf-submit-card">
        <div className="sf-submit-card-head">
          <strong>{t.checklistTitle}</strong>
          <span className="sf-chip dim">
            {passedCount} / {checklist.length} {t.passedUnit}
          </span>
        </div>
        <ul className="sf-submit-checklist">
          {checklist.map((item) => (
            <li
              key={item.item}
              className={`sf-submit-check ${item.ok ? 'sf-submit-check--ok' : 'sf-submit-check--err'}`}
            >
              <span className="sf-submit-check-mark">{item.ok ? '✓' : '✗'}</span>
              <div className="sf-submit-check-body">
                <div className="sf-submit-check-item">{item.item}</div>
                <div className="sf-submit-check-detail">{item.detail}</div>
              </div>
            </li>
          ))}
        </ul>
        <div className="sf-submit-export-row">
          <button
            className="sf-btn sf-btn--primary"
            disabled={!allOk}
            title={allOk ? undefined : t.exportBlocked}
            onClick={exportZip}
          >
            <FileArchive size={12} /> {t.exportZip}
          </button>
          <button
            className="sf-btn"
            disabled={docxPhase === 'running'}
            title={docxPhase === 'running' ? t.exportingDocx : undefined}
            onClick={onExportDocx}
          >
            <FileText size={12} /> {docxPhase === 'running' ? t.exportingDocx : t.exportDocx}
          </button>
          {lastExportAt !== null && (
            <span className="sf-submit-lastexport">
              {t.lastExport}: {new Date(lastExportAt).toLocaleString(locale)}
            </span>
          )}
        </div>
        {!allOk && <p className="sf-submit-hint">{t.exportBlocked}</p>}
        {docxPhase === 'error' && docxError !== null && <p className="sf-submit-hint">{docxError}</p>}
      </section>

      <section className="sf-submit-card">
        <div className="sf-submit-card-head">
          <strong>{t.recTitle}</strong>
        </div>
        {recs.length === 0 ? (
          <p className="sf-submit-empty">{t.recEmpty}</p>
        ) : (
          <ul className="sf-submit-recs">
            {recs.map(({ venue, reason, score }) => (
              <li key={venue.id} className="sf-submit-rec">
                <div className="sf-submit-rec-head">
                  <strong>{venue.name}</strong>
                  <span className="sf-chip ok">{score.toFixed(2)}</span>
                </div>
                <p className="sf-submit-rec-reason">{reason}</p>
                <button
                  className="sf-btn sf-submit-rec-set"
                  disabled={venueId === venue.id}
                  onClick={() => setVenueId(venue.id)}
                >
                  {venueId === venue.id ? <Check size={12} /> : <Plus size={12} />}
                  {venueId === venue.id ? t.isTarget : t.setTarget}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
