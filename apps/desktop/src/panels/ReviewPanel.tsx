/**
 * W6 审稿仿真的结构化结果面板：三位审稿人卡片（评分徽章 + 分区渲染）+
 * Meta-Review 高亮卡 + 「据此起草 Rebuttal」一键衔接 W7。
 * WF-3 A4：新增 RebuttalPanel——W7 finalize 输出按审稿人分段渲染（R1/R2/R3/Meta
 * 或中文标记标题分割），每段显示字数计数；无分段时降级原文。
 * WF-3 A5：面板文案 zh/en 自包含字典。
 */

import { useMemo } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { parseReviewSections, scoreTone, type ReviewSections } from '../reviewParser';
import { useSettingsStore, type Language } from '../state/settingsStore';
import './agent-extra.css';

// ---------------------------------------------------------------------------
// 双语字典（自包含，不碰全局 i18n.ts）
// ---------------------------------------------------------------------------

const STRINGS = {
  zh: {
    reviewers: [
      { id: 'reviewer-method', label: '审稿人一 · 方法严格派' },
      { id: 'reviewer-domain', label: '审稿人二 · 领域专家' },
      { id: 'reviewer-stat', label: '审稿人三 · 统计与复现' },
    ],
    summary: '总评',
    strengths: '优点',
    weaknesses: '弱项',
    questions: '问题',
    rawOutput: '原始输出',
    headTitle: '审稿意见汇总',
    draftRebuttal: '据此起草 Rebuttal（W7）',
    metaTitle: 'Meta-Review（领域主席汇总）',
    rebuttalTitle: 'Rebuttal（W7 产物）',
    preamble: '总述',
    chars: (n: number) => `${n} 字`,
    rebuttalRaw: '未能按审稿人分段，原文展示',
  },
  en: {
    reviewers: [
      { id: 'reviewer-method', label: 'Reviewer 1 · Method rigor' },
      { id: 'reviewer-domain', label: 'Reviewer 2 · Domain expert' },
      { id: 'reviewer-stat', label: 'Reviewer 3 · Stats & reproducibility' },
    ],
    summary: 'Summary',
    strengths: 'Strengths',
    weaknesses: 'Weaknesses',
    questions: 'Questions',
    rawOutput: 'Raw output',
    headTitle: 'Review Summary',
    draftRebuttal: 'Draft Rebuttal (W7)',
    metaTitle: 'Meta-Review (Area Chair)',
    rebuttalTitle: 'Rebuttal (W7 output)',
    preamble: 'Preamble',
    chars: (n: number) => `${n} chars`,
    rebuttalRaw: 'No reviewer sections detected; shown as-is',
  },
} as const;

// ---------------------------------------------------------------------------
// A4：W7 输出分段解析（纯函数）
// ---------------------------------------------------------------------------

export interface RebuttalSegment {
  /** 段落标题（来自输出中的标题行）；首段总述可能无标题 → null，由 UI 补本地化标题 */
  title: string | null;
  body: string;
}

/**
 * 标题行里的审稿人/Meta 标记：`## R1 …` / `**Reviewer 2**` / `【审稿人三】` / `Meta-Review` / 中文标记。
 * 负向前瞻排除逐条回复编号（R1.1 / Reviewer 2.3 式条目行不是分段标题）。
 */
const SEGMENT_MARKER_RE =
  /\b(?:r\s?\d{1,2}|reviewer\s?\d{1,2})(?!\s*[.．]\s*\d)\b|\bmeta(?:\s?-?\s?review)?\b|审稿人\s*[一二三四五1-5](?!\s*[.．]\s?\d)|汇总|总述|总体回复/i;

/** 该行是否是分段标题行（标题形态 + 含审稿人/Meta 标记）；命中返回清理后的标题 */
function segmentTitle(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return null;
  const looksHeading =
    /^#{1,6}\s+/.test(trimmed) || // markdown 标题
    /^\*\*.+\*\*$/.test(trimmed) || // 全行加粗
    /^[【\[]/.test(trimmed) || // 【审稿人一】/ [R1]
    trimmed.length <= 40; // 短行标题（如「审稿人一：」）
  if (!looksHeading) return null;
  if (!SEGMENT_MARKER_RE.test(trimmed)) return null;
  return trimmed
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .replace(/^[【\[]/, '')
    .replace(/[】\]]$/, '')
    .replace(/[:：]\s*$/, '')
    .trim();
}

/**
 * 把 W7 finalize 输出按审稿人分段：
 * 命中分段标题 → 新段；标题前的内容作为「总述」首段（无标题）。
 * 一个分段标记都没有时返回 null（调用方降级原文展示）。
 */
export function splitRebuttalSections(md: string): RebuttalSegment[] | null {
  const segments: RebuttalSegment[] = [];
  let preamble: string[] = [];
  let current: RebuttalSegment | null = null;

  for (const line of md.split('\n')) {
    const title = segmentTitle(line);
    if (title !== null) {
      current = { title, body: '' };
      segments.push(current);
      continue;
    }
    if (current) current.body += (current.body ? '\n' : '') + line;
    else preamble.push(line);
  }

  const head = preamble.join('\n').trim();
  if (segments.length === 0) return null;
  return head ? [{ title: null, body: head }, ...segments.map(trimSegmentBody)] : segments.map(trimSegmentBody);
}

/** 规整段体：去掉首尾空行 */
function trimSegmentBody(s: RebuttalSegment): RebuttalSegment {
  return { ...s, body: s.body.replace(/^\n+|\n+$/g, '') };
}

/** 字数计数（去空白字符，对中英文都直观） */
export function countChars(text: string): number {
  return text.replace(/\s/g, '').length;
}

// ---------------------------------------------------------------------------
// W6 审稿卡片
// ---------------------------------------------------------------------------

function Section({ title, body, tone }: { title: string; body: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`sf-review-section ${tone ? `sf-review-section--${tone}` : ''}`}>
      <div className="sf-review-section-title">{title}</div>
      <pre>{body}</pre>
    </div>
  );
}

function ReviewerCard({ label, output }: { label: string; output: string }) {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];
  const sections: ReviewSections = useMemo(() => parseReviewSections(output), [output]);
  const tone = scoreTone(sections.score);
  return (
    <div className="sf-review-card">
      <div className="sf-review-card-head">
        <strong>{label}</strong>
        {sections.score && <span className={`sf-chip sf-review-score sf-review-score--${tone}`}>{sections.score}</span>}
      </div>
      {sections.summary ? <Section title={t.summary} body={sections.summary} /> : null}
      {sections.strengths ? <Section title={t.strengths} body={sections.strengths} tone="good" /> : null}
      {sections.weaknesses ? <Section title={t.weaknesses} body={sections.weaknesses} tone="bad" /> : null}
      {sections.questions ? <Section title={t.questions} body={sections.questions} /> : null}
      {!sections.summary && !sections.strengths && !sections.weaknesses && !sections.questions && (
        <Section title={t.rawOutput} body={output.slice(0, 600)} />
      )}
    </div>
  );
}

export interface ReviewPanelProps {
  outputs: Record<string, string>;
  onDraftRebuttal: (reviews: string, manuscript: string) => void;
}

export function ReviewPanel({ outputs, onDraftRebuttal }: ReviewPanelProps) {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];
  const meta = outputs['meta-review'];
  const reviewersOutput = t.reviewers.map((r) => outputs[r.id]).filter(Boolean) as string[];

  const draftRebuttal = () => {
    const reviews = [
      ...t.reviewers.filter((r) => outputs[r.id]).map((r) => `【${r.label}】\n${outputs[r.id]}`),
      meta ? `【Meta-Review】\n${meta}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    onDraftRebuttal(reviews, '（见 Context Pack 中的稿件结构；完整稿件已注入工作流上下文）');
  };

  return (
    <div className="sf-review">
      <div className="sf-review-head">
        <strong>{t.headTitle}</strong>
        <button className="sf-btn sf-btn--primary" onClick={draftRebuttal} disabled={reviewersOutput.length === 0}>
          <MessageSquareReply size={12} /> {t.draftRebuttal}
        </button>
      </div>
      <div className="sf-review-grid">
        {t.reviewers.map(({ id, label }) =>
          outputs[id] ? <ReviewerCard key={id} label={label} output={outputs[id]!} /> : null,
        )}
      </div>
      {meta && (
        <div className="sf-review-card sf-review-card--meta">
          <div className="sf-review-card-head">
            <strong>{t.metaTitle}</strong>
          </div>
          <pre>{meta}</pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A4：W7 Rebuttal 分段视图
// ---------------------------------------------------------------------------

export interface RebuttalPanelProps {
  /** W7 finalize 步骤输出的 markdown */
  output: string;
}

export function RebuttalPanel({ output }: RebuttalPanelProps) {
  const language = useSettingsStore((s) => s.language);
  const t = STRINGS[language] as (typeof STRINGS)[Language];
  const segments = useMemo(() => splitRebuttalSections(output), [output]);

  return (
    <div className="sf-rebuttal" data-segmented={segments ? 'true' : 'false'}>
      <div className="sf-rebuttal-head">
        <strong>{t.rebuttalTitle}</strong>
      </div>
      {segments ? (
        <div className="sf-rebuttal-segments">
          {segments.map((seg, i) => (
            <div key={i} className="sf-rebuttal-segment">
              <div className="sf-rebuttal-segment-head">
                <span>{seg.title ?? t.preamble}</span>
                <span className="sf-rebuttal-segment-count">{t.chars(countChars(seg.body))}</span>
              </div>
              <pre>{seg.body}</pre>
            </div>
          ))}
        </div>
      ) : (
        <div className="sf-rebuttal-raw">
          <p className="sf-checklist-empty">{t.rebuttalRaw}</p>
          <pre>{output}</pre>
        </div>
      )}
    </div>
  );
}
