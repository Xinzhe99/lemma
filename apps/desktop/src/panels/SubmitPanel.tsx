/**
 * WF-1 投稿工作台（S1–S5）：
 * - 目标期刊/会议档案（submission/venues.ts）选择与全字段展示；
 * - 「投稿文书」区（submissionDocs.ts 纯函数 + resolveProvider/runAgentTurn 只读消费）：
 *   Highlights / 利益声明 / 数据可用性 / 中文 Cover Letter 四键生成，流式展示在
 *   本区内（不写入 Agent 会话）；Highlights 经 parseHighlights 逐条渲染并带字数徽标
 *   （超 85 字符转黄）；每类结果可一键复制；
 * - 投稿 deadline 追踪：type=date 输入绑定 submitStore.deadline，
 *   deadlineCountdown 倒计时 chip（>14 天灰 / 3–14 天 warn / <3 天 err）；
 * - 投稿打包自检（@lemma/compile packagingChecklist）逐项 ✓/✗，
 *   全部通过才可 buildProjectZip 生成 zip 并触发浏览器下载；
 * - 「起草 Cover Letter (W11)」经 uiStore.launchWorkflow 预填 journal/highlights；
 * - 「起草 Related Work (W12)」同经 launchWorkflow 预填 topic（摘要前 200 字或 venue 名）/manuscript；
 * - 「导出 Word (.docx)」经 pandoc.exportDocx（内置 pandoc 自动下载/系统探测）转换并下载，
 *   含 loading/错误态（错误中文展示在自检卡片下方）；
 * - 期刊推荐（submission/recommend.ts）：库内发表去向 + 摘要 scope 重叠，可一键设为目标；
 * - 「投稿追踪」区（submitStore.rounds 多轮投稿记录）：时间线列表（每轮 venue +
 *   六态状态徽章六色 + submittedAt/respondedAt 日期 + note + 状态下拉即改 + 删除）、
 *   「记录新一轮投稿」内联表单（venue 默认当前目标 venue、日期默认今天）、
 *   统计行（在投 N · 已接收 M · 被拒 K）；时间线最新一轮在最上。
 * 壳层以动态 import 挂载：export function SubmitPanel()，无 props。
 * 文案为组件内自包含 zh/en 双语字典（读 settingsStore.language）。
 */

import { useMemo, useState, type CSSProperties } from 'react';
import { BookOpen, Check, FileArchive, FileText, Plus, Trash2 } from 'lucide-react';
import { buildProjectZip, packagingChecklist } from '@lemma/compile';
import { useSettingsStore, type Language } from '../state/settingsStore';
import { useWorkspaceStore } from '../state/workspaceStore';
import { useLibraryStore } from '../state/libraryStore';
import { useUiStore } from '../state/uiStore';
import {
  SUBMISSION_STATUSES,
  deadlineCountdown,
  useSubmitStore,
  type SubmissionStatus,
} from '../state/submitStore';
import { exportDocx } from '../pandoc';
import { VENUE_PROFILES, venueById } from '../submission/venues';
import { extractAbstractFromTex, recommendVenues } from '../submission/recommend';
import { resolveProvider } from '../aiActions';
import { runAgentTurn } from '../agentTools';
import { combinedDoc } from '../projectDoc';
import {
  charCount,
  DOC_KINDS,
  DOC_LABELS,
  DOC_SYSTEM_PROMPT,
  HIGHLIGHTS_CHAR_LIMIT,
  buildDocPrompt,
  parseHighlights,
  type DocKind,
} from '../submissionDocs';
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
  docsTitle: string;
  docsHint: string;
  generating: string;
  copy: string;
  copied: string;
  genFailed: string;
  charsUnit: string;
  overLimit: string;
  trackTitle: string;
  trackHint: string;
  trackEmpty: string;
  trackVenueLabel: string;
  trackVenuePlaceholder: string;
  trackDateLabel: string;
  trackNoteLabel: string;
  trackNotePlaceholder: string;
  trackAdd: string;
  trackStatusLabel: string;
  trackRemove: string;
  trackRemoveLabel: string;
  trackSubmittedAt: string;
  trackRespondedAt: string;
  statActive: string;
  statAccepted: string;
  statRejected: string;
  trackStatuses: Record<SubmissionStatus, string>;
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
    docsTitle: '投稿文书',
    docsHint: '从当前稿件一键生成四类投稿文书，生成后可核对再复制（未配置模型服务时为演示数据）。',
    generating: '生成中…',
    copy: '复制',
    copied: '已复制',
    genFailed: '生成失败：',
    charsUnit: ' 字',
    overLimit: '超过 85 字符上限（投稿系统通行要求），建议精简',
    trackTitle: '投稿追踪',
    trackHint: '真实投稿常跨月多轮：记录每一轮的 venue 与状态，审稿进展随时更新。',
    trackEmpty: '暂无投稿记录。',
    trackVenueLabel: 'Venue（期刊/会议）',
    trackVenuePlaceholder: '如 NeurIPS',
    trackDateLabel: '投稿日期',
    trackNoteLabel: '备注（可选）',
    trackNotePlaceholder: '审稿意见链接、本轮备注…',
    trackAdd: '记录新一轮投稿',
    trackStatusLabel: '状态',
    trackRemove: '删除',
    trackRemoveLabel: '删除此轮投稿',
    trackSubmittedAt: '投',
    trackRespondedAt: '复',
    statActive: '在投',
    statAccepted: '已接收',
    statRejected: '被拒',
    trackStatuses: {
      submitted: '已投稿',
      'under-review': '审稿中',
      'major-revision': '大修',
      'minor-revision': '小修',
      accepted: '已接收',
      rejected: '已拒稿',
    },
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
    docsTitle: 'Submission documents',
    docsHint: 'One-click drafts of the four submission documents from the current manuscript; review then copy (demo data until a model provider is configured).',
    generating: 'Generating…',
    copy: 'Copy',
    copied: 'Copied',
    genFailed: 'Generation failed: ',
    charsUnit: ' chars',
    overLimit: 'Over the 85-character limit (common venue requirement); consider trimming',
    trackTitle: 'Submission tracking',
    trackHint: 'Real submissions run in rounds across months: log each round’s venue and status, and update as reviews come in.',
    trackEmpty: 'No rounds logged yet.',
    trackVenueLabel: 'Venue (journal / conference)',
    trackVenuePlaceholder: 'e.g. NeurIPS',
    trackDateLabel: 'Submitted on',
    trackNoteLabel: 'Note (optional)',
    trackNotePlaceholder: 'reviewer link, round notes…',
    trackAdd: 'Log a new round',
    trackStatusLabel: 'Status',
    trackRemove: 'Remove',
    trackRemoveLabel: 'Remove this round',
    trackSubmittedAt: 'submitted',
    trackRespondedAt: 'responded',
    statActive: 'active',
    statAccepted: 'accepted',
    statRejected: 'rejected',
    trackStatuses: {
      submitted: 'Submitted',
      'under-review': 'Under review',
      'major-revision': 'Major revision',
      'minor-revision': 'Minor revision',
      accepted: 'Accepted',
      rejected: 'Rejected',
    },
  },
};

/** 剪贴板：优先 navigator.clipboard，非安全上下文回退隐藏 textarea + execCommand（同 NotesPanel 模式） */
function writeClipboard(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      if (document.execCommand('copy')) resolve();
      else reject(new Error('execCommand copy failed'));
    } finally {
      ta.remove();
    }
  });
}

/** 投稿文书生成在途/失败态（成功后结果落入 docResults、此态清空） */
interface DocGenState {
  kind: DocKind;
  phase: 'running' | 'error';
  text: string;
  error: string | null;
}

/** 本地时区「今天」的 YYYY-MM-DD（新增轮次表单的日期默认值） */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 六态徽章六色（随主题变量/字面色 + color-mix 描边，与 .sf-chip 色调变体同构） */
const STATUS_COLORS: Record<SubmissionStatus, string> = {
  submitted: '#3b82f6', // 蓝：刚投出
  'under-review': 'var(--violet)', // 紫：审稿中
  'major-revision': '#d97706', // 橙：大修
  'minor-revision': 'var(--warn)', // 琥珀：小修
  accepted: 'var(--ok)', // 绿：接收
  rejected: 'var(--err)', // 红：拒稿
};

function badgeStyle(status: SubmissionStatus): CSSProperties {
  const c = STATUS_COLORS[status];
  return { color: c, borderColor: `color-mix(in srgb, ${c} 40%, var(--border))` };
}

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
  const rounds = useSubmitStore((s) => s.rounds);
  const addRound = useSubmitStore((s) => s.addRound);
  const updateRoundStatus = useSubmitStore((s) => s.updateRoundStatus);
  const removeRound = useSubmitStore((s) => s.removeRound);

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

  // ---------------------------------------------------------------------------
  // 「投稿追踪」区：多轮投稿时间线（submitStore.rounds）。venue 输入未触碰时
  // 跟随当前目标 venue，日期默认今天；统计行 = 在投（非终态）/ 已接收 / 被拒。
  // ---------------------------------------------------------------------------
  const [roundVenue, setRoundVenue] = useState<string | null>(null); // null = 未触碰，跟随目标 venue
  const [roundDate, setRoundDate] = useState<string>(todayIso);
  const [roundNote, setRoundNote] = useState('');
  const venueValue = roundVenue ?? profile?.name ?? '';

  const activeCount = rounds.filter((r) => r.status !== 'accepted' && r.status !== 'rejected').length;
  const acceptedCount = rounds.filter((r) => r.status === 'accepted').length;
  const rejectedCount = rounds.filter((r) => r.status === 'rejected').length;
  const statsLine = `${t.statActive} ${activeCount} · ${t.statAccepted} ${acceptedCount} · ${t.statRejected} ${rejectedCount}`;

  const onAddRound = () => {
    const venue = venueValue.trim();
    if (!venue || !roundDate) return;
    addRound({ venue, submittedAt: roundDate, note: roundNote.trim() || undefined });
    setRoundVenue(null); // 重新跟随当前目标 venue
    setRoundNote('');
    setRoundDate(todayIso());
  };


  // ---------------------------------------------------------------------------
  // 「投稿文书」区：resolveProvider（演示模式走 ScriptedDemoProvider，由集成者按
  // submissionDocs 的路由关键词补 demo 脚本）+ runAgentTurn 只读消费，直接在本区
  // 展示流式结果——不经 sendChatMessage，不写入 Agent 会话。
  // ---------------------------------------------------------------------------
  const [docGen, setDocGen] = useState<DocGenState | null>(null);
  const [docResults, setDocResults] = useState<Partial<Record<DocKind, string>>>({});
  const [copiedDoc, setCopiedDoc] = useState<DocKind | null>(null);

  const generateDoc = (kind: DocKind) => {
    if (docGen?.phase === 'running') return;
    const prompt = buildDocPrompt(kind, combinedDoc(files));
    setDocGen({ kind, phase: 'running', text: '', error: null });
    const { provider, model } = resolveProvider();
    void runAgentTurn({
      provider,
      model,
      system: DOC_SYSTEM_PROMPT,
      history: [],
      user: prompt,
      onDelta: (delta) =>
        setDocGen((g) => (g && g.kind === kind && g.phase === 'running' ? { ...g, text: g.text + delta } : g)),
    })
      .then((text) => {
        setDocResults((prev) => ({ ...prev, [kind]: text }));
        setDocGen(null);
      })
      .catch((e: unknown) => {
        setDocGen({ kind, phase: 'error', text: '', error: e instanceof Error ? e.message : String(e) });
      });
  };

  const copyDoc = (kind: DocKind) => {
    const text = docResults[kind];
    if (text === undefined) return;
    void writeClipboard(text)
      .then(() => {
        setCopiedDoc(kind);
        setTimeout(() => setCopiedDoc((k) => (k === kind ? null : k)), 1500);
      })
      .catch(() => {
        /* 复制失败静默：保留结果文本，用户可手动选择 */
      });
  };

  /** 结果渲染：Highlights 逐条 + 字数徽标（超 85 字转黄），其余文书纯文本滚动框 */
  const renderDocBody = (kind: DocKind, text: string) => {
    if (kind === 'highlights') {
      const items = parseHighlights(text);
      if (items.length === 0) return null;
      return (
        <ul className="sf-submit-checklist">
          {items.map((item, i) => {
            const n = charCount(item);
            const over = n > HIGHLIGHTS_CHAR_LIMIT;
            return (
              <li key={`${i}-${item.slice(0, 8)}`} className="sf-submit-check">
                <div className="sf-submit-check-body" style={{ flex: 1 }}>
                  <div className="sf-submit-check-item">{item}</div>
                </div>
                <span
                  className={`sf-chip ${over ? 'warn' : 'dim'}`}
                  title={over ? t.overLimit : undefined}
                >
                  {n}
                  {t.charsUnit}
                </span>
              </li>
            );
          })}
        </ul>
      );
    }
    return (
      <div
        className="sf-submit-check-item"
        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
      >
        {text}
      </div>
    );
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
          <strong>{t.docsTitle}</strong>
          {docGen?.phase === 'running' && <span className="sf-chip dim">{t.generating}</span>}
        </div>
        <p className="sf-submit-empty">{t.docsHint}</p>
        <div className="sf-submit-export-row">
          {DOC_KINDS.map((kind) => {
            const busy = docGen?.phase === 'running';
            const runningThis = busy && docGen.kind === kind;
            return (
              <button key={kind} className="sf-btn" disabled={busy} onClick={() => generateDoc(kind)}>
                {runningThis ? t.generating : DOC_LABELS[kind][language]}
              </button>
            );
          })}
        </div>
        {docGen?.phase === 'error' && docGen.error !== null && (
          <p className="sf-submit-hint">{`${t.genFailed}${docGen.error}`}</p>
        )}
        {docGen?.phase === 'running' && docGen.text !== '' && (
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>{renderDocBody(docGen.kind, docGen.text)}</div>
        )}
        {DOC_KINDS.filter((k) => docResults[k] !== undefined).map((kind) => (
          <div key={kind} className="sf-submit-doc">
            <div className="sf-submit-card-head">
              <strong>{DOC_LABELS[kind][language]}</strong>
              <button className="sf-btn sf-submit-rec-set" onClick={() => copyDoc(kind)}>
                {copiedDoc === kind ? t.copied : t.copy}
              </button>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto' }}>{renderDocBody(kind, docResults[kind]!)}</div>
          </div>
        ))}
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

      <section className="sf-submit-card">
        <div className="sf-submit-card-head">
          <strong>{t.trackTitle}</strong>
          <span className="sf-chip dim">{statsLine}</span>
        </div>
        <p className="sf-submit-empty">{t.trackHint}</p>

        {/* 记录新一轮投稿：venue 默认当前目标 venue、日期默认今天 */}
        <div className="sf-submit-fields">
          <div className="sf-submit-field">
            <span style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 2 }}>{t.trackVenueLabel}</span>
            <input
              type="text"
              className="sf-submit-select"
              style={{ maxWidth: '100%' }}
              value={venueValue}
              placeholder={t.trackVenuePlaceholder}
              aria-label={t.trackVenueLabel}
              onChange={(e) => setRoundVenue(e.target.value)}
            />
          </div>
          <div className="sf-submit-field">
            <span style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 2 }}>{t.trackDateLabel}</span>
            <input
              type="date"
              className="sf-submit-select"
              value={roundDate}
              aria-label={t.trackDateLabel}
              onChange={(e) => setRoundDate(e.target.value)}
            />
          </div>
          <div className="sf-submit-field">
            <span style={{ fontSize: 11, color: 'var(--fg-2)', marginBottom: 2 }}>{t.trackNoteLabel}</span>
            <input
              type="text"
              className="sf-submit-select"
              style={{ maxWidth: '100%' }}
              value={roundNote}
              placeholder={t.trackNotePlaceholder}
              aria-label={t.trackNoteLabel}
              onChange={(e) => setRoundNote(e.target.value)}
            />
          </div>
          <button
            className="sf-btn sf-btn--primary sf-submit-coverletter"
            disabled={!venueValue.trim() || !roundDate}
            onClick={onAddRound}
          >
            <Plus size={12} /> {t.trackAdd}
          </button>
        </div>

        {rounds.length === 0 ? (
          <p className="sf-submit-empty">{t.trackEmpty}</p>
        ) : (
          <ul className="sf-submit-recs">
            {[...rounds].reverse().map((r) => (
              <li key={r.id} className="sf-submit-rec">
                <div className="sf-submit-rec-head">
                  <strong>{r.venue}</strong>
                  <span className="sf-chip" style={badgeStyle(r.status)}>
                    {t.trackStatuses[r.status]}
                  </span>
                </div>
                <p className="sf-submit-rec-reason">
                  {t.trackSubmittedAt} {r.submittedAt}
                  {r.respondedAt ? ` · ${t.trackRespondedAt} ${r.respondedAt}` : ''}
                  {r.note ? ` · ${r.note}` : ''}
                </p>
                <div className="sf-submit-export-row">
                  <select
                    className="sf-submit-select"
                    aria-label={`${t.trackStatusLabel}：${r.venue}`}
                    value={r.status}
                    onChange={(e) => updateRoundStatus(r.id, e.target.value as SubmissionStatus)}
                  >
                    {SUBMISSION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t.trackStatuses[s]}
                      </option>
                    ))}
                  </select>
                  <button
                    className="sf-btn sf-submit-rec-set"
                    aria-label={t.trackRemoveLabel}
                    onClick={() => removeRound(r.id)}
                  >
                    <Trash2 size={12} /> {t.trackRemove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
