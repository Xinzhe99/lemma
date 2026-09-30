/**
 * W6 审稿仿真的结构化结果面板：三位审稿人卡片（评分徽章 + 分区渲染）+
 * Meta-Review 高亮卡 + 「据此起草 Rebuttal」一键衔接 W7。
 */

import { useMemo } from 'react';
import { MessageSquareReply } from 'lucide-react';
import { parseReviewSections, scoreTone, type ReviewSections } from '../reviewParser';

const REVIEWERS: { id: string; label: string }[] = [
  { id: 'reviewer-method', label: '审稿人一 · 方法严格派' },
  { id: 'reviewer-domain', label: '审稿人二 · 领域专家' },
  { id: 'reviewer-stat', label: '审稿人三 · 统计与复现' },
];

function Section({ title, body, tone }: { title: string; body: string; tone?: 'good' | 'bad' }) {
  return (
    <div className={`sf-review-section ${tone ? `sf-review-section--${tone}` : ''}`}>
      <div className="sf-review-section-title">{title}</div>
      <pre>{body}</pre>
    </div>
  );
}

function ReviewerCard({ label, output }: { label: string; output: string }) {
  const sections: ReviewSections = useMemo(() => parseReviewSections(output), [output]);
  const tone = scoreTone(sections.score);
  return (
    <div className="sf-review-card">
      <div className="sf-review-card-head">
        <strong>{label}</strong>
        {sections.score && <span className={`sf-chip sf-review-score sf-review-score--${tone}`}>{sections.score}</span>}
      </div>
      {sections.summary ? <Section title="总评" body={sections.summary} /> : null}
      {sections.strengths ? <Section title="优点" body={sections.strengths} tone="good" /> : null}
      {sections.weaknesses ? <Section title="弱项" body={sections.weaknesses} tone="bad" /> : null}
      {sections.questions ? <Section title="问题" body={sections.questions} /> : null}
      {!sections.summary && !sections.strengths && !sections.weaknesses && !sections.questions && (
        <Section title="原始输出" body={output.slice(0, 600)} />
      )}
    </div>
  );
}

export interface ReviewPanelProps {
  outputs: Record<string, string>;
  onDraftRebuttal: (reviews: string, manuscript: string) => void;
}

export function ReviewPanel({ outputs, onDraftRebuttal }: ReviewPanelProps) {
  const meta = outputs['meta-review'];
  const reviewersOutput = REVIEWERS.map((r) => outputs[r.id]).filter(Boolean) as string[];

  const draftRebuttal = () => {
    const reviews = [
      ...REVIEWERS.filter((r) => outputs[r.id]).map((r) => `【${r.label}】\n${outputs[r.id]}`),
      meta ? `【Meta-Review】\n${meta}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    onDraftRebuttal(reviews, '（见 Context Pack 中的稿件结构；完整稿件已注入工作流上下文）');
  };

  return (
    <div className="sf-review">
      <div className="sf-review-head">
        <strong>审稿意见汇总</strong>
        <button className="sf-btn sf-btn--primary" onClick={draftRebuttal} disabled={reviewersOutput.length === 0}>
          <MessageSquareReply size={12} /> 据此起草 Rebuttal（W7）
        </button>
      </div>
      <div className="sf-review-grid">
        {REVIEWERS.map(({ id, label }) =>
          outputs[id] ? <ReviewerCard key={id} label={label} output={outputs[id]!} /> : null,
        )}
      </div>
      {meta && (
        <div className="sf-review-card sf-review-card--meta">
          <div className="sf-review-card-head">
            <strong>Meta-Review（领域主席汇总）</strong>
          </div>
          <pre>{meta}</pre>
        </div>
      )}
    </div>
  );
}
